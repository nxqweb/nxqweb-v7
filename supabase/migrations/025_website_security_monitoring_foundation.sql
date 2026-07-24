-- Website security monitoring foundation.
-- Stores monitoring configuration, scan results, and incidents only.
-- This migration does not call external providers, scan websites, block traffic,
-- or modify production deployments.

create table if not exists public.website_security_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  monitoring_status text not null default 'setup_pending'
    check (monitoring_status in ('setup_pending', 'active', 'paused', 'disabled', 'error')),
  website_health text not null default 'not_connected'
    check (website_health in ('not_connected', 'healthy', 'degraded', 'offline', 'unknown')),
  ssl_status text not null default 'not_checked'
    check (ssl_status in ('not_checked', 'active', 'expiring', 'expired', 'invalid', 'unknown')),
  monitored_url text,
  threats_blocked_total bigint not null default 0 check (threats_blocked_total >= 0),
  last_scan_at timestamptz,
  last_healthy_at timestamptz,
  last_healthy_deployment_id uuid references public.project_deployments(id) on delete set null,
  latest_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, project_id),
  check (monitored_url is null or length(trim(monitored_url)) > 0)
);

create table if not exists public.website_health_checks (
  id uuid primary key default gen_random_uuid(),
  security_profile_id uuid not null
    references public.website_security_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  check_type text not null
    check (check_type in ('uptime', 'ssl', 'application', 'deployment', 'security_scan')),
  status text not null
    check (status in ('healthy', 'warning', 'failed', 'unknown')),
  checked_url text,
  http_status integer,
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  details jsonb not null default '{}'::jsonb,
  error_message text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.website_security_incidents (
  id uuid primary key default gen_random_uuid(),
  security_profile_id uuid not null
    references public.website_security_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  incident_type text not null
    check (incident_type in (
      'availability',
      'ssl',
      'application_error',
      'deployment_failure',
      'suspicious_traffic',
      'integrity_change',
      'configuration',
      'other'
    )),
  severity text not null default 'low'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'repair_prepared', 'awaiting_owner', 'resolved', 'dismissed')),
  title text not null,
  summary text,
  evidence jsonb not null default '{}'::jsonb,
  ai_investigation_status text not null default 'not_started'
    check (ai_investigation_status in ('not_started', 'queued', 'investigating', 'completed', 'failed')),
  ai_findings jsonb,
  repair_status text not null default 'not_started'
    check (repair_status in ('not_started', 'prepared', 'testing', 'awaiting_owner', 'approved', 'deployed', 'rolled_back', 'failed')),
  repair_branch text,
  related_deployment_id uuid references public.project_deployments(id) on delete set null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(title)) > 0)
);

create index if not exists website_security_profiles_client_idx
  on public.website_security_profiles(client_id);

create index if not exists website_security_profiles_status_idx
  on public.website_security_profiles(monitoring_status, website_health);

create index if not exists website_health_checks_profile_checked_idx
  on public.website_health_checks(security_profile_id, checked_at desc);

create index if not exists website_health_checks_client_checked_idx
  on public.website_health_checks(client_id, checked_at desc);

create index if not exists website_security_incidents_profile_detected_idx
  on public.website_security_incidents(security_profile_id, detected_at desc);

create index if not exists website_security_incidents_status_idx
  on public.website_security_incidents(status, severity, detected_at desc);

create or replace function public.touch_website_security_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_website_security_profiles_updated_at
  on public.website_security_profiles;

create trigger touch_website_security_profiles_updated_at
before update on public.website_security_profiles
for each row
execute function public.touch_website_security_updated_at();

drop trigger if exists touch_website_security_incidents_updated_at
  on public.website_security_incidents;

create trigger touch_website_security_incidents_updated_at
before update on public.website_security_incidents
for each row
execute function public.touch_website_security_updated_at();

alter table public.website_security_profiles enable row level security;
alter table public.website_health_checks enable row level security;
alter table public.website_security_incidents enable row level security;

revoke all on table public.website_security_profiles from public, anon;
revoke all on table public.website_health_checks from public, anon;
revoke all on table public.website_security_incidents from public, anon;

grant select, insert, update, delete on table public.website_security_profiles to authenticated;
grant select, insert, update, delete on table public.website_health_checks to authenticated;
grant select, insert, update, delete on table public.website_security_incidents to authenticated;

-- Owner full access.
drop policy if exists owner_manage_website_security_profiles
  on public.website_security_profiles;
create policy owner_manage_website_security_profiles
on public.website_security_profiles
for all
to authenticated
using (
  exists (
    select 1 from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists owner_manage_website_health_checks
  on public.website_health_checks;
create policy owner_manage_website_health_checks
on public.website_health_checks
for all
to authenticated
using (
  exists (
    select 1 from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists owner_manage_website_security_incidents
  on public.website_security_incidents;
create policy owner_manage_website_security_incidents
on public.website_security_incidents
for all
to authenticated
using (
  exists (
    select 1 from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

-- Clients can read only records tied to their own workspace.
drop policy if exists clients_view_own_website_security_profiles
  on public.website_security_profiles;
create policy clients_view_own_website_security_profiles
on public.website_security_profiles
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = website_security_profiles.client_id
      and clients.auth_user_id = auth.uid()
  )
);

drop policy if exists clients_view_own_website_health_checks
  on public.website_health_checks;
create policy clients_view_own_website_health_checks
on public.website_health_checks
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = website_health_checks.client_id
      and clients.auth_user_id = auth.uid()
  )
);

drop policy if exists clients_view_own_website_security_incidents
  on public.website_security_incidents;
create policy clients_view_own_website_security_incidents
on public.website_security_incidents
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = website_security_incidents.client_id
      and clients.auth_user_id = auth.uid()
  )
);

revoke all on function public.touch_website_security_updated_at()
  from public, anon;

comment on table public.website_security_profiles is
  'Per-client website monitoring configuration and latest summarized security state.';

comment on table public.website_health_checks is
  'Append-only website health, SSL, application, deployment, and security scan results.';

comment on table public.website_security_incidents is
  'Detected website incidents and guarded AI investigation or repair workflow state.';
