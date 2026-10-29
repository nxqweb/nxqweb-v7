-- Instrument shared worker claim paths with health heartbeats.
-- This avoids duplicating heartbeat logic across every Edge Function.

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

  perform public.record_worker_heartbeat(
    worker_name,
    target_execution_target,
    'healthy',
    jsonb_build_object('claim_invoked_at', now(), 'job_types', coalesce(to_jsonb(target_job_types), 'null'::jsonb)),
    null
  );

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

create or replace function public.claim_next_website_maintenance_task(worker_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.website_maintenance_tasks%rowtype;
begin
  if nullif(btrim(worker_name), '') is null then
    raise exception 'Worker name is required.';
  end if;

  perform public.record_worker_heartbeat(
    worker_name,
    'edge',
    'healthy',
    jsonb_build_object('maintenance_claim_invoked_at', now()),
    null
  );

  select t.* into task_row
  from public.website_maintenance_tasks t
  join public.website_maintenance_plans p on p.id = t.maintenance_plan_id
  left join public.client_automation_controls controls on controls.client_id = t.client_id
  where t.status in ('queued','failed')
    and t.scheduled_for <= now()
    and t.attempts < t.max_attempts
    and t.provider_connected = true
    and t.task_type in (
      'uptime_check','ssl_check','form_test','broken_link_scan',
      'security_scan','seo_check','backup_check','monthly_report'
    )
    and p.status = 'active'
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false)
  order by t.priority asc, t.scheduled_for asc, t.created_at asc
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update public.website_maintenance_tasks
  set status = 'running',
      started_at = now(),
      attempts = attempts + 1,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'worker_name', worker_name,
        'claimed_at', now()
      ),
      last_error = null,
      updated_at = now()
  where id = task_row.id
  returning * into task_row;

  insert into public.automation_audit_log (client_id, project_id, event_type, details)
  values (
    task_row.client_id,
    task_row.project_id,
    'website_maintenance_task_claimed',
    jsonb_build_object('task_id', task_row.id, 'task_type', task_row.task_type, 'worker_name', worker_name, 'attempt', task_row.attempts)
  );

  return to_jsonb(task_row);
end;
$$;

-- Backend deterministic worker is also instrumented for operator visibility.
create or replace function public.record_backend_worker_presence(worker_name text default 'nxq-backend-worker')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_worker_heartbeat(
    worker_name,
    'backend',
    'healthy',
    jsonb_build_object('presence_recorded_at', now()),
    null
  );
end;
$$;

revoke all on function public.record_backend_worker_presence(text) from public, anon, authenticated;
grant execute on function public.record_backend_worker_presence(text) to service_role;

comment on function public.claim_next_external_automation_job(text,text,text[]) is
  'Shared Edge/AI job claim. Every invocation records a worker heartbeat before attempting to claim work.';
comment on function public.claim_next_website_maintenance_task(text) is
  'Maintenance claim path with integrated worker heartbeat instrumentation.';
