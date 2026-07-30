-- NXQ Web deterministic onboarding automation
-- Evaluates approved clients, records missing information, sends bounded reminders,
-- advances project next steps, and queues build-plan preparation only when ready.
-- No payment processing, external email/SMS, deployment, or live publication occurs here.

create table if not exists public.client_onboarding_state (
  client_id uuid primary key references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'waiting_for_intake'
    check (status in ('waiting_for_intake','needs_information','ready_for_build_plan','build_plan_queued','completed','paused')),
  missing_fields jsonb not null default '[]'::jsonb,
  next_step text,
  reminder_count integer not null default 0,
  last_reminder_at timestamptz,
  intake_completed_at timestamptz,
  build_plan_queued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_onboarding_state enable row level security;

drop policy if exists "Owner can manage onboarding state" on public.client_onboarding_state;
create policy "Owner can manage onboarding state"
on public.client_onboarding_state for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists "Client can read own onboarding state" on public.client_onboarding_state;
create policy "Client can read own onboarding state"
on public.client_onboarding_state for select to authenticated
using (
  exists (
    select 1 from public.clients c
    where c.id = client_onboarding_state.client_id
      and c.auth_user_id = auth.uid()
  )
);

create or replace function public.touch_client_onboarding_state()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_client_onboarding_state on public.client_onboarding_state;
create trigger touch_client_onboarding_state
before update on public.client_onboarding_state
for each row execute function public.touch_client_onboarding_state();

create or replace function public.evaluate_client_onboarding(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  client_row public.clients%rowtype;
  intake_row public.client_intakes%rowtype;
  project_row public.projects%rowtype;
  controls_row public.client_automation_controls%rowtype;
  missing jsonb := '[]'::jsonb;
  next_step_text text;
  onboarding_status text;
  queued_job_id uuid;
begin
  select * into client_row from public.clients where id = target_client_id;
  if not found then
    raise exception 'Client not found.';
  end if;

  if client_row.status::text not in ('approved','active') then
    return jsonb_build_object('ok', false, 'skipped', true, 'reason', 'client_not_approved');
  end if;

  insert into public.client_automation_controls (client_id)
  values (target_client_id)
  on conflict (client_id) do nothing;

  select * into controls_row
  from public.client_automation_controls
  where client_id = target_client_id;

  if controls_row.automation_paused or not controls_row.automation_enabled then
    insert into public.client_onboarding_state (client_id, status, next_step)
    values (target_client_id, 'paused', coalesce(controls_row.pause_reason, 'Automation is paused.'))
    on conflict (client_id) do update
      set status = 'paused',
          next_step = excluded.next_step;

    return jsonb_build_object('ok', true, 'paused', true);
  end if;

  select * into intake_row
  from public.client_intakes
  where client_id = target_client_id
  order by created_at desc
  limit 1;

  select * into project_row
  from public.projects
  where client_id = target_client_id
  order by created_at desc
  limit 1;

  if project_row.id is null then
    insert into public.projects (client_id, project_name, stage, build_plan, next_step)
    values (target_client_id, client_row.business_name || ' Website Project', 'planning', '{}'::jsonb, 'Complete onboarding information.')
    returning * into project_row;
  end if;

  if nullif(trim(coalesce(client_row.contact_name, intake_row.contact_name)), '') is null then
    missing := missing || jsonb_build_array('contact_name');
  end if;
  if nullif(trim(coalesce(client_row.contact_email, intake_row.contact_email)), '') is null then
    missing := missing || jsonb_build_array('contact_email');
  end if;
  if nullif(trim(coalesce(client_row.contact_phone, intake_row.contact_phone)), '') is null then
    missing := missing || jsonb_build_array('contact_phone');
  end if;
  if nullif(trim(coalesce(client_row.business_type, intake_row.business_type)), '') is null then
    missing := missing || jsonb_build_array('business_type');
  end if;
  if nullif(trim(coalesce(client_row.service_area, intake_row.service_area)), '') is null then
    missing := missing || jsonb_build_array('service_area');
  end if;
  if intake_row.id is null or nullif(trim(coalesce(intake_row.services, '')), '') is null then
    missing := missing || jsonb_build_array('services');
  end if;
  if intake_row.id is null or nullif(trim(coalesce(intake_row.goals, '')), '') is null then
    missing := missing || jsonb_build_array('goals');
  end if;
  if intake_row.id is null or nullif(trim(coalesce(intake_row.desired_style, '')), '') is null then
    missing := missing || jsonb_build_array('desired_style');
  end if;

  if jsonb_array_length(missing) > 0 then
    onboarding_status := case when intake_row.id is null then 'waiting_for_intake' else 'needs_information' end;
    next_step_text := 'Complete the missing onboarding information: ' || array_to_string(array(select jsonb_array_elements_text(missing)), ', ') || '.';

    insert into public.client_onboarding_state (client_id, project_id, status, missing_fields, next_step)
    values (target_client_id, project_row.id, onboarding_status, missing, next_step_text)
    on conflict (client_id) do update
      set project_id = excluded.project_id,
          status = excluded.status,
          missing_fields = excluded.missing_fields,
          next_step = excluded.next_step;

    update public.projects
    set stage = case when stage::text in ('intake','owner_review','planning') then 'planning'::public.project_stage else stage end,
        current_blocker = 'Waiting for client onboarding information.',
        next_step = next_step_text
    where id = project_row.id;

    return jsonb_build_object('ok', true, 'status', onboarding_status, 'missing_fields', missing, 'project_id', project_row.id);
  end if;

  next_step_text := 'NXQ is preparing your website build plan.';

  insert into public.client_onboarding_state (
    client_id, project_id, status, missing_fields, next_step, intake_completed_at
  ) values (
    target_client_id, project_row.id, 'ready_for_build_plan', '[]'::jsonb, next_step_text, now()
  )
  on conflict (client_id) do update
    set project_id = excluded.project_id,
        status = case when client_onboarding_state.status in ('build_plan_queued','completed') then client_onboarding_state.status else 'ready_for_build_plan' end,
        missing_fields = '[]'::jsonb,
        next_step = excluded.next_step,
        intake_completed_at = coalesce(client_onboarding_state.intake_completed_at, now());

  update public.projects
  set stage = case when stage::text in ('intake','owner_review') then 'planning'::public.project_stage else stage end,
      current_blocker = null,
      next_step = next_step_text
  where id = project_row.id;

  queued_job_id := public.enqueue_automation_job(
    target_client_id,
    project_row.id,
    'prepare_build_plan',
    'client:' || target_client_id::text || ':prepare-build-plan:v2',
    jsonb_build_object('source', 'deterministic_onboarding_complete', 'requires_ai_worker', true),
    now(),
    30
  );

  update public.client_onboarding_state
  set status = case when queued_job_id is null then status else 'build_plan_queued' end,
      build_plan_queued_at = case when queued_job_id is null then build_plan_queued_at else coalesce(build_plan_queued_at, now()) end
  where client_id = target_client_id;

  insert into public.automation_audit_log (client_id, project_id, automation_job_id, event_type, details)
  values (
    target_client_id,
    project_row.id,
    queued_job_id,
    'onboarding_evaluated',
    jsonb_build_object('status', 'ready_for_build_plan', 'missing_fields', '[]'::jsonb)
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'build_plan_queued',
    'missing_fields', '[]'::jsonb,
    'project_id', project_row.id,
    'automation_job_id', queued_job_id
  );
end;
$$;

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
  reminder_count integer := 0;
  reminder_message text;
begin
  for client_row in
    select id
    from public.clients
    where status::text in ('approved','active')
    order by created_at asc
  loop
    evaluation := public.evaluate_client_onboarding(client_row.id);
    evaluated_count := evaluated_count + 1;

    select * into state_row
    from public.client_onboarding_state
    where client_id = client_row.id;

    if state_row.status in ('waiting_for_intake','needs_information')
       and (state_row.last_reminder_at is null or state_row.last_reminder_at <= now() - interval '3 days') then

      reminder_message := 'Action needed: ' || coalesce(state_row.next_step, 'Please complete your onboarding information.');

      if not exists (
        select 1
        from public.client_messages
        where client_id = client_row.id
          and sender_type::text = 'system'
          and message = reminder_message
          and created_at >= now() - interval '3 days'
      ) then
        insert into public.client_messages (client_id, sender_type, message, needs_owner_review, ai_handled)
        values (client_row.id, 'system', reminder_message, false, true);

        update public.client_onboarding_state
        set reminder_count = reminder_count + 1,
            last_reminder_at = now()
        where client_id = client_row.id;

        insert into public.automation_audit_log (client_id, project_id, event_type, details)
        values (
          client_row.id,
          state_row.project_id,
          'onboarding_reminder_created',
          jsonb_build_object('missing_fields', state_row.missing_fields)
        );

        reminder_count := reminder_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'evaluated_clients', evaluated_count,
    'reminders_created', reminder_count,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.evaluate_client_onboarding(uuid) from public, anon, authenticated;
revoke all on function public.run_onboarding_automation() from public, anon, authenticated;
grant execute on function public.evaluate_client_onboarding(uuid) to service_role;
grant execute on function public.run_onboarding_automation() to service_role;

-- Run onboarding evaluation hourly. Replace only this named job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-onboarding-automation-hourly') then
    perform cron.unschedule('nxq-onboarding-automation-hourly');
  end if;
end;
$$;

select cron.schedule(
  'nxq-onboarding-automation-hourly',
  '17 * * * *',
  $$select public.run_onboarding_automation();$$
);
