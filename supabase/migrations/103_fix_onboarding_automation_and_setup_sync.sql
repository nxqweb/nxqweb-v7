-- NXQ Web onboarding QA fixes
-- 1) Fix ambiguous reminder_count reference in the hourly onboarding worker.
-- 2) Materialize accepted website setup reports into client_intakes.
-- 3) Log job_enqueued only when a new idempotent automation job is created.
--
-- This migration does not send email/SMS, process payments, deploy websites,
-- merge branches, or publish production changes.

create or replace function public.enqueue_automation_job(
  target_client_id uuid,
  target_project_id uuid,
  target_job_type text,
  target_idempotency_key text,
  target_payload jsonb default '{}'::jsonb,
  target_run_after timestamptz default now(),
  target_priority integer default 100
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  job_id uuid;
  controls_row public.client_automation_controls%rowtype;
  inserted_new_job boolean := false;
begin
  if target_client_id is null then
    raise exception 'Client id is required.';
  end if;

  insert into public.client_automation_controls (client_id)
  values (target_client_id)
  on conflict (client_id) do nothing;

  select * into controls_row
  from public.client_automation_controls
  where client_id = target_client_id;

  if not controls_row.automation_enabled or controls_row.automation_paused then
    insert into public.automation_audit_log (client_id, project_id, event_type, details)
    values (
      target_client_id,
      target_project_id,
      'job_enqueue_blocked',
      jsonb_build_object(
        'job_type', target_job_type,
        'reason', coalesce(controls_row.pause_reason, 'automation disabled or paused')
      )
    );
    return null;
  end if;

  insert into public.automation_jobs (
    client_id, project_id, job_type, idempotency_key, payload, run_after, priority
  ) values (
    target_client_id,
    target_project_id,
    target_job_type,
    target_idempotency_key,
    coalesce(target_payload, '{}'::jsonb),
    coalesce(target_run_after, now()),
    coalesce(target_priority, 100)
  )
  on conflict (idempotency_key) do nothing
  returning id into job_id;

  if job_id is not null then
    inserted_new_job := true;
  else
    select id into job_id
    from public.automation_jobs
    where idempotency_key = target_idempotency_key;
  end if;

  if inserted_new_job then
    insert into public.automation_audit_log (
      client_id, project_id, automation_job_id, event_type, details
    ) values (
      target_client_id,
      target_project_id,
      job_id,
      'job_enqueued',
      jsonb_build_object(
        'job_type', target_job_type,
        'idempotency_key', target_idempotency_key
      )
    );
  end if;

  return job_id;
end;
$$;

revoke all on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz, integer)
to service_role;

create or replace function public.extract_setup_report_value(
  report text,
  label text
)
returns text
language sql
immutable
strict
as $$
  select nullif(
    btrim(
      substring(
        report
        from ('(?m)^' || regexp_replace(label, '([\\.^$|()\\[\\]{}*+?\\-])', '\\\1', 'g') || ':\\s*(.*)$')
      )
    ),
    ''
  );
$$;

create or replace function public.extract_setup_report_section(
  report text,
  heading text
)
returns text
language sql
immutable
strict
as $$
  select nullif(
    btrim(
      substring(
        report
        from (
          '(?ms)^' || regexp_replace(heading, '([\\.^$|()\\[\\]{}*+?\\-])', '\\\1', 'g') || ':\\s*\\n(.*?)(?:\\n\\n|\\z)'
        )
      )
    ),
    ''
  );
$$;

create or replace function public.sync_accepted_website_setup_to_intake(
  target_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  request_row public.owner_approval_requests%rowtype;
  client_row public.clients%rowtype;
  report text;
  intake_id uuid;
  package_name text;
  phone_value text;
  services_value text;
  goals_value text;
  style_value text;
  service_area_value text;
  business_type_value text;
  contact_name_value text;
  contact_email_value text;
begin
  select * into request_row
  from public.owner_approval_requests
  where id = target_request_id;

  if not found then
    raise exception 'Website setup approval request not found.';
  end if;

  if request_row.request_type <> 'website_setup_review'
     or request_row.status::text <> 'accepted' then
    return null;
  end if;

  select * into client_row
  from public.clients
  where id = request_row.client_id;

  if not found then
    raise exception 'Client for website setup approval was not found.';
  end if;

  report := request_row.recommended_action;
  if nullif(btrim(coalesce(report, '')), '') is null then
    return null;
  end if;

  package_name := public.extract_setup_report_value(report, 'Selected package');
  if package_name is not null then
    package_name := split_part(package_name, ' - ', 1);
  end if;

  phone_value := public.extract_setup_report_value(report, 'Business phone');
  if lower(coalesce(phone_value, '')) in ('not provided', 'none', 'n/a') then
    phone_value := null;
  end if;

  services_value := public.extract_setup_report_section(report, 'Services / products');
  style_value := public.extract_setup_report_value(report, 'Style direction');
  service_area_value := public.extract_setup_report_value(report, 'Locations');
  business_type_value := public.extract_setup_report_value(report, 'Industry');
  contact_email_value := coalesce(
    public.extract_setup_report_value(report, 'Business email'),
    client_row.contact_email
  );
  contact_name_value := coalesce(
    public.extract_setup_report_value(report, 'Typed signature'),
    client_row.contact_name
  );

  goals_value := concat_ws(
    E'\n\n',
    public.extract_setup_report_section(report, 'Pages / sections needed'),
    public.extract_setup_report_section(report, 'Brand difference / positioning'),
    public.extract_setup_report_section(report, 'Lead handling rules')
  );
  goals_value := nullif(btrim(goals_value), '');

  insert into public.client_intakes (
    client_id,
    business_name,
    contact_name,
    contact_email,
    contact_phone,
    business_type,
    services,
    service_area,
    desired_style,
    goals,
    package_interest,
    extra_notes,
    ai_summary,
    ai_missing_info,
    product_family_slug,
    product_tier_key
  ) values (
    client_row.id,
    client_row.business_name,
    contact_name_value,
    contact_email_value,
    phone_value,
    business_type_value,
    services_value,
    service_area_value,
    style_value,
    goals_value,
    package_name,
    'Structured automatically from accepted website setup approval ' || request_row.id::text || '.',
    request_row.summary,
    '[]'::jsonb,
    coalesce(client_row.product_family_slug, 'business'),
    coalesce(client_row.product_tier_key, lower(package_name))
  )
  on conflict do nothing
  returning id into intake_id;

  if intake_id is null then
    select id into intake_id
    from public.client_intakes
    where client_id = client_row.id
    order by created_at desc
    limit 1;
  end if;

  return intake_id;
end;
$$;

revoke all on function public.sync_accepted_website_setup_to_intake(uuid)
from public, anon, authenticated;
grant execute on function public.sync_accepted_website_setup_to_intake(uuid)
to service_role;

create or replace function public.sync_accepted_website_setup_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.request_type = 'website_setup_review'
     and new.status::text = 'accepted'
     and (
       tg_op = 'INSERT'
       or old.status::text is distinct from new.status::text
       or old.recommended_action is distinct from new.recommended_action
     ) then
    perform public.sync_accepted_website_setup_to_intake(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_accepted_website_setup_to_intake
on public.owner_approval_requests;
create trigger sync_accepted_website_setup_to_intake
after insert or update of status, recommended_action
on public.owner_approval_requests
for each row
execute function public.sync_accepted_website_setup_trigger();

create or replace function public.run_onboarding_automation()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  client_row record;
  state_row public.client_onboarding_state%rowtype;
  evaluation jsonb;
  evaluated_count integer := 0;
  reminders_created_count integer := 0;
  reminder_message text;
begin
  for client_row in
    select id
    from public.clients
    where status::text in ('approved', 'active')
    order by created_at asc
  loop
    evaluation := public.evaluate_client_onboarding(client_row.id);
    evaluated_count := evaluated_count + 1;

    select * into state_row
    from public.client_onboarding_state
    where client_id = client_row.id;

    if state_row.status in ('waiting_for_intake', 'needs_information')
       and (
         state_row.last_reminder_at is null
         or state_row.last_reminder_at <= now() - interval '3 days'
       ) then
      reminder_message :=
        'Action needed: '
        || coalesce(state_row.next_step, 'Please complete your onboarding information.');

      if not exists (
        select 1
        from public.client_messages
        where client_id = client_row.id
          and sender_type::text = 'system'
          and message = reminder_message
          and created_at >= now() - interval '3 days'
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
          reminder_message,
          false,
          true
        );

        update public.client_onboarding_state as onboarding
        set reminder_count = onboarding.reminder_count + 1,
            last_reminder_at = now()
        where onboarding.client_id = client_row.id;

        insert into public.automation_audit_log (
          client_id, project_id, event_type, details
        ) values (
          client_row.id,
          state_row.project_id,
          'onboarding_reminder_created',
          jsonb_build_object('missing_fields', state_row.missing_fields)
        );

        reminders_created_count := reminders_created_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'evaluated_clients', evaluated_count,
    'reminders_created', reminders_created_count,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.run_onboarding_automation()
from public, anon, authenticated;
grant execute on function public.run_onboarding_automation()
to service_role;

-- Backfill accepted website setup approvals that do not yet have a structured intake.
do $$
declare
  request_row record;
begin
  for request_row in
    select oar.id
    from public.owner_approval_requests oar
    where oar.request_type = 'website_setup_review'
      and oar.status::text = 'accepted'
      and not exists (
        select 1
        from public.client_intakes ci
        where ci.client_id = oar.client_id
      )
    order by oar.created_at asc
  loop
    perform public.sync_accepted_website_setup_to_intake(request_row.id);
  end loop;
end;
$$;
