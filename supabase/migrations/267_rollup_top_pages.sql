-- Daily analytics rollups also store the day's top pages (docs/PAGE_INTERACTION_REVIEW_PLAN.md, option 1, owner chose it 2026-10-09).
-- Replaces public.rollup_website_analytics_day(date) from migration 131. The daily totals are computed exactly as before; the only addition is
-- summary.top_pages: up to 10 pages for the day, each { path, views, clicks, max_scroll }, ordered by views.
--  * Only pages with at least 3 views that day are listed (summary.top_pages_min_views), so one visitor cannot be singled out by a rare path.
--  * The path is cut at the first ? or # (older raw rows may still carry query strings; they must never reach a client-readable table).
--  * Pages appear only when the underlying events exist: nothing is inferred or invented.
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
  with day_events as (
    select e.*, coalesce(nullif(split_part(split_part(e.page_path, '?', 1), '#', 1), ''), '/') as clean_path
    from public.website_analytics_events e
    where e.occurred_at >= target_date::timestamptz
      and e.occurred_at < (target_date + 1)::timestamptz
  ),
  page_stats as (
    select project_id, clean_path,
      count(*) filter (where event_type = 'page_view')::integer as views,
      count(*) filter (where event_type = 'click')::integer as clicks,
      max(scroll_depth) filter (where event_type = 'scroll_depth') as max_scroll
    from day_events
    group by project_id, clean_path
  ),
  top_pages as (
    select project_id,
      jsonb_agg(jsonb_build_object('path', clean_path, 'views', views, 'clicks', clicks, 'max_scroll', max_scroll) order by views desc, clean_path) as pages
    from (
      select s.*, row_number() over (partition by project_id order by views desc, clean_path) as rn
      from page_stats s
      where views >= 3
    ) ranked
    where rn <= 10
    group by project_id
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
    jsonb_build_object(
      'source', 'privacy_safe_raw_events',
      'generated_at', now(),
      'top_pages', coalesce(tp.pages, '[]'::jsonb),
      'top_pages_min_views', 3
    )
  from day_events e
  left join top_pages tp on tp.project_id = e.project_id
  group by e.analytics_profile_id, e.client_id, e.project_id, tp.pages
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
