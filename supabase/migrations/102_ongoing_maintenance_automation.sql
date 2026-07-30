-- Ongoing website maintenance automation for NXQ Web.
-- Schedules monitoring and maintenance work, but does not call external providers,
-- modify a production website, merge main, or publish changes by itself.

create extension if not exists pg_cron;

create table if not exists public.website_maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  security_profile_id uuid references public.website_security_profiles(id) on delete set null,
  status text not null default 'active' check (status in ('setup_pending','active','paused','disabled','error')),
  monitored_url text,
  uptime_enabled boolean not null default true,
  ssl_enabled boolean not null default true,
  form_test_enabled boolean not null default true,
  broken_link_enabled boolean not null default true,
  security_scan_enabled boolean not null default true,
  seo_check_enabled boolean not null default true,
  backup_check_enabled boolean not null default true,
  monthly_report_enabled boolean not null default true,
  uptime_interval_minutes integer not null default 15 check (uptime_interval_minutes between 5 and 1440),
  ssl_interval_hours integer not null default 24 check (ssl_interval_hours between 1 and 720),
  form_test_interval_hours integer not null default 24 check (form_test_interval_hours between 1 and 720),
  broken_link_interval_hours integer not null default 168 check (broken_link_interval_hours between 1 and 2160),
  security_scan_interval_hours integer not null default 24 check (security_scan_interval_hours between 1 and 720),
  seo_check_interval_hours integer not null default 720 check (seo_check_interval_hours between 24 and 2160),
  backup_check_interval_hours integer not null default 24 check (backup_check_interval_hours between 1 and 720),
  next_uptime_check_at timestamptz not null default now(),
  next_ssl_check_at timestamptz not null default now(),
  next_form_test_at timestamptz not null default now(),
  next_broken_link_check_at timestamptz not null default now(),
  next_security_scan_at timestamptz not null default now(),
  next_seo_check_at timestamptz not null default now(),
  next_backup_check_at timestamptz not null default now(),
  next_monthly_report_at timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  last_maintenance_at timestamptz,
  latest_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  check (monitored_url is null or length(trim(monitored_url)) > 0)
);

create table if not exists public.website_maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  maintenance_plan_id uuid not null references public.website_maintenance_plans(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_type text not null check (task_type in (
    'uptime_check','ssl_check','form_test','broken_link_scan','security_scan',
    'seo_check','backup_check','monthly_report','prepare_safe_improvement'
  )),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','blocked','cancelled')),
  requires_external_worker boolean not null default true,
  provider_connected boolean not null default false,
  priority integer not null default 100,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null unique,
  input jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists website_maintenance_tasks_due_idx
  on public.website_maintenance_tasks(status, scheduled_for, priority, created_at);
create index if not exists website_maintenance_tasks_project_idx
  on public.website_maintenance_tasks(project_id, created_at desc);

create table if not exists public.website_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  maintenance_plan_id uuid not null references public.website_maintenance_plans(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  report_month date not null,
  status text not null default 'draft' check (status in ('draft','ready','delivered','blocked','failed')),
  health_summary jsonb not null default '{}'::jsonb,
  seo_summary jsonb not null default '{}'::jsonb,
  security_summary jsonb not null default '{}'::jsonb,
  performance_summary jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  client_message_id uuid references public.client_messages(id) on delete set null,
  generated_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, report_month)
);

alter table public.website_maintenance_plans enable row level security;
alter table public.website_maintenance_tasks enable row level security;
alter table public.website_monthly_reports enable row level security;

revoke all on table public.website_maintenance_plans from public, anon;
revoke all on table public.website_maintenance_tasks from public, anon;
revoke all on table public.website_monthly_reports from public, anon;

grant select, insert, update, delete on table public.website_maintenance_plans to authenticated;
grant select, insert, update, delete on table public.website_maintenance_tasks to authenticated;
grant select, insert, update, delete on table public.website_monthly_reports to authenticated;

drop policy if exists owner_manage_website_maintenance_plans on public.website_maintenance_plans;
create policy owner_manage_website_maintenance_plans
on public.website_maintenance_plans for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists owner_manage_website_maintenance_tasks on public.website_maintenance_tasks;
create policy owner_manage_website_maintenance_tasks
on public.website_maintenance_tasks for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists owner_manage_website_monthly_reports on public.website_monthly_reports;
create policy owner_manage_website_monthly_reports
on public.website_monthly_reports for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists clients_view_own_website_maintenance_plans on public.website_maintenance_plans;
create policy clients_view_own_website_maintenance_plans
on public.website_maintenance_plans for select to authenticated
using (exists (
  select 1 from public.clients
  where clients.id = website_maintenance_plans.client_id
    and clients.auth_user_id = auth.uid()
));

drop policy if exists clients_view_own_website_monthly_reports on public.website_monthly_reports;
create policy clients_view_own_website_monthly_reports
on public.website_monthly_reports for select to authenticated
using (exists (
  select 1 from public.clients
  where clients.id = website_monthly_reports.client_id
    and clients.auth_user_id = auth.uid()
));

create or replace function public.touch_website_maintenance_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_website_maintenance_plans on public.website_maintenance_plans;
create trigger touch_website_maintenance_plans
before update on public.website_maintenance_plans
for each row execute function public.touch_website_maintenance_updated_at();

drop trigger if exists touch_website_maintenance_tasks on public.website_maintenance_tasks;
create trigger touch_website_maintenance_tasks
before update on public.website_maintenance_tasks
for each row execute function public.touch_website_maintenance_updated_at();

drop trigger if exists touch_website_monthly_reports on public.website_monthly_reports;
create trigger touch_website_monthly_reports
before update on public.website_monthly_reports
for each row execute function public.touch_website_maintenance_updated_at();

create or replace function public.bootstrap_live_website_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row record;
  profile_id uuid;
  created_count integer := 0;
begin
  for project_row in
    select p.id as project_id, p.client_id,
           coalesce(d.published_url, d.production_url) as monitored_url
    from public.projects p
    join public.clients c on c.id = p.client_id
    left join lateral (
      select pd.published_url, plc.production_url
      from public.production_launch_requests plc
      left join public.project_deployments pd on pd.id = plc.deployment_record_id
      where plc.project_id = p.id and plc.status = 'published'
      order by plc.updated_at desc
      limit 1
    ) d on true
    left join public.client_automation_controls controls on controls.client_id = c.id
    where p.stage::text in ('live','maintenance')
      and c.status::text in ('approved','active')
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
      and not exists (select 1 from public.website_maintenance_plans mp where mp.project_id = p.id)
  loop
    insert into public.website_security_profiles (
      client_id, project_id, monitoring_status, website_health, monitored_url
    ) values (
      project_row.client_id, project_row.project_id,
      case when project_row.monitored_url is null then 'setup_pending' else 'active' end,
      case when project_row.monitored_url is null then 'not_connected' else 'unknown' end,
      project_row.monitored_url
    )
    on conflict (client_id, project_id) do update
      set monitored_url = coalesce(excluded.monitored_url, public.website_security_profiles.monitored_url),
          updated_at = now()
    returning id into profile_id;

    insert into public.website_maintenance_plans (
      client_id, project_id, security_profile_id, status, monitored_url
    ) values (
      project_row.client_id, project_row.project_id, profile_id,
      case when project_row.monitored_url is null then 'setup_pending' else 'active' end,
      project_row.monitored_url
    );

    insert into public.automation_audit_log (client_id, project_id, event_type, details)
    values (
      project_row.client_id, project_row.project_id,
      'website_maintenance_plan_created',
      jsonb_build_object('monitored_url', project_row.monitored_url, 'provider_connected', false)
    );

    created_count := created_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'created_plans', created_count, 'ran_at', now());
end;
$$;

create or replace function public.queue_due_website_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.website_maintenance_plans%rowtype;
  queued_count integer := 0;
  blocked_count integer := 0;
  due_key text;
  task_id uuid;
begin
  for plan_row in
    select mp.*
    from public.website_maintenance_plans mp
    left join public.client_automation_controls controls on controls.client_id = mp.client_id
    where mp.status = 'active'
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
  loop
    if plan_row.uptime_enabled and plan_row.next_uptime_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':uptime:' || to_char(plan_row.next_uptime_check_at, 'YYYYMMDDHH24MI');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'uptime_check', 'blocked',
        true, false, 10, plan_row.next_uptime_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for uptime-monitor provider connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_uptime_check_at = now() + make_interval(mins => uptime_interval_minutes)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.ssl_enabled and plan_row.next_ssl_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':ssl:' || to_char(plan_row.next_ssl_check_at, 'YYYYMMDDHH24');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'ssl_check', 'blocked',
        true, false, 20, plan_row.next_ssl_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for SSL-monitor provider connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_ssl_check_at = now() + make_interval(hours => ssl_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.form_test_enabled and plan_row.next_form_test_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':form:' || to_char(plan_row.next_form_test_at, 'YYYYMMDDHH24');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'form_test', 'blocked',
        true, false, 30, plan_row.next_form_test_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url, 'submit_real_form', false),
        'Waiting for form-test worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_form_test_at = now() + make_interval(hours => form_test_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.broken_link_enabled and plan_row.next_broken_link_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':links:' || to_char(plan_row.next_broken_link_check_at, 'IYYYIW');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'broken_link_scan', 'blocked',
        true, false, 40, plan_row.next_broken_link_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for broken-link worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_broken_link_check_at = now() + make_interval(hours => broken_link_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.security_scan_enabled and plan_row.next_security_scan_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':security:' || to_char(plan_row.next_security_scan_at, 'YYYYMMDDHH24');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'security_scan', 'blocked',
        true, false, 15, plan_row.next_security_scan_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url, 'non_destructive', true),
        'Waiting for security-scan provider connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_security_scan_at = now() + make_interval(hours => security_scan_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.seo_check_enabled and plan_row.next_seo_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':seo:' || to_char(plan_row.next_seo_check_at, 'YYYYMM');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'seo_check', 'blocked',
        true, false, 60, plan_row.next_seo_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for SEO-check worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_seo_check_at = now() + make_interval(hours => seo_check_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.backup_check_enabled and plan_row.next_backup_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':backup:' || to_char(plan_row.next_backup_check_at, 'YYYYMMDD');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'backup_check', 'blocked',
        true, false, 35, plan_row.next_backup_check_at,
        due_key, jsonb_build_object('project_id', plan_row.project_id),
        'Waiting for backup-verification worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_backup_check_at = now() + make_interval(hours => backup_check_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.monthly_report_enabled and plan_row.next_monthly_report_at <= now() then
      insert into public.website_monthly_reports (
        maintenance_plan_id, client_id, project_id, report_month, status
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id,
        date_trunc('month', now())::date, 'draft'
      ) on conflict (project_id, report_month) do nothing;

      due_key := 'maintenance:' || plan_row.id::text || ':monthly-report:' || to_char(now(), 'YYYYMM');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'monthly_report', 'blocked',
        true, false, 80, plan_row.next_monthly_report_at,
        due_key, jsonb_build_object('report_month', date_trunc('month', now())::date),
        'Waiting for reporting/AI-summary worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_monthly_report_at = date_trunc('month', now()) + interval '1 month'
      where id = plan_row.id;
      task_id := null;
    end if;
  end loop;

  queued_count := 0;
  return jsonb_build_object(
    'ok', true,
    'queued', queued_count,
    'blocked_waiting_for_providers', blocked_count,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.bootstrap_live_website_maintenance() from public, anon, authenticated;
revoke all on function public.queue_due_website_maintenance() from public, anon, authenticated;
grant execute on function public.bootstrap_live_website_maintenance() to service_role;
grant execute on function public.queue_due_website_maintenance() to service_role;

-- Replace only these named NXQ jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-maintenance-bootstrap-hourly') then
    perform cron.unschedule('nxq-maintenance-bootstrap-hourly');
  end if;
  if exists (select 1 from cron.job where jobname = 'nxq-maintenance-queue-every-5-minutes') then
    perform cron.unschedule('nxq-maintenance-queue-every-5-minutes');
  end if;
end;
$$;

select cron.schedule(
  'nxq-maintenance-bootstrap-hourly',
  '12 * * * *',
  $$select public.bootstrap_live_website_maintenance();$$
);

select cron.schedule(
  'nxq-maintenance-queue-every-5-minutes',
  '*/5 * * * *',
  $$select public.queue_due_website_maintenance();$$
);

comment on table public.website_maintenance_plans is
  'Per-project maintenance schedules. External checks remain blocked until providers/workers are connected.';
comment on table public.website_maintenance_tasks is
  'Idempotent maintenance work queue. Does not fabricate successful monitoring results.';
comment on table public.website_monthly_reports is
  'Monthly website health and improvement reports prepared from real completed checks.';
