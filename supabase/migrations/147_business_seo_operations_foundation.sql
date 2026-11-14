-- Business SEO operations foundation.
-- Tracks evidence-based issues and generated sitemap/schema artifacts per project.

create extension if not exists pgcrypto;

create table if not exists public.business_seo_issues (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  location_id uuid references public.client_locations(id) on delete cascade,
  issue_key text not null,
  category text not null check (category in ('metadata','schema','sitemap','canonical','indexing','content','links','performance','local_seo','other')),
  severity text not null default 'warning' check (severity in ('info','warning','high','critical')),
  status text not null default 'open' check (status in ('open','auto_fixing','resolved','ignored','blocked')),
  title text not null,
  summary text,
  evidence jsonb not null default '{}'::jsonb,
  auto_fixable boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, location_id, issue_key)
);

create table if not exists public.project_seo_artifacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('sitemap','robots','organization_schema','local_business_schema','service_schema','breadcrumb_schema')),
  status text not null default 'pending' check (status in ('pending','ready','published','blocked','failed')),
  git_path text,
  git_commit_sha text,
  canonical_base_url text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  last_generated_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, artifact_type)
);

create index if not exists business_seo_issues_project_status_idx on public.business_seo_issues(project_id,status,severity,last_seen_at desc);
create index if not exists project_seo_artifacts_project_idx on public.project_seo_artifacts(project_id,artifact_type);

alter table public.business_seo_issues enable row level security;
alter table public.project_seo_artifacts enable row level security;
revoke all on table public.business_seo_issues from public,anon;
revoke all on table public.project_seo_artifacts from public,anon;
grant select on public.business_seo_issues to authenticated;
grant select on public.project_seo_artifacts to authenticated;
grant select,insert,update,delete on public.business_seo_issues to service_role;
grant select,insert,update,delete on public.project_seo_artifacts to service_role;

create policy client_view_own_seo_issues on public.business_seo_issues for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()));
create policy client_view_own_seo_artifacts on public.project_seo_artifacts for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()));
create policy owner_manage_seo_issues on public.business_seo_issues for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_manage_seo_artifacts on public.project_seo_artifacts for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

create or replace function public.queue_project_seo_refresh_from_location_page()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status not in ('ready','published') then return new; end if;
  perform public.enqueue_automation_job(
    new.client_id,new.project_id,'website_project_seo_refresh',
    'project:'||new.project_id::text||':seo-refresh:'||to_char(now(),'YYYYMMDDHH24MI'),
    jsonb_build_object('execution_target','edge','requires_external_worker',true,'source','location_page','location_id',new.location_id),
    now()+interval '1 minute',45
  );
  return new;
end; $$;

drop trigger if exists queue_project_seo_refresh_from_location_page on public.client_location_pages;
create trigger queue_project_seo_refresh_from_location_page
after insert or update of status,last_generated_at on public.client_location_pages
for each row execute function public.queue_project_seo_refresh_from_location_page();

revoke all on function public.queue_project_seo_refresh_from_location_page() from public,anon,authenticated;

comment on table public.business_seo_issues is 'Evidence-based SEO issue queue. Safe auto-fixable issues may enter normal NXQ safe-branch automation.';
comment on table public.project_seo_artifacts is 'Generated sitemap/schema/robots artifact state per Business project.';
