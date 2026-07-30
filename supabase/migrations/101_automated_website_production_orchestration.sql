-- Guarded website production orchestration for NXQ Web.
-- This migration coordinates backend work but does not call GitHub, Netlify,
-- merge main, or publish a production website by itself.

create table if not exists public.website_automation_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check (status in (
    'queued','preparing_branch','generating','testing','preview_ready',
    'client_review','revision_required','production_audit','ready_for_owner',
    'published','failed','cancelled','blocked'
  )),
  source_branch text not null,
  base_branch text not null default 'main',
  build_plan_version text not null default 'v1',
  latest_commit_sha text,
  preview_request_id uuid references public.preview_deployment_requests(id) on delete set null,
  production_launch_request_id uuid references public.production_launch_requests(id) on delete set null,
  current_step text,
  last_error text,
  rollback_commit_sha text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_branch <> 'main'),
  check (base_branch = 'main')
);

create unique index if not exists website_automation_runs_active_project_uidx
  on public.website_automation_runs(project_id)
  where status not in ('published','failed','cancelled');

create table if not exists public.website_automation_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.website_automation_runs(id) on delete cascade,
  step_key text not null,
  step_order integer not null,
  status text not null default 'pending' check (status in (
    'pending','queued','running','completed','failed','blocked','skipped'
  )),
  requires_external_worker boolean not null default false,
  idempotency_key text not null unique,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_key)
);

create index if not exists website_automation_steps_run_order_idx
  on public.website_automation_steps(run_id, step_order);

alter table public.website_automation_runs enable row level security;
alter table public.website_automation_steps enable row level security;

revoke all on table public.website_automation_runs from public, anon;
revoke all on table public.website_automation_steps from public, anon;
grant select, insert, update, delete on table public.website_automation_runs to authenticated;
grant select, insert, update, delete on table public.website_automation_steps to authenticated;

drop policy if exists owner_manage_website_automation_runs on public.website_automation_runs;
create policy owner_manage_website_automation_runs
on public.website_automation_runs for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists owner_manage_website_automation_steps on public.website_automation_steps;
create policy owner_manage_website_automation_steps
on public.website_automation_steps for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

create or replace function public.touch_website_automation_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_website_automation_runs on public.website_automation_runs;
create trigger touch_website_automation_runs
before update on public.website_automation_runs
for each row execute function public.touch_website_automation_updated_at();

drop trigger if exists touch_website_automation_steps on public.website_automation_steps;
create trigger touch_website_automation_steps
before update on public.website_automation_steps
for each row execute function public.touch_website_automation_updated_at();

create or replace function public.bootstrap_ready_website_automation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row record;
  run_id uuid;
  created_count integer := 0;
  safe_branch text;
begin
  for project_row in
    select p.id as project_id, p.client_id, p.build_plan, c.status::text as client_status
    from public.projects p
    join public.clients c on c.id = p.client_id
    left join public.client_automation_controls controls on controls.client_id = c.id
    where c.status::text in ('approved','active')
      and coalesce(jsonb_typeof(p.build_plan), 'null') = 'object'
      and p.build_plan <> '{}'::jsonb
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
      and not exists (
        select 1 from public.website_automation_runs r
        where r.project_id = p.id
          and r.status not in ('published','failed','cancelled')
      )
  loop
    safe_branch := 'nxq/client-' || replace(project_row.client_id::text, '-', '') || '-build';

    insert into public.website_automation_runs (
      client_id, project_id, status, source_branch, base_branch,
      current_step, started_at
    ) values (
      project_row.client_id, project_row.project_id, 'queued', safe_branch, 'main',
      'prepare_safe_branch', now()
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

    perform public.enqueue_automation_job(
      project_row.client_id,
      project_row.project_id,
      'website_prepare_safe_branch',
      'website-run:' || run_id::text || ':queue-prepare-safe-branch:v1',
      jsonb_build_object('website_automation_run_id', run_id, 'source_branch', safe_branch, 'base_branch', 'main'),
      now(),
      40
    );

    insert into public.automation_audit_log (
      client_id, project_id, event_type, details
    ) values (
      project_row.client_id,
      project_row.project_id,
      'website_automation_run_created',
      jsonb_build_object(
        'run_id', run_id,
        'source_branch', safe_branch,
        'base_branch', 'main',
        'auto_publish', false,
        'main_merge_allowed', false
      )
    );

    created_count := created_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'created_runs', created_count, 'ran_at', now());
end;
$$;

revoke all on function public.bootstrap_ready_website_automation() from public, anon, authenticated;
grant execute on function public.bootstrap_ready_website_automation() to service_role;

-- Replace only the named NXQ job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-website-automation-bootstrap-every-10-minutes') then
    perform cron.unschedule('nxq-website-automation-bootstrap-every-10-minutes');
  end if;
end;
$$;

select cron.schedule(
  'nxq-website-automation-bootstrap-every-10-minutes',
  '*/10 * * * *',
  $$select public.bootstrap_ready_website_automation();$$
);

comment on table public.website_automation_runs is
  'Guarded website production runs. Automation may prepare branches, drafts, checks, previews, and audits, but may not merge or publish main automatically.';
