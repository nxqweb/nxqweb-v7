-- Automatically provision Commerce onboarding after an owner-approved plan change.
-- Existing website details are inferred from trusted account data before asking the client.

alter table public.commerce_intakes
  add column if not exists existing_site_detected boolean not null default false,
  add column if not exists detected_site_url text,
  add column if not exists detected_site_source text,
  add column if not exists website_transition_mode text not null default 'not_selected'
    check (website_transition_mode in (
      'not_selected',
      'new_build',
      'replace_existing',
      'rebuild_with_existing_content',
      'connect_existing_supported_site',
      'nxq_review'
    ));

create or replace function public.detect_client_existing_site(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_url text;
  domain_url text;
  monitored_url text;
  detected_url text;
  detected_source text;
begin
  select nullif(trim(current_website), '')
  into client_url
  from public.clients
  where id = target_client_id;

  if client_url is not null then
    detected_url := client_url;
    detected_source := 'client_profile';
  end if;

  if detected_url is null then
    select case
      when domain_name ~* '^https?://' then domain_name
      else 'https://' || domain_name
    end
    into domain_url
    from public.client_domains
    where client_id = target_client_id
      and nullif(trim(domain_name), '') is not null
    order by
      case when status in ('connected', 'active', 'verified', 'live') then 0 else 1 end,
      requested_at desc
    limit 1;

    if domain_url is not null then
      detected_url := domain_url;
      detected_source := 'connected_domain';
    end if;
  end if;

  if detected_url is null then
    select nullif(trim(monitored_url), '')
    into monitored_url
    from public.website_security_profiles
    where client_id = target_client_id
    order by updated_at desc
    limit 1;

    if monitored_url is not null then
      detected_url := monitored_url;
      detected_source := 'website_monitoring';
    end if;
  end if;

  return jsonb_build_object(
    'detected', detected_url is not null,
    'url', detected_url,
    'source', detected_source
  );
end;
$$;

revoke all on function public.detect_client_existing_site(uuid) from public, anon, authenticated;
grant execute on function public.detect_client_existing_site(uuid) to service_role;

create or replace function public.provision_commerce_onboarding(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  family_slug text;
  detection jsonb;
  detected boolean;
  detected_url text;
  detected_source text;
  intake_row public.commerce_intakes%rowtype;
begin
  select * into client_row
  from public.clients
  where id = target_client_id;

  if client_row.id is null then
    raise exception 'Client workspace not found.';
  end if;

  select slug into family_slug
  from public.product_families
  where id = client_row.product_family_id;

  if family_slug <> 'commerce' then
    return jsonb_build_object('provisioned', false, 'reason', 'not_commerce');
  end if;

  detection := public.detect_client_existing_site(client_row.id);
  detected := coalesce((detection->>'detected')::boolean, false);
  detected_url := nullif(detection->>'url', '');
  detected_source := nullif(detection->>'source', '');

  insert into public.commerce_intakes (
    client_id,
    status,
    store_name,
    current_store_url,
    existing_site_detected,
    detected_site_url,
    detected_site_source,
    website_transition_mode,
    updated_at
  ) values (
    client_row.id,
    'draft',
    client_row.business_name,
    detected_url,
    detected,
    detected_url,
    detected_source,
    case when detected then 'nxq_review' else 'new_build' end,
    now()
  )
  on conflict (client_id) do update set
    store_name = coalesce(public.commerce_intakes.store_name, excluded.store_name),
    current_store_url = coalesce(public.commerce_intakes.current_store_url, excluded.current_store_url),
    existing_site_detected = excluded.existing_site_detected,
    detected_site_url = excluded.detected_site_url,
    detected_site_source = excluded.detected_site_source,
    website_transition_mode = case
      when public.commerce_intakes.website_transition_mode = 'not_selected'
        then excluded.website_transition_mode
      else public.commerce_intakes.website_transition_mode
    end,
    updated_at = now()
  returning * into intake_row;

  if not exists (
    select 1
    from public.client_messages
    where client_id = client_row.id
      and sender_type = 'system'
      and message like 'Your NXQ Commerce plan is approved.%'
  ) then
    insert into public.client_messages (
      client_id,
      sender_type,
      message,
      needs_owner_review,
      ai_handled
    ) values (
      client_row.id,
      'system',
      case
        when detected then format(
          'Your NXQ Commerce plan is approved. We found an existing website at %s, so your Commerce setup is ready with that information prefilled. Open Commerce Setup to choose how NXQ should rebuild, replace, or safely migrate it.',
          detected_url
        )
        else 'Your NXQ Commerce plan is approved. Your Commerce setup workspace is ready. Open Commerce Setup to define the storefront design, scrolling, checkout, fulfillment, and launch requirements.'
      end,
      false,
      true
    );
  end if;

  if not exists (
    select 1 from public.activity_logs
    where client_id = client_row.id
      and action = 'commerce_onboarding_provisioned'
  ) then
    insert into public.activity_logs (client_id, actor_type, action, details)
    values (
      client_row.id,
      'system',
      'commerce_onboarding_provisioned',
      jsonb_build_object(
        'intake_id', intake_row.id,
        'existing_site_detected', detected,
        'detected_site_url', detected_url,
        'detected_site_source', detected_source
      )
    );
  end if;

  return jsonb_build_object(
    'provisioned', true,
    'intake_id', intake_row.id,
    'existing_site_detected', detected,
    'detected_site_url', detected_url,
    'detected_site_source', detected_source
  );
end;
$$;

revoke all on function public.provision_commerce_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.provision_commerce_onboarding(uuid) to service_role;

create or replace function public.trigger_provision_commerce_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family_slug text;
begin
  select slug into new_family_slug
  from public.product_families
  where id = new.product_family_id;

  if new_family_slug = 'commerce'
     and old.product_family_id is distinct from new.product_family_id then
    perform public.provision_commerce_onboarding(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists provision_commerce_onboarding_after_plan_change on public.clients;
create trigger provision_commerce_onboarding_after_plan_change
after update of product_family_id on public.clients
for each row
execute function public.trigger_provision_commerce_onboarding();

-- Backfill clients already approved into Commerce before this automation existed.
do $$
declare
  commerce_client record;
begin
  for commerce_client in
    select clients.id
    from public.clients clients
    join public.product_families family on family.id = clients.product_family_id
    where family.slug = 'commerce'
  loop
    perform public.provision_commerce_onboarding(commerce_client.id);
  end loop;
end;
$$;

comment on function public.provision_commerce_onboarding(uuid) is
  'Creates or refreshes a Commerce intake after Commerce approval, detects an existing website from account data, and notifies the client without publishing anything.';
