-- NXQ provider registry, observability, disaster recovery, and launch-readiness foundation.
-- This migration stores provider metadata/state only; secrets stay in Vault/Edge/GitHub secrets.

create extension if not exists pgcrypto;

create table if not exists public.nxq_provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  provider_category text not null check (provider_category in (
    'hosting','source_control','database','registrar','email','sms','payments','crm',
    'analytics','identity','monitoring','malware_scan','maps','reviews','seo','storage','other'
  )),
  scope_type text not null default 'global' check (scope_type in ('global','product','client','project','organization')),
  scope_id uuid,
  status text not null default 'not_configured' check (status in ('not_configured','configured','healthy','degraded','error','disabled')),
  adapter_version text not null default 'v1',
  capabilities text[] not null default '{}'::text[],
  required_secret_names text[] not null default '{}'::text[],
  config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key, scope_type, scope_id)
);

create table if not exists public.nxq_provider_health_events (
  id uuid primary key default gen_random_uuid(),
  provider_connection_id uuid not null references public.nxq_provider_connections(id) on delete cascade,
  status text not null check (status in ('healthy','degraded','error','rate_limited','unauthorized','timeout','recovered')),
  latency_ms integer,
  http_status integer,
  summary text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists nxq_provider_health_events_connection_idx on public.nxq_provider_health_events(provider_connection_id, created_at desc);

create table if not exists public.automation_worker_heartbeats (
  worker_key text primary key,
  execution_target text not null check (execution_target in ('backend','edge','ai','scheduler','provider')),
  status text not null default 'unknown' check (status in ('unknown','healthy','degraded','stopped','error')),
  worker_version text,
  queue_depth integer,
  oldest_job_age_seconds integer,
  average_job_ms integer,
  last_job_type text,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_restore_points (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  restore_code text not null unique default ('RST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  restore_kind text not null check (restore_kind in ('deployment','content','configuration','full_project')),
  git_commit_sha text,
  git_branch text,
  deployment_url text,
  deployment_id uuid,
  content_snapshot jsonb not null default '{}'::jsonb,
  config_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'verified' check (status in ('pending','verified','invalid','restored','expired')),
  checksum text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists project_restore_points_project_idx on public.project_restore_points(project_id, created_at desc);

create table if not exists public.disaster_recovery_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  run_type text not null check (run_type in ('simulation','restore_test','provider_recovery','full_recovery')),
  status text not null default 'planned' check (status in ('planned','running','passed','failed','blocked','cancelled')),
  source_restore_point_id uuid references public.project_restore_points(id) on delete set null,
  steps jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.launch_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  check_key text not null unique,
  category text not null,
  title text not null,
  required boolean not null default true,
  status text not null default 'unknown' check (status in ('unknown','ready','warning','blocked','not_applicable')),
  evidence jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  checked_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public.launch_readiness_checks(check_key, category, title, required)
values
 ('migrations_applied','runtime','Required migrations applied',true),
 ('workers_deployed','runtime','Required Edge workers deployed',true),
 ('vault_configured','runtime','Vault worker URLs/tokens configured',true),
 ('github_app_healthy','providers','GitHub App connection healthy',true),
 ('netlify_healthy','providers','Netlify connection healthy',true),
 ('business_template_ready','build','Business template repository ready',true),
 ('cron_healthy','automation','Schedulers and cron jobs healthy',true),
 ('rls_isolation_passed','security','Tenant RLS/isolation tests passed',true),
 ('storage_isolation_passed','security','Storage isolation tests passed',true),
 ('deny_flow_passed','qa','DENY hard-stop runtime test passed',true),
 ('domain_flow_passed','qa','Domain/SSL runtime flow passed',true),
 ('maintenance_passed','qa','Maintenance and recovery runtime flow passed',true),
 ('backup_restore_passed','recovery','Backup/restore simulation passed',true),
 ('ten_clean_runs','qa','Ten clean end-to-end disposable runs completed',true),
 ('owner_launch_signoff','governance','Owner explicitly approved launch',true)
on conflict(check_key) do nothing;

alter table public.nxq_provider_connections enable row level security;
alter table public.nxq_provider_health_events enable row level security;
alter table public.automation_worker_heartbeats enable row level security;
alter table public.project_restore_points enable row level security;
alter table public.disaster_recovery_runs enable row level security;
alter table public.launch_readiness_checks enable row level security;

revoke all on table public.nxq_provider_connections from public, anon, authenticated;
revoke all on table public.nxq_provider_health_events from public, anon, authenticated;
revoke all on table public.automation_worker_heartbeats from public, anon, authenticated;
revoke all on table public.project_restore_points from public, anon;
revoke all on table public.disaster_recovery_runs from public, anon;
revoke all on table public.launch_readiness_checks from public, anon, authenticated;

grant select, insert, update, delete on public.nxq_provider_connections to service_role;
grant select, insert, update, delete on public.nxq_provider_health_events to service_role;
grant select, insert, update, delete on public.automation_worker_heartbeats to service_role;
grant select, insert, update, delete on public.project_restore_points to service_role;
grant select, insert, update, delete on public.disaster_recovery_runs to service_role;
grant select, insert, update, delete on public.launch_readiness_checks to service_role;
grant select on public.project_restore_points to authenticated;
grant select on public.disaster_recovery_runs to authenticated;

create policy owner_manage_provider_connections on public.nxq_provider_connections for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));
create policy owner_manage_provider_health on public.nxq_provider_health_events for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));
create policy owner_manage_worker_heartbeats on public.automation_worker_heartbeats for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));
create policy owner_manage_launch_readiness on public.launch_readiness_checks for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create policy client_read_own_restore_points on public.project_restore_points for select to authenticated
using (exists(select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));
create policy owner_manage_restore_points on public.project_restore_points for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));
create policy client_read_own_recovery_runs on public.disaster_recovery_runs for select to authenticated
using (client_id is not null and exists(select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));
create policy owner_manage_recovery_runs on public.disaster_recovery_runs for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create or replace function public.record_worker_heartbeat(
  target_worker_key text,
  target_execution_target text,
  target_status text,
  target_metadata jsonb default '{}'::jsonb,
  target_last_error text default null
)
returns void language plpgsql security definer set search_path=public as $$
begin
  if target_execution_target not in ('backend','edge','ai','scheduler','provider') then raise exception 'Invalid execution target.'; end if;
  if target_status not in ('unknown','healthy','degraded','stopped','error') then raise exception 'Invalid worker status.'; end if;
  insert into public.automation_worker_heartbeats(worker_key,execution_target,status,metadata,last_error,last_success_at,last_error_at,heartbeat_at,updated_at)
  values(target_worker_key,target_execution_target,target_status,coalesce(target_metadata,'{}'::jsonb),target_last_error,
    case when target_status='healthy' then now() else null end,
    case when target_status='error' then now() else null end,now(),now())
  on conflict(worker_key) do update set
    execution_target=excluded.execution_target,status=excluded.status,metadata=excluded.metadata,last_error=excluded.last_error,
    last_success_at=case when excluded.status='healthy' then now() else public.automation_worker_heartbeats.last_success_at end,
    last_error_at=case when excluded.status='error' then now() else public.automation_worker_heartbeats.last_error_at end,
    heartbeat_at=now(),updated_at=now();
end; $$;
revoke all on function public.record_worker_heartbeat(text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_worker_heartbeat(text,text,text,jsonb,text) to service_role;

comment on table public.nxq_provider_connections is 'Provider adapter registry. Stores state/capabilities/required secret names, never raw secrets.';
comment on table public.project_restore_points is 'Verified project recovery checkpoints for rollback/disaster recovery.';
comment on table public.launch_readiness_checks is 'Evidence-driven launch gate; owner sign-off remains required before production merge/launch.';