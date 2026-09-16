-- Preserve external automation retry budget for normal transient provider states.
-- A claimed job consumes one attempt. Waiting for a provider to finish accepted work is
-- not an NXQ execution failure, so release the claim and restore that attempt.

create or replace function public.defer_external_automation_job(
  target_job_id uuid,
  worker_name text,
  target_reason text,
  retry_after interval default interval '30 seconds'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.automation_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if retry_after <= interval '0 seconds' then
    raise exception 'Retry interval must be positive.';
  end if;

  update public.automation_jobs
  set status = 'queued',
      attempts = greatest(attempts - 1, 0),
      run_after = now() + retry_after,
      last_error = left(coalesce(target_reason, 'Transient provider wait.'), 2000),
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = target_job_id
    and execution_target in ('edge','ai')
    and status = 'running'
    and locked_by = worker_name
  returning * into job_row;

  if job_row.id is null then
    raise exception 'External automation job is not owned by this worker.';
  end if;

  insert into public.automation_audit_log (
    client_id,
    project_id,
    automation_job_id,
    event_type,
    actor_type,
    details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_deferred',
    'backend',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'attempts_preserved', job_row.attempts,
      'retry_at', job_row.run_after,
      'reason', job_row.last_error
    )
  );

  return to_jsonb(job_row);
end;
$$;

revoke all on function public.defer_external_automation_job(uuid,text,text,interval) from public, anon, authenticated;
grant execute on function public.defer_external_automation_job(uuid,text,text,interval) to service_role;

comment on function public.defer_external_automation_job(uuid,text,text,interval) is
  'Requeues a claimed Edge/AI job for a normal transient provider wait while restoring the attempt consumed by the claim.';
