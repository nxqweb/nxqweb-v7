-- Recover only Business preview-preparation jobs that failed because Netlify's
-- Sites API no longer accepts environment-variable data echoed back through
-- build_settings. The worker fix now PATCHes only allowed_branches + stop_builds.

update public.automation_jobs aj
set
  status = 'queued',
  attempts = 0,
  run_after = now(),
  locked_at = null,
  locked_by = null,
  lock_token = null,
  last_error = null,
  updated_at = now()
where aj.job_type = 'website_prepare_safe_branch'
  and aj.execution_target = 'edge'
  and aj.status in ('failed', 'blocked')
  and coalesce(aj.last_error, '') like 'Netlify preview build activation failed (400): Site using new environment variables experience.%'
  and exists (
    select 1
    from public.clients c
    where c.id = aj.client_id
      and c.status::text in ('approved', 'active')
      and c.pipeline_stopped_at is null
  )
  and exists (
    select 1
    from public.owner_approval_requests ar
    where ar.client_id = aj.client_id
      and ar.request_type = 'website_setup_review'
      and ar.status::text = 'accepted'
  );

insert into public.automation_audit_log(event_type, actor_type, details)
values (
  'netlify_preview_activation_recovery_applied',
  'system',
  jsonb_build_object(
    'reason', 'Netlify Sites API no longer accepts environment variables in build_settings updates',
    'recovery_scope', 'website_prepare_safe_branch exact legacy Netlify 400 only',
    'worker_fix_required', 'build-business-website PATCHes only allowed_branches and stop_builds',
    'applied_at', now()
  )
);
