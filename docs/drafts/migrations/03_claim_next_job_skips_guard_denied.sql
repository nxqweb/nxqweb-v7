-- DRAFT (not a real migration). One paid-capability denial must not block the whole external job queue.
--
-- Problem (seen 2026-10-07): claim_next_external_automation_job_v2 picks the front job, then sets it to 'running'. Migration 246's trigger
-- nxq_guard_external_job_transition refuses that transition for a client without paid capability (e.g. a real client with billing not active).
-- The exception aborts the whole claim, the front job stays at the front, and every job behind it (including other clients') is blocked until
-- someone pauses the denied client by hand (four stuck prepare_build_plan jobs, run #1 of the QA work).
--
-- Fix: try up to 25 candidates in order. If the guard (or the platform cost / usage blockers behind it) refuses a candidate, record the reason on
-- that job, push its run_after back 15 minutes (status and attempts untouched, so it is retried later and the owner can see why) and try the next
-- one. Any other error is re-raised unchanged. Everything else (service-role check, eligibility rules, audit log, return shape) is identical to 208.
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
  candidate record;
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

  for candidate in
    select j.id
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
    limit 25
  loop
    begin
      update public.automation_jobs
      set status = 'running',
          attempts = attempts + 1,
          locked_at = now(),
          locked_by = worker_name,
          lock_token = lease_token,
          last_error = null
      where id = candidate.id
        and status in ('queued','failed')
      returning * into job_row;
    exception when others then
      -- Only the paid-capability / cost guards are skipped. Anything else is a real fault and must surface.
      if sqlerrm !~* '(capability denied|METERING_POLICY_BLOCKER|PLATFORM_COST_BLOCKER|usage limit|capability|entitlement)' then
        raise;
      end if;
      update public.automation_jobs
      set last_error = left('Skipped by billing guard: ' || sqlerrm, 2000),
          run_after = now() + interval '15 minutes'
      where id = candidate.id;
      job_row := null;
      continue;
    end;

    if job_row.id is null then
      continue;
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
  end loop;

  return null;
end;
$$;

revoke all on function public.claim_next_external_automation_job_v2(text,text,text[]) from public, anon, authenticated;
grant execute on function public.claim_next_external_automation_job_v2(text,text,text[]) to service_role;
