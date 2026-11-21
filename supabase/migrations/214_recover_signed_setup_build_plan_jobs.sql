-- Recover build-plan jobs stranded by the legacy client_intakes/current signed setup report handoff mismatch.
-- This is intentionally narrow: only the exact historical validation error is requeued.

with recovered as (
  update public.automation_jobs j
  set status = 'queued',
      attempts = 0,
      run_after = now(),
      locked_at = null,
      locked_by = null,
      lock_token = null,
      last_error = null,
      updated_at = now()
  from public.clients c
  where j.client_id = c.id
    and j.job_type = 'prepare_build_plan'
    and j.execution_target = 'ai'
    and j.status in ('failed', 'blocked')
    and j.last_error = 'Approved intake is missing required Business build-plan content.'
    and c.status::text in ('approved', 'active')
    and c.pipeline_stopped_at is null
    and coalesce(c.notes, '') like 'NXQ WEB WEBSITE SETUP REPORT%'
    and exists (
      select 1
      from public.owner_approval_requests ar
      where ar.client_id = c.id
        and ar.request_type = 'website_setup_review'
        and ar.status::text = 'accepted'
    )
  returning j.id, j.client_id, j.project_id
)
insert into public.automation_audit_log (client_id, project_id, event_type, actor_type, details)
select
  r.client_id,
  r.project_id,
  'signed_setup_build_plan_job_recovered',
  'backend',
  jsonb_build_object(
    'job_id', r.id,
    'reason', 'legacy_client_intakes_current_setup_handoff_mismatch',
    'retry_budget_reset', true,
    'recovered_at', now()
  )
from recovered r;

comment on table public.automation_jobs is
  'NXQ automation queue. Signed website setup build-plan jobs stranded by the legacy intake handoff are recovered by migration 214 using the exact historical failure signature only.';
