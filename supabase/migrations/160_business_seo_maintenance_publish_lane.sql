-- Guarded autonomous publish lane for post-launch Business SEO maintenance.
-- Safe branch -> exact preview commit -> fast-forward-only main -> exact production commit verification.

create extension if not exists pgcrypto;

create table if not exists public.project_seo_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'generated' check (status in ('generated','preview_building','preview_ready','promoting','production_building','published','blocked','failed','cancelled')),
  source_branch text not null,
  base_main_sha text not null,
  source_head_sha text not null,
  preview_deploy_id text,
  preview_url text,
  production_deploy_id text,
  production_url text,
  production_commit_sha text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  preview_verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, source_head_sha)
);

create index if not exists project_seo_refresh_runs_project_status_idx
  on public.project_seo_refresh_runs(project_id,status,created_at desc);

alter table public.project_seo_refresh_runs enable row level security;
revoke all on table public.project_seo_refresh_runs from public,anon;
grant select on public.project_seo_refresh_runs to authenticated;
grant select,insert,update,delete on public.project_seo_refresh_runs to service_role;

create policy client_view_own_seo_refresh_runs
on public.project_seo_refresh_runs for select to authenticated
using (exists(select 1 from public.clients c where c.id=project_seo_refresh_runs.client_id and c.auth_user_id=auth.uid()));

create policy owner_manage_seo_refresh_runs
on public.project_seo_refresh_runs for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

-- Expand the existing SEO dispatcher so one protected worker advances the complete maintenance lane.
create or replace function public.dispatch_business_seo_artifacts()
returns jsonb
language plpgsql
security definer
set search_path=public,vault,net
as $$
declare
  worker_url text;
  worker_token text;
  due_count integer:=0;
  request_id bigint;
begin
  select count(*) into due_count
  from public.automation_jobs j
  left join public.client_automation_controls controls on controls.client_id=j.client_id
  where j.execution_target='edge'
    and j.job_type in (
      'website_project_seo_refresh',
      'website_project_seo_preview_check',
      'website_project_seo_promote',
      'website_project_seo_production_check'
    )
    and j.status in ('queued','failed')
    and j.run_after<=now()
    and j.attempts<j.max_attempts
    and coalesce(controls.automation_enabled,true)
    and not coalesce(controls.automation_paused,false);

  if due_count=0 then return jsonb_build_object('ok',true,'due_jobs',0,'dispatched',false); end if;

  select decrypted_secret into worker_url from vault.decrypted_secrets where name='nxq_business_seo_edge_url' order by created_at desc limit 1;
  select decrypted_secret into worker_token from vault.decrypted_secrets where name='nxq_automation_worker_token' order by created_at desc limit 1;

  if nullif(btrim(worker_url),'') is null or nullif(btrim(worker_token),'') is null then
    return jsonb_build_object('ok',false,'configured',false,'reason','business_seo_worker_vault_config_missing','due_jobs',due_count);
  end if;

  select net.http_post(
    url:=worker_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',worker_token),
    body:=jsonb_build_object('source','nxq_business_seo_cron','requested_at',now())
  ) into request_id;

  insert into public.automation_audit_log(event_type,actor_type,details)
  values('business_seo_dispatch_requested','backend',jsonb_build_object('request_id',request_id,'due_jobs',due_count));

  return jsonb_build_object('ok',true,'configured',true,'due_jobs',due_count,'dispatched',true,'request_id',request_id);
end;
$$;

revoke all on function public.dispatch_business_seo_artifacts() from public,anon,authenticated;
grant execute on function public.dispatch_business_seo_artifacts() to service_role;

comment on table public.project_seo_refresh_runs is 'Evidence ledger for autonomous post-launch Business SEO maintenance publishing. Production promotion is fast-forward-only and exact-commit verified.';
