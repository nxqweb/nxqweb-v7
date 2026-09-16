-- NXQ runtime hardening discovered during end-to-end Business QA.
-- 1) Preserve retry budget while an external provider is billing/credit blocked.
-- 2) Restore narrowly-scoped authenticated read grants where RLS already protects owner/client rows.

-- CLIENT FILE METADATA
-- The client portal reads client_files directly. RLS remains the tenant boundary.
alter table public.client_files enable row level security;
grant select on public.client_files to authenticated;

drop policy if exists "Clients can read own client files" on public.client_files;
create policy "Clients can read own client files"
on public.client_files
for select
to authenticated
using (
  exists (
    select 1
    from public.clients c
    where c.id = client_files.client_id
      and c.auth_user_id = auth.uid()
  )
);

-- Owner read policy already exists from migration 016; the table-level grant is required
-- before PostgreSQL can reach that RLS policy.

-- WORKER HEARTBEATS
-- The owner Automation Health page reads this table directly. Existing RLS only admits owner_users.
grant select on public.automation_worker_heartbeats to authenticated;

-- PROVIDER BILLING/CREDIT DEFERRAL
-- External job claim increments attempts. A provider-account blocker is not an NXQ execution failure,
-- so defer it without consuming the retry budget.
create or replace function public.defer_external_provider_billing_job(
  target_job_id uuid,
  worker_name text,
  target_error text,
  retry_after interval default interval '24 hours'
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
      last_error = left(coalesce(target_error, 'EXTERNAL_PROVIDER_BILLING_BLOCKER'), 2000),
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
    'external_provider_billing_deferred',
    'backend',
    jsonb_build_object(
      'job_type', job_row.job_type,
      'execution_target', job_row.execution_target,
      'worker', worker_name,
      'attempts_preserved', job_row.attempts,
      'retry_at', job_row.run_after,
      'error', job_row.last_error
    )
  );

  return to_jsonb(job_row);
end;
$$;

revoke all on function public.defer_external_provider_billing_job(uuid,text,text,interval) from public, anon, authenticated;
grant execute on function public.defer_external_provider_billing_job(uuid,text,text,interval) to service_role;

comment on function public.defer_external_provider_billing_job(uuid,text,text,interval) is
  'Defers a claimed external automation job for provider billing/credit limits while restoring the attempt consumed by the claim.';
