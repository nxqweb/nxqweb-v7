-- Route NXQ automation jobs to the correct trusted execution layer.
-- Forward-only. This migration does not call external providers or publish production.

alter table public.automation_jobs
  add column if not exists execution_target text not null default 'backend';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'automation_jobs_execution_target_check'
      and conrelid = 'public.automation_jobs'::regclass
  ) then
    alter table public.automation_jobs
      add constraint automation_jobs_execution_target_check
      check (execution_target in ('backend','edge','ai'));
  end if;
end;
$$;

create index if not exists automation_jobs_target_due_idx
  on public.automation_jobs (execution_target, status, run_after, priority, created_at);

create or replace function public.classify_automation_execution_target()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  requested_target text;
begin
  requested_target := lower(trim(coalesce(new.payload->>'execution_target', '')));

  if requested_target in ('backend','edge','ai') then
    new.execution_target := requested_target;
  elsif new.job_type = 'prepare_build_plan'
        or lower(coalesce(new.payload->>'requires_ai_worker', 'false')) = 'true' then
    new.execution_target := 'ai';
  elsif new.job_type like 'website\_%' escape '\'
        or new.job_type like 'provision\_%' escape '\'
        or lower(coalesce(new.payload->>'requires_external_worker', 'false')) = 'true' then
    new.execution_target := 'edge';
  else
    new.execution_target := 'backend';
  end if;

  return new;
end;
$$;

drop trigger if exists classify_automation_execution_target on public.automation_jobs;
create trigger classify_automation_execution_target
before insert or update of job_type, payload on public.automation_jobs
for each row execute function public.classify_automation_execution_target();

-- Backfill existing jobs into the correct lane.
update public.automation_jobs
set execution_target = case
  when job_type = 'prepare_build_plan'
       or lower(coalesce(payload->>'requires_ai_worker', 'false')) = 'true' then 'ai'
  when job_type like 'website\_%' escape '\'
       or job_type like 'provision\_%' escape '\'
       or lower(coalesce(payload->>'requires_external_worker', 'false')) = 'true' then 'edge'
  else 'backend'
end;

-- The deterministic database worker must never steal provider or AI jobs.
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
    where j.execution_target = 'backend'
      and j.status in ('queued','failed')
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
          select 1
          from public.client_messages
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

      else
        update public.automation_jobs
        set status = 'blocked',
            last_error = 'No deterministic backend handler is registered for this backend job type.',
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
             jsonb_build_object('job_type', job_type, 'execution_target', execution_target, 'status', status, 'attempts', attempts)
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
          jsonb_build_object('job_type', job_row.job_type, 'execution_target', job_row.execution_target, 'error', sqlerrm)
        );
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', processed_count,
    'completed', completed_count,
    'failed', failed_count,
    'execution_target', 'backend',
    'worker', worker_name,
    'ran_at', now()
  );
end;
$$;

-- Shared claim function for trusted Edge and AI workers.
create or replace function public.claim_next_external_automation_job(
  target_execution_target text,
  worker_name text,
  target_job_types text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.automation_jobs%rowtype;
begin
  if target_execution_target not in ('edge','ai') then
    raise exception 'External workers may claim only edge or ai jobs.';
  end if;
  if nullif(trim(worker_name), '') is null then
    raise exception 'Worker name is required.';
  end if;

  select j.* into job_row
  from public.automation_jobs j
  left join public.client_automation_controls controls on controls.client_id = j.client_id
  where j.execution_target = target_execution_target
    and j.status in ('queued','failed')
    and j.run_after <= now()
    and j.attempts < j.max_attempts
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false)
    and (target_job_types is null or j.job_type = any(target_job_types))
    and (j.locked_at is null or j.locked_at < now() - interval '15 minutes')
  order by j.priority asc, j.run_after asc, j.created_at asc
  for update of j skip locked
  limit 1;

  if job_row.id is null then
    return null;
  end if;

  update public.automation_jobs
  set status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = worker_name,
      last_error = null
  where id = job_row.id
  returning * into job_row;

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_claimed',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'attempts', job_row.attempts
    )
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function public.complete_external_automation_job(
  target_job_id uuid,
  worker_name text,
  target_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.automation_jobs%rowtype;
begin
  update public.automation_jobs
  set status = 'completed',
      result = coalesce(target_result, '{}'::jsonb),
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = null
  where id = target_job_id
    and execution_target in ('edge','ai')
    and status = 'running'
    and locked_by = worker_name
  returning * into job_row;

  if job_row.id is null then
    raise exception 'External automation job is not owned by this worker.';
  end if;

  update public.client_automation_controls
  set last_automation_at = now()
  where client_id = job_row.client_id;

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_completed',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name
    )
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function public.fail_external_automation_job(
  target_job_id uuid,
  worker_name text,
  target_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.automation_jobs%rowtype;
  exhausted boolean;
begin
  update public.automation_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      last_error = left(coalesce(target_error, 'Unknown external automation failure.'), 2000),
      run_after = now() + make_interval(mins => least(60, greatest(5, attempts * 5))),
      locked_at = null,
      locked_by = null
  where id = target_job_id
    and execution_target in ('edge','ai')
    and status = 'running'
    and locked_by = worker_name
  returning * into job_row;

  if job_row.id is null then
    raise exception 'External automation job is not owned by this worker.';
  end if;

  exhausted := job_row.attempts >= job_row.max_attempts;

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_failed',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'exhausted', exhausted,
      'error', job_row.last_error
    )
  );

  if exhausted then
    insert into public.automation_escalations (
      client_id, project_id, automation_job_id, escalation_type, severity, title, summary, details
    ) values (
      job_row.client_id,
      job_row.project_id,
      job_row.id,
      'automation_job_exhausted',
      'high',
      'External automation job needs owner attention',
      'An external automation job exhausted its retry limit.',
      jsonb_build_object(
        'job_type', job_row.job_type,
        'execution_target', job_row.execution_target,
        'worker', worker_name,
        'error', job_row.last_error
      )
    );
  end if;

  return to_jsonb(job_row);
end;
$$;

revoke all on function public.claim_next_external_automation_job(text, text, text[]) from public, anon, authenticated;
revoke all on function public.complete_external_automation_job(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_external_automation_job(uuid, text, text) from public, anon, authenticated;

grant execute on function public.claim_next_external_automation_job(text, text, text[]) to service_role;
grant execute on function public.complete_external_automation_job(uuid, text, jsonb) to service_role;
grant execute on function public.fail_external_automation_job(uuid, text, text) to service_role;

comment on column public.automation_jobs.execution_target is
  'Routes work to backend (deterministic database worker), edge (provider/infrastructure worker), or ai (approved AI worker).';
