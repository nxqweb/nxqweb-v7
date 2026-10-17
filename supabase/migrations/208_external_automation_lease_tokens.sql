-- Token-fenced external automation leases.
-- Adds a backwards-compatible v2 claim/complete/fail/defer contract so launch-critical
-- workers can recover abandoned running jobs without allowing a zombie invocation to
-- mutate a newer claim. Legacy workers remain supported until migrated.

alter table public.automation_jobs
  add column if not exists lock_token uuid;

create index if not exists automation_jobs_stale_tokenized_running_idx
  on public.automation_jobs (execution_target, locked_at, id)
  where status = 'running' and lock_token is not null;

create or replace function public.claim_next_external_automation_job_v2(
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
  lease_token uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
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
      lock_token = lease_token,
      last_error = null
  where id = job_row.id
    and status in ('queued','failed')
  returning * into job_row;

  if job_row.id is null then
    return null;
  end if;

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_claimed_v2',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'lease_token', lease_token,
      'attempts', job_row.attempts
    )
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function public.complete_external_automation_job_v2(
  target_job_id uuid,
  target_lock_token uuid,
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
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if target_lock_token is null then
    raise exception 'Lease token is required.';
  end if;

  update public.automation_jobs
  set status = 'completed',
      result = coalesce(target_result, '{}'::jsonb),
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      lock_token = null,
      last_error = null
  where id = target_job_id
    and execution_target in ('edge','ai')
    and status = 'running'
    and locked_by = worker_name
    and lock_token = target_lock_token
  returning * into job_row;

  if job_row.id is null then
    raise exception 'External automation lease is no longer owned by this invocation.';
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
    'external_job_completed_v2',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'lease_token', target_lock_token
    )
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function public.fail_external_automation_job_v2(
  target_job_id uuid,
  target_lock_token uuid,
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
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if target_lock_token is null then
    raise exception 'Lease token is required.';
  end if;

  update public.automation_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      last_error = left(coalesce(target_error, 'Unknown external automation failure.'), 2000),
      run_after = now() + make_interval(mins => least(60, greatest(5, attempts * 5))),
      locked_at = null,
      locked_by = null,
      lock_token = null
  where id = target_job_id
    and execution_target in ('edge','ai')
    and status = 'running'
    and locked_by = worker_name
    and lock_token = target_lock_token
  returning * into job_row;

  if job_row.id is null then
    raise exception 'External automation lease is no longer owned by this invocation.';
  end if;

  exhausted := job_row.attempts >= job_row.max_attempts;

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_failed_v2',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'lease_token', target_lock_token,
      'exhausted', exhausted,
      'error', job_row.last_error
    )
  );

  if exhausted and not exists (
    select 1 from public.automation_escalations e
    where e.automation_job_id = job_row.id
      and e.escalation_type = 'automation_job_exhausted'
      and e.status in ('open','acknowledged')
  ) then
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

create or replace function public.defer_external_automation_job_v2(
  target_job_id uuid,
  target_lock_token uuid,
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
  if target_lock_token is null then
    raise exception 'Lease token is required.';
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
      lock_token = null,
      updated_at = now()
  where id = target_job_id
    and execution_target in ('edge','ai')
    and status = 'running'
    and locked_by = worker_name
    and lock_token = target_lock_token
  returning * into job_row;

  if job_row.id is null then
    raise exception 'External automation lease is no longer owned by this invocation.';
  end if;

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, actor_type, details
  ) values (
    job_row.client_id,
    job_row.project_id,
    job_row.id,
    'external_job_deferred_v2',
    'backend',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'lease_token', target_lock_token,
      'attempts_preserved', job_row.attempts,
      'retry_at', job_row.run_after,
      'reason', job_row.last_error
    )
  );

  return to_jsonb(job_row);
end;
$$;

create or replace function public.recover_stale_tokenized_external_jobs(
  stale_after interval default interval '20 minutes',
  batch_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recovered_count integer := 0;
  exhausted_count integer := 0;
  job_row public.automation_jobs%rowtype;
begin
  if current_user not in ('postgres','service_role','supabase_admin') and auth.role() <> 'service_role' then
    raise exception 'Trusted backend access required.';
  end if;
  if stale_after < interval '5 minutes' then
    raise exception 'Stale lease threshold must be at least five minutes.';
  end if;

  for job_row in
    select j.*
    from public.automation_jobs j
    where j.execution_target in ('edge','ai')
      and j.status = 'running'
      and j.lock_token is not null
      and j.locked_at < now() - stale_after
    order by j.locked_at asc
    limit greatest(1, least(coalesce(batch_size,100),500))
    for update skip locked
  loop
    if job_row.attempts >= job_row.max_attempts then
      update public.automation_jobs
      set status = 'failed',
          last_error = left(coalesce(job_row.last_error || ' | ', '') || 'Lease expired after worker stopped responding.', 2000),
          locked_at = null,
          locked_by = null,
          lock_token = null
      where id = job_row.id and lock_token = job_row.lock_token;
      exhausted_count := exhausted_count + 1;
    else
      update public.automation_jobs
      set status = 'queued',
          run_after = now() + interval '30 seconds',
          last_error = left(coalesce(job_row.last_error || ' | ', '') || 'Recovered abandoned external worker lease.', 2000),
          locked_at = null,
          locked_by = null,
          lock_token = null
      where id = job_row.id and lock_token = job_row.lock_token;
      recovered_count := recovered_count + 1;
    end if;

    insert into public.automation_audit_log (
      client_id, project_id, automation_job_id, event_type, actor_type, details
    ) values (
      job_row.client_id,
      job_row.project_id,
      job_row.id,
      'stale_external_lease_recovered',
      'backend',
      jsonb_build_object(
        'job_type', job_row.job_type,
        'execution_target', job_row.execution_target,
        'worker', job_row.locked_by,
        'expired_lease_token', job_row.lock_token,
        'locked_at', job_row.locked_at,
        'attempts', job_row.attempts,
        'max_attempts', job_row.max_attempts
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'recovered', recovered_count,
    'exhausted', exhausted_count,
    'stale_after_seconds', extract(epoch from stale_after)::integer,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.claim_next_external_automation_job_v2(text,text,text[]) from public, anon, authenticated;
revoke all on function public.complete_external_automation_job_v2(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_external_automation_job_v2(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.defer_external_automation_job_v2(uuid,uuid,text,text,interval) from public, anon, authenticated;
revoke all on function public.recover_stale_tokenized_external_jobs(interval,integer) from public, anon, authenticated;

grant execute on function public.claim_next_external_automation_job_v2(text,text,text[]) to service_role;
grant execute on function public.complete_external_automation_job_v2(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.fail_external_automation_job_v2(uuid,uuid,text,text) to service_role;
grant execute on function public.defer_external_automation_job_v2(uuid,uuid,text,text,interval) to service_role;
grant execute on function public.recover_stale_tokenized_external_jobs(interval,integer) to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-recover-stale-tokenized-external-jobs') then
    perform cron.unschedule('nxq-recover-stale-tokenized-external-jobs');
  end if;
end $$;

select cron.schedule(
  'nxq-recover-stale-tokenized-external-jobs',
  '*/5 * * * *',
  $cron$ select public.recover_stale_tokenized_external_jobs(interval '20 minutes', 100); $cron$
);

comment on column public.automation_jobs.lock_token is
  'Unique lease generation for token-fenced Edge/AI claims. A stale invocation cannot complete/fail/defer a newer lease.';
