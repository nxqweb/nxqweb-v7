-- NXQ Web backend automation foundation
-- Durable, idempotent, owner-visible automation queue.
-- This migration does not connect a payment processor or send external email/SMS.

create extension if not exists pg_cron;

create table if not exists public.client_automation_controls (
  client_id uuid primary key references public.clients(id) on delete cascade,
  automation_enabled boolean not null default true,
  automation_paused boolean not null default false,
  pause_reason text,
  approved_for_automation_at timestamptz,
  last_automation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled','blocked')),
  priority integer not null default 100,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_jobs_due_idx
  on public.automation_jobs (status, run_after, priority, created_at);
create index if not exists automation_jobs_client_idx
  on public.automation_jobs (client_id, created_at desc);

create table if not exists public.automation_escalations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  automation_job_id uuid references public.automation_jobs(id) on delete set null,
  escalation_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  title text not null,
  summary text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.automation_audit_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  automation_job_id uuid references public.automation_jobs(id) on delete set null,
  event_type text not null,
  actor_type text not null default 'backend',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.client_automation_controls enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.automation_escalations enable row level security;
alter table public.automation_audit_log enable row level security;

drop policy if exists "Owner can manage client automation controls" on public.client_automation_controls;
create policy "Owner can manage client automation controls"
on public.client_automation_controls for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists "Owner can manage automation jobs" on public.automation_jobs;
create policy "Owner can manage automation jobs"
on public.automation_jobs for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists "Owner can manage automation escalations" on public.automation_escalations;
create policy "Owner can manage automation escalations"
on public.automation_escalations for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists "Owner can read automation audit log" on public.automation_audit_log;
create policy "Owner can read automation audit log"
on public.automation_audit_log for select to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

create or replace function public.touch_automation_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_client_automation_controls on public.client_automation_controls;
create trigger touch_client_automation_controls
before update on public.client_automation_controls
for each row execute function public.touch_automation_updated_at();

drop trigger if exists touch_automation_jobs on public.automation_jobs;
create trigger touch_automation_jobs
before update on public.automation_jobs
for each row execute function public.touch_automation_updated_at();

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
      jsonb_build_object('job_type', target_job_type, 'reason', coalesce(controls_row.pause_reason, 'automation disabled or paused'))
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
  on conflict (idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into job_id;

  insert into public.automation_audit_log (client_id, project_id, automation_job_id, event_type, details)
  values (
    target_client_id,
    target_project_id,
    job_id,
    'job_enqueued',
    jsonb_build_object('job_type', target_job_type, 'idempotency_key', target_idempotency_key)
  );

  return job_id;
end;
$$;

create or replace function public.bootstrap_approved_client_automation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  latest_project_id uuid;
begin
  if new.status::text = 'approved'
     and (tg_op = 'INSERT' or old.status::text is distinct from new.status::text) then

    insert into public.client_automation_controls (
      client_id, automation_enabled, automation_paused, approved_for_automation_at
    ) values (
      new.id, true, false, now()
    )
    on conflict (client_id) do update
      set automation_enabled = true,
          approved_for_automation_at = coalesce(public.client_automation_controls.approved_for_automation_at, now()),
          updated_at = now();

    select id into latest_project_id
    from public.projects
    where client_id = new.id
    order by created_at desc
    limit 1;

    perform public.enqueue_automation_job(
      new.id,
      latest_project_id,
      'ensure_project_workspace',
      'client:' || new.id::text || ':ensure-project-workspace:v1',
      jsonb_build_object('source', 'owner_client_approval'),
      now(),
      10
    );

    perform public.enqueue_automation_job(
      new.id,
      latest_project_id,
      'create_onboarding_welcome',
      'client:' || new.id::text || ':onboarding-welcome:v1',
      jsonb_build_object('source', 'owner_client_approval'),
      now(),
      20
    );

    perform public.enqueue_automation_job(
      new.id,
      latest_project_id,
      'prepare_build_plan',
      'client:' || new.id::text || ':prepare-build-plan:v1',
      jsonb_build_object('source', 'owner_client_approval', 'requires_ai_worker', true),
      now(),
      30
    );

    insert into public.automation_audit_log (client_id, project_id, event_type, details)
    values (
      new.id,
      latest_project_id,
      'client_automation_bootstrapped',
      jsonb_build_object('client_status', new.status::text)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists bootstrap_client_automation_after_approval on public.clients;
create trigger bootstrap_client_automation_after_approval
after insert or update of status on public.clients
for each row execute function public.bootstrap_approved_client_automation();

create or replace function public.run_automation_worker(worker_name text default 'nxq-backend-worker')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  job_row public.automation_jobs%rowtype;
  controls_row public.client_automation_controls%rowtype;
  processed_count integer := 0;
  completed_count integer := 0;
  failed_count integer := 0;
  active_project_id uuid;
begin
  for job_row in
    select j.*
    from public.automation_jobs j
    where j.status in ('queued','failed')
      and j.run_after <= now()
      and j.attempts < j.max_attempts
    order by j.priority asc, j.run_after asc, j.created_at asc
    limit 25
    for update skip locked
  loop
    processed_count := processed_count + 1;

    select * into controls_row
    from public.client_automation_controls
    where client_id = job_row.client_id;

    if controls_row.automation_paused or not controls_row.automation_enabled then
      update public.automation_jobs
      set status = 'blocked', last_error = coalesce(controls_row.pause_reason, 'Client automation is paused or disabled.')
      where id = job_row.id;
      continue;
    end if;

    update public.automation_jobs
    set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = worker_name, last_error = null
    where id = job_row.id;

    begin
      if job_row.job_type = 'ensure_project_workspace' then
        select id into active_project_id
        from public.projects
        where client_id = job_row.client_id
        order by created_at desc
        limit 1;

        if active_project_id is null then
          insert into public.projects (client_id, project_name, stage, build_plan)
          select id, business_name || ' Website Project', 'planning', '{}'::jsonb
          from public.clients
          where id = job_row.client_id
          returning id into active_project_id;
        end if;

        update public.automation_jobs
        set project_id = active_project_id,
            status = 'completed',
            result = jsonb_build_object('project_id', active_project_id, 'workspace_ready', true),
            completed_at = now(), locked_at = null, locked_by = null
        where id = job_row.id;

      elsif job_row.job_type = 'create_onboarding_welcome' then
        if not exists (
          select 1 from public.client_messages
          where client_id = job_row.client_id
            and sender_type::text = 'system'
            and message = 'Your project is approved. NXQ has started your onboarding workflow and will show your next required step in the Client Portal.'
        ) then
          insert into public.client_messages (client_id, sender_type, message, needs_owner_review, ai_handled)
          values (
            job_row.client_id,
            'system',
            'Your project is approved. NXQ has started your onboarding workflow and will show your next required step in the Client Portal.',
            false,
            true
          );
        end if;

        update public.automation_jobs
        set status = 'completed',
            result = jsonb_build_object('welcome_created', true),
            completed_at = now(), locked_at = null, locked_by = null
        where id = job_row.id;

      elsif job_row.job_type = 'prepare_build_plan' then
        -- AI execution is intentionally delegated to a separately connected worker.
        update public.automation_jobs
        set status = 'blocked',
            last_error = 'Waiting for the approved AI build-plan worker connection.',
            locked_at = null, locked_by = null
        where id = job_row.id;

      else
        update public.automation_jobs
        set status = 'blocked',
            last_error = 'No deterministic backend handler is registered for this job type.',
            locked_at = null, locked_by = null
        where id = job_row.id;
      end if;

      if exists (select 1 from public.automation_jobs where id = job_row.id and status = 'completed') then
        completed_count := completed_count + 1;
        update public.client_automation_controls
        set last_automation_at = now()
        where client_id = job_row.client_id;
      end if;

      insert into public.automation_audit_log (client_id, project_id, automation_job_id, event_type, details)
      select client_id, project_id, id, 'job_worker_result',
             jsonb_build_object('job_type', job_type, 'status', status, 'attempts', attempts)
      from public.automation_jobs where id = job_row.id;

    exception when others then
      failed_count := failed_count + 1;

      update public.automation_jobs
      set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
          last_error = sqlerrm,
          run_after = now() + make_interval(mins => least(60, greatest(5, attempts * 5))),
          locked_at = null,
          locked_by = null
      where id = job_row.id;

      if (select attempts >= max_attempts from public.automation_jobs where id = job_row.id) then
        insert into public.automation_escalations (
          client_id, project_id, automation_job_id, escalation_type, severity, title, summary, details
        ) values (
          job_row.client_id,
          job_row.project_id,
          job_row.id,
          'automation_job_exhausted',
          'high',
          'Automation job needs owner attention',
          'A backend automation job exhausted its retry limit.',
          jsonb_build_object('job_type', job_row.job_type, 'error', sqlerrm)
        );
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', processed_count,
    'completed', completed_count,
    'failed', failed_count,
    'worker', worker_name,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz, integer) from public, anon;
revoke all on function public.run_automation_worker(text) from public, anon;

-- Owner may manually enqueue or run a test worker from authenticated tools.
grant execute on function public.enqueue_automation_job(uuid, uuid, text, text, jsonb, timestamptz, integer) to authenticated;
grant execute on function public.run_automation_worker(text) to authenticated;

-- Replace only this named job; do not disturb unrelated cron jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-automation-worker-every-5-minutes') then
    perform cron.unschedule('nxq-automation-worker-every-5-minutes');
  end if;
end;
$$;

select cron.schedule(
  'nxq-automation-worker-every-5-minutes',
  '*/5 * * * *',
  $$select public.run_automation_worker('pg-cron');$$
);
