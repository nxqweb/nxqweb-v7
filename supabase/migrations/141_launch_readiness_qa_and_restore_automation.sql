-- Evidence-driven QA, restore-point simulation, and launch-readiness evaluation.
-- This layer is deliberately non-destructive: restore simulations verify recovery metadata
-- but never rewrite GitHub, Netlify, DNS, or production state.

create extension if not exists pgcrypto;

create table if not exists public.qa_lifecycle_runs (
  id uuid primary key default gen_random_uuid(),
  run_code text not null unique default ('QA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  test_kind text not null check (test_kind in (
    'business_e2e','deny_path','tenant_isolation','storage_isolation','domain_ssl',
    'maintenance_recovery','backup_restore','provider_failure','billing_lifecycle','other'
  )),
  status text not null default 'running' check (status in ('running','passed','failed','blocked','cancelled')),
  disposable boolean not null default true,
  sequence_group text,
  sequence_number integer,
  evidence jsonb not null default '{}'::jsonb,
  failure_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (sequence_number is null or sequence_number > 0)
);

create index if not exists qa_lifecycle_runs_kind_status_idx
  on public.qa_lifecycle_runs(test_kind, status, completed_at desc);
create index if not exists qa_lifecycle_runs_sequence_idx
  on public.qa_lifecycle_runs(sequence_group, sequence_number)
  where sequence_group is not null;

alter table public.qa_lifecycle_runs enable row level security;
revoke all on table public.qa_lifecycle_runs from public, anon, authenticated;
grant select, insert, update, delete on public.qa_lifecycle_runs to service_role;

create policy owner_manage_qa_lifecycle_runs
on public.qa_lifecycle_runs for all to authenticated
using (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create or replace function public.create_verified_project_restore_point(
  target_project_id uuid,
  target_restore_kind text default 'full_project'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row public.projects%rowtype;
  deployment_row public.project_deployment_configs%rowtype;
  restore_uuid uuid;
  snapshot_checksum text;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;

  if target_restore_kind not in ('deployment','content','configuration','full_project') then
    raise exception 'Unsupported restore kind.';
  end if;

  select * into project_row from public.projects where id = target_project_id;
  if not found then raise exception 'Project not found.'; end if;

  select * into deployment_row
  from public.project_deployment_configs
  where project_id = target_project_id;

  if deployment_row.github_repo is null or deployment_row.github_owner is null then
    raise exception 'Project source repository is not configured.';
  end if;
  if deployment_row.last_deployment_status <> 'published'
     or deployment_row.production_url is null
     or deployment_row.last_deployed_commit is null then
    raise exception 'Verified published deployment evidence is required before creating a restore point.';
  end if;

  snapshot_checksum := encode(digest(
    coalesce(deployment_row.last_deployed_commit, '') || '|' ||
    coalesce(deployment_row.production_url, '') || '|' ||
    coalesce(project_row.build_plan::text, '{}') || '|' ||
    coalesce(deployment_row.github_owner, '') || '/' || coalesce(deployment_row.github_repo, ''),
    'sha256'
  ), 'hex');

  insert into public.project_restore_points (
    client_id,
    project_id,
    restore_kind,
    git_commit_sha,
    git_branch,
    deployment_url,
    content_snapshot,
    config_snapshot,
    status,
    checksum,
    verified_at
  ) values (
    project_row.client_id,
    project_row.id,
    target_restore_kind,
    deployment_row.last_deployed_commit,
    'main',
    deployment_row.production_url,
    jsonb_build_object('build_plan', coalesce(project_row.build_plan, '{}'::jsonb)),
    jsonb_build_object(
      'github_owner', deployment_row.github_owner,
      'github_repo', deployment_row.github_repo,
      'netlify_site_id', deployment_row.netlify_site_id,
      'production_url', deployment_row.production_url,
      'deployment_status', deployment_row.last_deployment_status
    ),
    'verified',
    snapshot_checksum,
    now()
  ) returning id into restore_uuid;

  insert into public.automation_audit_log (client_id, project_id, event_type, actor_type, details)
  values (
    project_row.client_id,
    project_row.id,
    'project_restore_point_created',
    case when auth.role() = 'service_role' then 'backend' else 'owner' end,
    jsonb_build_object('restore_point_id', restore_uuid, 'restore_kind', target_restore_kind, 'checksum', snapshot_checksum)
  );

  return restore_uuid;
end;
$$;

revoke all on function public.create_verified_project_restore_point(uuid,text) from public, anon;
grant execute on function public.create_verified_project_restore_point(uuid,text) to authenticated, service_role;

create or replace function public.simulate_project_restore(target_restore_point_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  restore_row public.project_restore_points%rowtype;
  project_row public.projects%rowtype;
  deployment_row public.project_deployment_configs%rowtype;
  recovery_uuid uuid;
  expected_checksum text;
  checks jsonb;
  passed boolean;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;

  select * into restore_row from public.project_restore_points where id = target_restore_point_id;
  if not found then raise exception 'Restore point not found.'; end if;

  select * into project_row from public.projects where id = restore_row.project_id;
  select * into deployment_row from public.project_deployment_configs where project_id = restore_row.project_id;

  expected_checksum := encode(digest(
    coalesce(restore_row.git_commit_sha, '') || '|' ||
    coalesce(restore_row.deployment_url, '') || '|' ||
    coalesce(restore_row.content_snapshot->'build_plan', '{}'::jsonb)::text || '|' ||
    coalesce(restore_row.config_snapshot->>'github_owner', '') || '/' || coalesce(restore_row.config_snapshot->>'github_repo', ''),
    'sha256'
  ), 'hex');

  checks := jsonb_build_object(
    'restore_point_verified', restore_row.status = 'verified',
    'checksum_matches', restore_row.checksum is not null and restore_row.checksum = expected_checksum,
    'project_exists', project_row.id is not null,
    'client_matches', project_row.client_id = restore_row.client_id,
    'git_commit_present', nullif(restore_row.git_commit_sha, '') is not null,
    'source_repo_present', nullif(restore_row.config_snapshot->>'github_owner', '') is not null and nullif(restore_row.config_snapshot->>'github_repo', '') is not null,
    'production_url_present', nullif(restore_row.deployment_url, '') is not null,
    'current_deployment_record_exists', deployment_row.project_id is not null,
    'non_destructive', true
  );

  passed := (checks->>'restore_point_verified')::boolean
    and (checks->>'checksum_matches')::boolean
    and (checks->>'project_exists')::boolean
    and (checks->>'client_matches')::boolean
    and (checks->>'git_commit_present')::boolean
    and (checks->>'source_repo_present')::boolean
    and (checks->>'production_url_present')::boolean;

  insert into public.disaster_recovery_runs (
    project_id, client_id, run_type, status, source_restore_point_id,
    steps, result, started_at, completed_at
  ) values (
    restore_row.project_id,
    restore_row.client_id,
    'simulation',
    case when passed then 'passed' else 'failed' end,
    restore_row.id,
    jsonb_build_array(
      jsonb_build_object('step','validate_restore_metadata','status',case when passed then 'passed' else 'failed' end),
      jsonb_build_object('step','external_mutation','status','skipped','reason','simulation_is_non_destructive')
    ),
    jsonb_build_object('checks', checks, 'safe_to_attempt_provider_restore', passed),
    now(),
    now()
  ) returning id into recovery_uuid;

  return jsonb_build_object(
    'ok', passed,
    'recovery_run_id', recovery_uuid,
    'restore_point_id', restore_row.id,
    'checks', checks,
    'external_changes_made', false
  );
end;
$$;

revoke all on function public.simulate_project_restore(uuid) from public, anon;
grant execute on function public.simulate_project_restore(uuid) to authenticated, service_role;

create or replace function public.evaluate_launch_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  github_ok boolean := false;
  netlify_ok boolean := false;
  cron_ok boolean := false;
  workers_ok boolean := false;
  backup_ok boolean := false;
  ten_clean boolean := false;
  passed_e2e integer := 0;
  required_workers text[] := array[
    'provision-project-infrastructure',
    'prepare-build-plan',
    'build-business-website',
    'promote-business-production',
    'run-website-maintenance'
  ];
  required_worker_key text;
  details jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select exists (
    select 1 from public.nxq_provider_connections
    where provider_key = 'github' and status = 'healthy'
  ) into github_ok;

  select exists (
    select 1 from public.nxq_provider_connections
    where provider_key = 'netlify' and status = 'healthy'
  ) into netlify_ok;

  select exists (
    select 1 from cron.job
    where active = true and jobname like 'nxq-%'
  ) into cron_ok;

  workers_ok := true;
  foreach required_worker_key in array required_workers loop
    if not exists (
      select 1 from public.automation_worker_heartbeats h
      where h.worker_key = required_worker_key
        and h.status = 'healthy'
        and h.heartbeat_at > now() - interval '10 minutes'
    ) then
      workers_ok := false;
      exit;
    end if;
  end loop;

  select exists (
    select 1 from public.disaster_recovery_runs
    where run_type in ('simulation','restore_test') and status = 'passed'
  ) into backup_ok;

  select count(*) into passed_e2e
  from public.qa_lifecycle_runs
  where test_kind = 'business_e2e'
    and status = 'passed'
    and disposable = true
    and completed_at is not null;
  ten_clean := passed_e2e >= 10;

  update public.launch_readiness_checks
  set status = case check_key
      when 'workers_deployed' then case when workers_ok then 'ready' else 'unknown' end
      when 'github_app_healthy' then case when github_ok then 'ready' else 'unknown' end
      when 'netlify_healthy' then case when netlify_ok then 'ready' else 'unknown' end
      when 'cron_healthy' then case when cron_ok then 'ready' else 'unknown' end
      when 'backup_restore_passed' then case when backup_ok then 'ready' else 'unknown' end
      when 'ten_clean_runs' then case when ten_clean then 'ready' else 'unknown' end
      else status
    end,
    evidence = case check_key
      when 'workers_deployed' then jsonb_build_object('required_workers', required_workers, 'healthy', workers_ok)
      when 'github_app_healthy' then jsonb_build_object('provider_status_healthy', github_ok)
      when 'netlify_healthy' then jsonb_build_object('provider_status_healthy', netlify_ok)
      when 'cron_healthy' then jsonb_build_object('nxq_cron_active', cron_ok)
      when 'backup_restore_passed' then jsonb_build_object('passed_restore_simulation', backup_ok)
      when 'ten_clean_runs' then jsonb_build_object('passed_business_e2e_runs', passed_e2e, 'required', 10)
      else evidence
    end,
    last_checked_at = case when check_key in ('workers_deployed','github_app_healthy','netlify_healthy','cron_healthy','backup_restore_passed','ten_clean_runs') then now() else last_checked_at end,
    checked_by = case when check_key in ('workers_deployed','github_app_healthy','netlify_healthy','cron_healthy','backup_restore_passed','ten_clean_runs') then 'nxq-readiness-evaluator' else checked_by end,
    updated_at = now()
  where check_key in ('workers_deployed','github_app_healthy','netlify_healthy','cron_healthy','backup_restore_passed','ten_clean_runs');

  select jsonb_object_agg(check_key, jsonb_build_object('status',status,'required',required,'evidence',evidence))
  into details
  from public.launch_readiness_checks;

  return jsonb_build_object(
    'ok', true,
    'github_healthy', github_ok,
    'netlify_healthy', netlify_ok,
    'cron_healthy', cron_ok,
    'workers_healthy', workers_ok,
    'backup_restore_passed', backup_ok,
    'passed_business_e2e_runs', passed_e2e,
    'ten_clean_runs', ten_clean,
    'checks', coalesce(details, '{}'::jsonb),
    'evaluated_at', now()
  );
end;
$$;

revoke all on function public.evaluate_launch_readiness() from public, anon, authenticated;
grant execute on function public.evaluate_launch_readiness() to service_role;

comment on table public.qa_lifecycle_runs is
  'Evidence for disposable end-to-end and adversarial QA. Launch readiness counts only passed recorded runs; it never invents runtime success.';
comment on function public.simulate_project_restore(uuid) is
  'Non-destructive restore simulation. Validates recovery metadata/checksum only; never changes GitHub, Netlify, DNS, or production state.';
