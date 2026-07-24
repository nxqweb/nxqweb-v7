-- Preview-only deployment approval foundation.
-- This migration records preview requests and owner decisions only.
-- It does not call GitHub, Netlify, or any production deployment service.

create table if not exists public.preview_deployment_requests (
  id uuid primary key default gen_random_uuid(),
  deployment_config_id uuid not null
    references public.project_deployment_configs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid default auth.uid(),
  source_branch text not null,
  requested_commit_sha text,
  status text not null default 'pending_owner_approval'
    check (status in (
      'pending_owner_approval',
      'approved_for_preview',
      'rejected',
      'queued',
      'building',
      'published',
      'failed',
      'cancelled'
    )),
  owner_decision_by uuid,
  owner_decision_at timestamptz,
  owner_decision_note text,
  preview_deploy_id text,
  preview_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_branch <> 'main'),
  check (
    (status in ('approved_for_preview', 'rejected') and owner_decision_at is not null)
    or status not in ('approved_for_preview', 'rejected')
  )
);

create index if not exists preview_deployment_requests_project_created_idx
  on public.preview_deployment_requests(project_id, created_at desc);

create index if not exists preview_deployment_requests_status_idx
  on public.preview_deployment_requests(status, created_at desc);

create or replace function public.touch_preview_deployment_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_preview_deployment_request_updated_at
  on public.preview_deployment_requests;

create trigger touch_preview_deployment_request_updated_at
before update on public.preview_deployment_requests
for each row
execute function public.touch_preview_deployment_request_updated_at();

alter table public.preview_deployment_requests enable row level security;

revoke all on table public.preview_deployment_requests from public, anon;
grant select, insert, update, delete
  on table public.preview_deployment_requests to authenticated;

drop policy if exists owner_manage_preview_deployment_requests
  on public.preview_deployment_requests;

create policy owner_manage_preview_deployment_requests
on public.preview_deployment_requests
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

revoke all on function public.touch_preview_deployment_request_updated_at()
  from public, anon;
