-- Production launch approval foundation.
-- Records launch requests, audits, owner decisions, and provider results only.
-- This migration does not call GitHub, Netlify, or publish a production website.

create table if not exists public.production_launch_requests (
  id uuid primary key default gen_random_uuid(),
  deployment_config_id uuid not null
    references public.project_deployment_configs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  preview_request_id uuid not null
    references public.preview_deployment_requests(id) on delete restrict,
  requested_by uuid default auth.uid(),
  production_branch text not null,
  production_url text,
  status text not null default 'draft'
    check (status in (
      'draft',
      'audit_required',
      'audit_passed',
      'audit_blocked',
      'pending_owner_approval',
      'approved_for_production',
      'rejected',
      'prepared',
      'launching',
      'published',
      'failed',
      'cancelled'
    )),
  audit_checked_at timestamptz,
  audit_status text not null default 'not_checked'
    check (audit_status in ('not_checked', 'passed', 'blocked')),
  audit_details jsonb,
  critical_blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  owner_decision_by uuid,
  owner_decision_at timestamptz,
  owner_decision_note text,
  prepared_at timestamptz,
  prepared_by uuid,
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  deployment_record_id uuid
    references public.project_deployments(id) on delete set null,
  netlify_build_id text,
  netlify_deploy_id text,
  published_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(production_branch)) > 0),
  check (
    (status in ('approved_for_production', 'rejected') and owner_decision_at is not null)
    or status not in ('approved_for_production', 'rejected')
  )
);

create unique index if not exists production_launch_requests_active_preview_uidx
  on public.production_launch_requests(preview_request_id)
  where status not in ('rejected', 'cancelled', 'failed');

create unique index if not exists production_launch_requests_deployment_record_uidx
  on public.production_launch_requests(deployment_record_id)
  where deployment_record_id is not null;

create index if not exists production_launch_requests_project_created_idx
  on public.production_launch_requests(project_id, created_at desc);

create index if not exists production_launch_requests_status_idx
  on public.production_launch_requests(status, created_at desc);

create or replace function public.touch_production_launch_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_production_launch_request_updated_at
  on public.production_launch_requests;

create trigger touch_production_launch_request_updated_at
before update on public.production_launch_requests
for each row
execute function public.touch_production_launch_request_updated_at();

alter table public.production_launch_requests enable row level security;

revoke all on table public.production_launch_requests from public, anon;
grant select, insert, update, delete
  on table public.production_launch_requests to authenticated;

drop policy if exists owner_manage_production_launch_requests
  on public.production_launch_requests;

create policy owner_manage_production_launch_requests
on public.production_launch_requests
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

revoke all on function public.touch_production_launch_request_updated_at()
  from public, anon;

comment on table public.production_launch_requests is
  'Owner-controlled production launch workflow. Records approvals and audit results; does not itself trigger a deployment.';
