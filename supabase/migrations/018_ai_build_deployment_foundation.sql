-- NXQ Web AI build/deployment foundation.
-- Stores GitHub and Netlify project metadata without granting the AI or clients
-- direct production access. Owner-only RLS is enforced from day one.

create table if not exists public.project_deployment_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  github_owner text,
  github_repo text,
  production_branch text not null default 'main',
  netlify_site_id text,
  production_url text,
  auto_publish_locked boolean not null default true,
  last_deployed_commit text,
  last_deployment_status text not null default 'not_configured'
    check (last_deployment_status in (
      'not_configured',
      'ready',
      'queued',
      'building',
      'published',
      'failed',
      'cancelled',
      'rolled_back'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (github_owner is null and github_repo is null)
    or (github_owner is not null and github_repo is not null)
  )
);

create table if not exists public.project_deployments (
  id uuid primary key default gen_random_uuid(),
  deployment_config_id uuid not null
    references public.project_deployment_configs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  trigger_source text not null default 'owner'
    check (trigger_source in ('owner', 'ai', 'system')),
  requested_by uuid default auth.uid(),
  deploy_kind text not null default 'preview'
    check (deploy_kind in ('preview', 'production')),
  branch text not null,
  git_commit_sha text,
  netlify_deploy_id text,
  deploy_url text,
  status text not null default 'queued'
    check (status in (
      'queued',
      'building',
      'published',
      'failed',
      'cancelled',
      'rolled_back'
    )),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists project_deployment_configs_client_idx
  on public.project_deployment_configs(client_id);

create index if not exists project_deployments_project_created_idx
  on public.project_deployments(project_id, created_at desc);

create index if not exists project_deployments_client_created_idx
  on public.project_deployments(client_id, created_at desc);

create or replace function public.touch_project_deployment_config_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_project_deployment_config_updated_at
  on public.project_deployment_configs;

create trigger touch_project_deployment_config_updated_at
before update on public.project_deployment_configs
for each row
execute function public.touch_project_deployment_config_updated_at();

alter table public.project_deployment_configs enable row level security;
alter table public.project_deployments enable row level security;

revoke all on table public.project_deployment_configs from public, anon;
revoke all on table public.project_deployments from public, anon;

grant select, insert, update, delete
  on table public.project_deployment_configs to authenticated;

grant select, insert, update, delete
  on table public.project_deployments to authenticated;

drop policy if exists owner_manage_project_deployment_configs
  on public.project_deployment_configs;

create policy owner_manage_project_deployment_configs
on public.project_deployment_configs
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

drop policy if exists owner_manage_project_deployments
  on public.project_deployments;

create policy owner_manage_project_deployments
on public.project_deployments
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

revoke all on function public.touch_project_deployment_config_updated_at()
  from public, anon;
