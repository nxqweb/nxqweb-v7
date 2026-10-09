-- Make atomic structured website changes replay-safe.
-- If the project mutation committed but a later Edge step failed, a retry of the same
-- change_request_id returns the already-persisted revision rather than incrementing the
-- build-plan version or applying service additions/removals twice.

create or replace function public.apply_structured_website_change_atomic(
  target_change_request_id uuid,
  target_client_id uuid,
  target_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  change_row public.website_change_requests%rowtype;
  project_row public.projects%rowtype;
  existing_revision public.website_content_revisions%rowtype;
  plan jsonb;
  business jsonb;
  patch jsonb;
  services jsonb := '[]'::jsonb;
  service_value text;
  remove_values text[] := array[]::text[];
  changed text[] := array[]::text[];
  next_version integer;
  patch_key text;
  allowed_keys constant text[] := array[
    'contact_phone','contact_email','service_area','goals','desired_style','about',
    'add_services','remove_services'
  ];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_project_id::text, 0));

  select * into change_row
  from public.website_change_requests
  where id = target_change_request_id
    and client_id = target_client_id
    and project_id = target_project_id
  for update;

  if change_row.id is null then
    raise exception 'Website change request not found.';
  end if;

  -- A revision sourced from this exact change request is the durable idempotency fence.
  select * into existing_revision
  from public.website_content_revisions
  where client_id = target_client_id
    and project_id = target_project_id
    and change_request_id = target_change_request_id
    and content_key = 'project_build_plan'
    and source = 'autonomous_safe_change'
  order by revision_number desc, created_at desc
  limit 1;

  if existing_revision.id is not null then
    return jsonb_build_object(
      'ok', true,
      'already_applied', true,
      'change_request_id', target_change_request_id,
      'project_id', target_project_id,
      'build_plan', existing_revision.payload,
      'build_plan_version', existing_revision.revision_number,
      'changed_fields', coalesce(change_row.automation_plan -> 'changed_fields', '[]'::jsonb)
    );
  end if;

  if change_row.risk_level <> 'low' then
    raise exception 'Only low-risk structured changes may be applied automatically.';
  end if;
  if change_row.status in ('published','cancelled','failed') then
    raise exception 'Website change request is already terminal.';
  end if;
  if not exists (
    select 1 from public.clients c
    where c.id = target_client_id and c.status::text in ('approved','active')
  ) then
    raise exception 'Client is not eligible for automated website changes.';
  end if;
  if not exists (
    select 1 from public.owner_approval_requests a
    where a.client_id = target_client_id
      and a.request_type = 'website_setup_review'
      and a.status::text = 'accepted'
  ) then
    raise exception 'Original owner approval is required for automated website changes.';
  end if;

  select * into project_row
  from public.projects
  where id = target_project_id and client_id = target_client_id
  for update;
  if project_row.id is null then raise exception 'Project not found.'; end if;

  patch := coalesce(change_row.requested_payload -> 'patch', '{}'::jsonb);
  if jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
    raise exception 'Structured change patch is missing.';
  end if;
  for patch_key in select jsonb_object_keys(patch)
  loop
    if not (patch_key = any(allowed_keys)) then
      raise exception 'Unsupported structured change key: %', patch_key;
    end if;
  end loop;

  plan := coalesce(project_row.build_plan, '{}'::jsonb);
  business := case when jsonb_typeof(plan -> 'business') = 'object' then plan -> 'business' else '{}'::jsonb end;

  if patch ? 'contact_phone' then
    business := jsonb_set(business, '{contact_phone}', to_jsonb(left(trim(coalesce(patch->>'contact_phone','')),80)), true);
    changed := array_append(changed, 'business.contact_phone');
  end if;
  if patch ? 'contact_email' then
    business := jsonb_set(business, '{contact_email}', to_jsonb(lower(left(trim(coalesce(patch->>'contact_email','')),180))), true);
    changed := array_append(changed, 'business.contact_email');
  end if;
  if patch ? 'service_area' then
    business := jsonb_set(business, '{service_area}', to_jsonb(left(trim(coalesce(patch->>'service_area','')),500)), true);
    changed := array_append(changed, 'business.service_area');
  end if;
  plan := jsonb_set(plan, '{business}', business, true);

  if patch ? 'goals' then
    plan := jsonb_set(plan, '{goals}', to_jsonb(left(trim(coalesce(patch->>'goals','')),2500)), true);
    changed := array_append(changed, 'goals');
  end if;
  if patch ? 'desired_style' then
    plan := jsonb_set(plan, '{desired_style}', to_jsonb(left(trim(coalesce(patch->>'desired_style','')),1800)), true);
    changed := array_append(changed, 'desired_style');
  end if;
  if patch ? 'about' then
    plan := jsonb_set(plan, '{goals}', to_jsonb(left(trim(coalesce(patch->>'about','')),2500)), true);
    changed := array_append(changed, 'about/goals');
  end if;

  if jsonb_typeof(plan -> 'services') = 'array' then services := plan -> 'services'; end if;

  if patch ? 'remove_services' then
    if jsonb_typeof(patch -> 'remove_services') <> 'array' then raise exception 'remove_services must be an array.'; end if;
    select coalesce(array_agg(lower(trim(value))), array[]::text[])
      into remove_values
    from jsonb_array_elements_text(patch -> 'remove_services') as t(value)
    where trim(value) <> '';
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
      into services
    from jsonb_array_elements_text(services) with ordinality as t(value, ord)
    where not (lower(trim(value)) = any(remove_values));
    changed := array_append(changed, 'services.remove');
  end if;

  if patch ? 'add_services' then
    if jsonb_typeof(patch -> 'add_services') <> 'array' then raise exception 'add_services must be an array.'; end if;
    for service_value in
      select trim(value) from jsonb_array_elements_text(patch -> 'add_services') as t(value)
      where trim(value) <> '' limit 12
    loop
      if not exists (
        select 1 from jsonb_array_elements_text(services) as current(value)
        where lower(current.value) = lower(service_value)
      ) then
        services := services || jsonb_build_array(service_value);
      end if;
    end loop;
    changed := array_append(changed, 'services.add');
  end if;

  if patch ? 'add_services' or patch ? 'remove_services' then
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
      into services
    from (
      select value, ord from jsonb_array_elements_text(services) with ordinality as t(value, ord)
      where trim(value) <> '' order by ord limit 24
    ) bounded;
    if jsonb_array_length(services) > 0 then plan := jsonb_set(plan, '{services}', services, true); end if;
  end if;

  if cardinality(changed) = 0 then raise exception 'Low-risk change request does not contain a supported structured patch.'; end if;

  next_version := case
    when coalesce(plan->>'version','') ~ '^[0-9]+$' then greatest((plan->>'version')::integer,1)+1
    else 2
  end;
  plan := jsonb_set(plan, '{version}', to_jsonb(next_version), true);
  plan := jsonb_set(plan, '{last_change_request_at}', to_jsonb(now()::text), true);

  update public.projects set build_plan = plan, updated_at = now()
  where id = target_project_id and client_id = target_client_id;

  -- Store the mutation evidence before returning. A later Edge retry finds this row
  -- and returns it instead of mutating again.
  insert into public.website_content_revisions (
    client_id, project_id, change_request_id, content_key, revision_number, state, payload, source
  ) values (
    target_client_id, target_project_id, target_change_request_id, 'project_build_plan',
    next_version, 'draft', plan, 'autonomous_safe_change'
  );

  update public.website_change_requests
  set automation_plan = coalesce(automation_plan, '{}'::jsonb) || jsonb_build_object(
        'atomic_change_applied', true,
        'changed_fields', to_jsonb(changed),
        'build_plan_version', next_version
      ),
      updated_at = now()
  where id = target_change_request_id
    and client_id = target_client_id
    and project_id = target_project_id;

  return jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'change_request_id', target_change_request_id,
    'project_id', target_project_id,
    'build_plan', plan,
    'build_plan_version', next_version,
    'changed_fields', to_jsonb(changed)
  );
end;
$$;

revoke all on function public.apply_structured_website_change_atomic(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_structured_website_change_atomic(uuid,uuid,uuid) to service_role;
