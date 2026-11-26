-- Privacy-safe analytics foundation for NXQ-managed websites.
-- No raw form values, keystrokes, passwords, biometrics, or secret identifiers belong here.
-- Public ingestion is intentionally NOT granted directly to anon/authenticated roles.

create extension if not exists pg_cron;

create table if not exists public.website_analytics_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'disabled' check (status in ('disabled','enabled','paused')),
  consent_mode text not null default 'required' check (consent_mode in ('required','provider_managed')),
  page_view_enabled boolean not null default true,
  click_enabled boolean not null default true,
  scroll_depth_enabled boolean not null default true,
  mouse_tracking_enabled boolean not null default false,
  retention_days integer not null default 30 check (retention_days between 1 and 365),
  consent_version text not null default 'v1',
  ingest_endpoint_configured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id)
);

create table if not exists public.website_analytics_events (
  id bigint generated always as identity primary key,
  analytics_profile_id uuid not null references public.website_analytics_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null check (event_type in ('page_view','click','scroll_depth','mouse_heatpoint')),
  page_path text not null default '/',
  anonymous_session_key text,
  normalized_x numeric,
  normalized_y numeric,
  scroll_depth smallint,
  consent_version text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (length(page_path) <= 500),
  check (anonymous_session_key is null or length(anonymous_session_key) <= 100),
  check (normalized_x is null or (normalized_x >= 0 and normalized_x <= 1)),
  check (normalized_y is null or (normalized_y >= 0 and normalized_y <= 1)),
  check (scroll_depth is null or (scroll_depth >= 0 and scroll_depth <= 100))
);

create index if not exists website_analytics_events_project_time_idx
  on public.website_analytics_events(project_id, occurred_at desc);
create index if not exists website_analytics_events_profile_type_time_idx
  on public.website_analytics_events(analytics_profile_id, event_type, occurred_at desc);

create table if not exists public.website_analytics_daily_rollups (
  id uuid primary key default gen_random_uuid(),
  analytics_profile_id uuid not null references public.website_analytics_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  rollup_date date not null,
  page_views integer not null default 0,
  clicks integer not null default 0,
  max_scroll_depth smallint,
  heatpoint_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique(project_id, rollup_date)
);

alter table public.website_analytics_profiles enable row level security;
alter table public.website_analytics_events enable row level security;
alter table public.website_analytics_daily_rollups enable row level security;

revoke all on table public.website_analytics_profiles from public, anon;
revoke all on table public.website_analytics_events from public, anon, authenticated;
revoke all on table public.website_analytics_daily_rollups from public, anon;

grant select on public.website_analytics_profiles to authenticated;
grant select on public.website_analytics_daily_rollups to authenticated;
grant select, insert, update, delete on public.website_analytics_profiles to service_role;
grant select, insert, update, delete on public.website_analytics_events to service_role;
grant select, insert, update, delete on public.website_analytics_daily_rollups to service_role;

create policy owner_manage_website_analytics_profiles
on public.website_analytics_profiles for all to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));

create policy client_view_own_website_analytics_profile
on public.website_analytics_profiles for select to authenticated
using (exists (
  select 1 from public.clients c
  where c.id = website_analytics_profiles.client_id and c.auth_user_id = auth.uid()
));

create policy owner_view_website_analytics_rollups
on public.website_analytics_daily_rollups for select to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));

create policy client_view_own_website_analytics_rollups
on public.website_analytics_daily_rollups for select to authenticated
using (exists (
  select 1 from public.clients c
  where c.id = website_analytics_daily_rollups.client_id and c.auth_user_id = auth.uid()
));

create or replace function public.configure_website_analytics_for_project(target_client_id uuid, target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  advanced_access jsonb;
  mouse_access jsonb;
  profile_row public.website_analytics_profiles%rowtype;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;

  if not exists (
    select 1 from public.projects p where p.id = target_project_id and p.client_id = target_client_id
  ) then
    raise exception 'Project/client relationship not found.';
  end if;

  advanced_access := public.client_feature_access(target_client_id, 'advanced_analytics');
  mouse_access := public.client_feature_access(target_client_id, 'mouse_tracking');

  insert into public.website_analytics_profiles (
    client_id, project_id, status, consent_mode,
    page_view_enabled, click_enabled, scroll_depth_enabled,
    mouse_tracking_enabled, retention_days
  ) values (
    target_client_id,
    target_project_id,
    case when coalesce((advanced_access->>'allowed')::boolean, false) then 'enabled' else 'disabled' end,
    'required',
    true,
    true,
    true,
    coalesce((mouse_access->>'allowed')::boolean, false),
    case when coalesce((mouse_access->>'allowed')::boolean, false) then 90 else 30 end
  )
  on conflict (project_id) do update
  set status = excluded.status,
      mouse_tracking_enabled = excluded.mouse_tracking_enabled,
      retention_days = excluded.retention_days,
      updated_at = now()
  returning * into profile_row;

  return jsonb_build_object(
    'ok', true,
    'analytics_profile_id', profile_row.id,
    'status', profile_row.status,
    'mouse_tracking_enabled', profile_row.mouse_tracking_enabled,
    'consent_mode', profile_row.consent_mode,
    'retention_days', profile_row.retention_days
  );
end;
$$;

revoke all on function public.configure_website_analytics_for_project(uuid, uuid) from public, anon, authenticated;
grant execute on function public.configure_website_analytics_for_project(uuid, uuid) to service_role;
grant execute on function public.configure_website_analytics_for_project(uuid, uuid) to authenticated;

create or replace function public.rollup_website_analytics_day(target_date date default (current_date - 1))
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  insert into public.website_analytics_daily_rollups (
    analytics_profile_id, client_id, project_id, rollup_date,
    page_views, clicks, max_scroll_depth, heatpoint_count, summary
  )
  select
    e.analytics_profile_id,
    e.client_id,
    e.project_id,
    target_date,
    count(*) filter (where e.event_type = 'page_view')::integer,
    count(*) filter (where e.event_type = 'click')::integer,
    max(e.scroll_depth) filter (where e.event_type = 'scroll_depth'),
    count(*) filter (where e.event_type = 'mouse_heatpoint')::integer,
    jsonb_build_object('source','privacy_safe_raw_events','generated_at',now())
  from public.website_analytics_events e
  where e.occurred_at >= target_date::timestamptz
    and e.occurred_at < (target_date + 1)::timestamptz
  group by e.analytics_profile_id, e.client_id, e.project_id
  on conflict (project_id, rollup_date) do update
  set page_views = excluded.page_views,
      clicks = excluded.clicks,
      max_scroll_depth = excluded.max_scroll_depth,
      heatpoint_count = excluded.heatpoint_count,
      summary = excluded.summary,
      generated_at = now();

  get diagnostics changed = row_count;
  return jsonb_build_object('ok', true, 'rollup_date', target_date, 'projects_updated', changed);
end;
$$;

revoke all on function public.rollup_website_analytics_day(date) from public, anon, authenticated;
grant execute on function public.rollup_website_analytics_day(date) to service_role;

create or replace function public.cleanup_expired_website_analytics_events()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;

  delete from public.website_analytics_events e
  using public.website_analytics_profiles p
  where p.id = e.analytics_profile_id
    and e.occurred_at < now() - make_interval(days => p.retention_days);

  get diagnostics deleted_count = row_count;
  return jsonb_build_object('ok', true, 'deleted_events', deleted_count, 'ran_at', now());
end;
$$;

revoke all on function public.cleanup_expired_website_analytics_events() from public, anon, authenticated;
grant execute on function public.cleanup_expired_website_analytics_events() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-analytics-retention-cleanup-daily') then
    perform cron.unschedule('nxq-analytics-retention-cleanup-daily');
  end if;
end;
$$;

select cron.schedule(
  'nxq-analytics-retention-cleanup-daily',
  '27 4 * * *',
  $$select public.cleanup_expired_website_analytics_events();$$
);

comment on table public.website_analytics_events is
  'Raw privacy-limited analytics events. Public clients cannot insert directly; use a future protected ingest worker with entitlement + consent + abuse controls.';