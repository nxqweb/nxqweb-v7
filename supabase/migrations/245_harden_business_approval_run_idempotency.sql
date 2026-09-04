-- Harden the Business APPROVE handoff and website-run bootstrap idempotency.
--
-- This forward-only repair removes the duplicate legacy Business build-plan enqueue,
-- evaluates the accepted intake immediately, and makes the scheduled website bootstrap
-- intent-driven. It does not call providers, Netlify, billing, or production.

create or replace function public.bootstrap_approved_client_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_project_id uuid;
  family_slug text;
  onboarding_result jsonb;
begin
  if new.status::text <> 'approved'
     or (tg_op = 'UPDATE' and old.status::text is not distinct from new.status::text) then
    return new;
  end if;

  select coalesce(pf.slug, 'business') into family_slug
  from public.clients c
  left join public.product_families pf on pf.id = c.product_family_id
  where c.id = new.id;

  family_slug := coalesce(family_slug, 'business');

  -- Business automation may start only from the single accepted website-setup
  -- decision. A direct client-status mutation is not an approval substitute.
  if family_slug = 'business' and (
    new.pipeline_stopped_at is not null
    or not exists (
      select 1
      from public.owner_approval_requests approval
      where approval.client_id = new.id
        and approval.request_type = 'website_setup_review'
        and approval.status::text = 'accepted'
    )
  ) then
    insert into public.automation_audit_log (client_id, event_type, actor_type, details)
    values (
      new.id,
      'client_automation_bootstrap_blocked',
      'backend',
      jsonb_build_object(
        'reason', case when new.pipeline_stopped_at is not null
          then 'pipeline_stopped'
          else 'accepted_owner_approval_required'
        end,
        'product_family_slug', family_slug
      )
    );
    return new;
  end if;

  insert into public.client_automation_controls (
    client_id, automation_enabled, automation_paused, approved_for_automation_at
  ) values (
    new.id, true, false, now()
  )
  on conflict (client_id) do update
    set automation_enabled = true,
        approved_for_automation_at = coalesce(
          public.client_automation_controls.approved_for_automation_at,
          now()
        ),
        updated_at = now();

  if family_slug = 'business' then
    -- The accepted report was materialized before the client status changed.
    -- Evaluate it now so one project and the canonical v2 plan job are ready
    -- immediately; the hourly evaluator remains a recovery/reconciliation lane.
    onboarding_result := public.evaluate_client_onboarding(new.id);
  end if;

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

  -- Preserve the legacy non-Business lane. Business receives only the canonical
  -- prepare-build-plan:v2 job from evaluate_client_onboarding().
  if family_slug <> 'business' then
    perform public.enqueue_automation_job(
      new.id,
      latest_project_id,
      'prepare_build_plan',
      'client:' || new.id::text || ':prepare-build-plan:v1',
      jsonb_build_object('source', 'owner_client_approval', 'requires_ai_worker', true),
      now(),
      30
    );
  end if;

  insert into public.automation_audit_log (client_id, project_id, event_type, actor_type, details)
  values (
    new.id,
    latest_project_id,
    'client_automation_bootstrapped',
    'backend',
    jsonb_build_object(
      'client_status', new.status::text,
      'product_family_slug', family_slug,
      'canonical_business_build_plan_key', case when family_slug = 'business'
        then 'client:' || new.id::text || ':prepare-build-plan:v2'
        else null
      end,
      'onboarding_status', onboarding_result ->> 'status'
    )
  );

  return new;
end;
$$;

revoke all on function public.bootstrap_approved_client_automation()
from public, anon, authenticated;

comment on function public.bootstrap_approved_client_automation() is
  'Starts approved-client automation once. Business requires accepted owner setup approval and queues only the canonical v2 build-plan job through immediate onboarding evaluation.';

create or replace function public.bootstrap_ready_website_automation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row record;
  run_id uuid;
  change_request_id uuid;
  created_count integer := 0;
  safe_branch text;
  plan_version text;
  run_source text;
begin
  for project_row in
    select p.id as project_id, p.client_id, p.build_plan
    from public.projects p
    join public.clients c on c.id = p.client_id
    left join public.client_automation_controls controls on controls.client_id = c.id
    where c.status::text in ('approved', 'active')
      and c.pipeline_stopped_at is null
      and coalesce(jsonb_typeof(p.build_plan), 'null') = 'object'
      and p.build_plan <> '{}'::jsonb
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
      and exists (
        select 1
        from public.owner_approval_requests approval
        where approval.client_id = c.id
          and approval.request_type = 'website_setup_review'
          and approval.status::text = 'accepted'
      )
      and not exists (
        select 1
        from public.website_automation_runs active_run
        where active_run.project_id = p.id
          and active_run.status not in ('published', 'failed', 'cancelled')
      )
      and (
        not exists (
          select 1 from public.website_automation_runs historical_run
          where historical_run.project_id = p.id
        )
        or exists (
          select 1
          from public.website_change_requests change_request
          where change_request.project_id = p.id
            and change_request.client_id = p.client_id
            and change_request.status = 'queued'
            and coalesce((change_request.automation_plan ->> 'atomic_change_applied')::boolean, false)
            and nullif(change_request.automation_plan ->> 'website_automation_run_id', '') is null
        )
      )
    order by p.created_at asc
  loop
    -- Serialize bootstrap decisions per project. The cron lane and an Edge worker
    -- may call this function at the same time; only one may reserve the next run.
    perform pg_advisory_xact_lock(hashtextextended(project_row.project_id::text, 0));

    if exists (
      select 1
      from public.website_automation_runs active_run
      where active_run.project_id = project_row.project_id
        and active_run.status not in ('published', 'failed', 'cancelled')
    ) then
      continue;
    end if;

    change_request_id := null;
    if exists (
      select 1 from public.website_automation_runs historical_run
      where historical_run.project_id = project_row.project_id
    ) then
      select change_request.id into change_request_id
      from public.website_change_requests change_request
      where change_request.project_id = project_row.project_id
        and change_request.client_id = project_row.client_id
        and change_request.status = 'queued'
        and coalesce((change_request.automation_plan ->> 'atomic_change_applied')::boolean, false)
        and nullif(change_request.automation_plan ->> 'website_automation_run_id', '') is null
      order by change_request.created_at asc
      for update
      limit 1;

      -- Published, failed, and cancelled runs are terminal. Scheduled polling may
      -- create a successor only for a specifically applied queued change request.
      if change_request_id is null then
        continue;
      end if;
    end if;

    plan_version := coalesce(nullif(btrim(project_row.build_plan ->> 'version'), ''), 'v1');
    run_source := case when change_request_id is null
      then 'initial_approved_build'
      else 'explicit_structured_change'
    end;
    safe_branch := 'nxq/client-' || replace(project_row.client_id::text, '-', '') || '-build';

    insert into public.website_automation_runs (
      client_id, project_id, status, source_branch, base_branch,
      current_step, build_plan_version, started_at
    ) values (
      project_row.client_id, project_row.project_id, 'queued', safe_branch, 'main',
      'prepare_safe_branch', plan_version, now()
    ) returning id into run_id;

    insert into public.website_automation_steps (
      run_id, step_key, step_order, status, requires_external_worker, idempotency_key, input
    ) values
      (run_id, 'prepare_safe_branch', 10, 'queued', true,
       'website-run:' || run_id::text || ':prepare-safe-branch:v1',
       jsonb_build_object('source_branch', safe_branch, 'base_branch', 'main')),
      (run_id, 'generate_website_draft', 20, 'pending', true,
       'website-run:' || run_id::text || ':generate-website-draft:v1',
       jsonb_build_object('build_plan', project_row.build_plan)),
      (run_id, 'run_quality_checks', 30, 'pending', true,
       'website-run:' || run_id::text || ':run-quality-checks:v1', '{}'::jsonb),
      (run_id, 'prepare_preview_request', 40, 'pending', false,
       'website-run:' || run_id::text || ':prepare-preview-request:v1', '{}'::jsonb),
      (run_id, 'client_review', 50, 'pending', false,
       'website-run:' || run_id::text || ':client-review:v1', '{}'::jsonb),
      (run_id, 'prepare_production_audit', 60, 'pending', false,
       'website-run:' || run_id::text || ':prepare-production-audit:v1', '{}'::jsonb),
      (run_id, 'owner_publication_gate', 70, 'pending', false,
       'website-run:' || run_id::text || ':owner-publication-gate:v1',
       jsonb_build_object('auto_publish', false, 'main_merge_allowed', false));

    if change_request_id is not null then
      update public.website_change_requests
      set automation_plan = coalesce(automation_plan, '{}'::jsonb) || jsonb_build_object(
            'website_automation_run_id', run_id,
            'bootstrap_reserved', true,
            'bootstrap_source', run_source
          ),
          updated_at = now()
      where id = change_request_id
        and client_id = project_row.client_id
        and project_id = project_row.project_id
        and status = 'queued';
    end if;

    perform public.enqueue_automation_job(
      project_row.client_id,
      project_row.project_id,
      'website_prepare_safe_branch',
      'website-run:' || run_id::text || ':queue-prepare-safe-branch:v1',
      jsonb_build_object(
        'website_automation_run_id', run_id,
        'source_branch', safe_branch,
        'base_branch', 'main',
        'bootstrap_source', run_source,
        'change_request_id', change_request_id
      ),
      now(),
      40
    );

    insert into public.automation_audit_log (
      client_id, project_id, event_type, actor_type, details
    ) values (
      project_row.client_id,
      project_row.project_id,
      'website_automation_run_created',
      'backend',
      jsonb_build_object(
        'run_id', run_id,
        'source_branch', safe_branch,
        'base_branch', 'main',
        'build_plan_version', plan_version,
        'bootstrap_source', run_source,
        'change_request_id', change_request_id,
        'auto_publish', false,
        'main_merge_allowed', false
      )
    );

    created_count := created_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created_runs', created_count,
    'scheduled_terminal_replays_allowed', false,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.bootstrap_ready_website_automation()
from public, anon, authenticated;
grant execute on function public.bootstrap_ready_website_automation()
to service_role;

comment on function public.bootstrap_ready_website_automation() is
  'Creates one initial approved website run. After a terminal run, only a specifically applied queued structured change may reserve a successor; scheduled polling alone never creates one.';

