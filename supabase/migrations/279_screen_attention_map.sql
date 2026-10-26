-- 279: Intelligence "screen attention map" (the heat-map). Promoted from draft 13 on 2026-10-26 with the owner's approval (Option A); NOT applied until the owner approves the apply.
--
-- What the data really is (read from templates/business-v1/analytics.js): each heat point is the visitor's pointer position as a FRACTION OF THEIR VISIBLE SCREEN
-- (clientX / window width, clientY / window height), sampled at most every 0.75 s, only after the visitor allowed analytics and only when the plan collects mouse tracking.
-- The scroll position is NOT stored, so a point cannot be placed on the page layout. This function therefore returns a SCREEN map: for one page, a 16 x 10 grid of how often
-- visitors' pointers rested in each part of their screen. It must be described that way everywhere; it is not an overlay of the page.
--
-- One new read-only function, no table or column changes. website_analytics_events stays closed to signed-in users (revoke all, migration 131); this is the only way a client reads it.
--
-- Security and privacy rules (all enforced here, not in the browser):
--  * Signed-in client only, and only that client's own newest project (same lookup as the other current_client_* functions).
--  * The plan must include the feature: current_client_feature_access('behavior_heatmaps') (Intelligence and Enterprise). Otherwise it raises.
--  * The project's analytics profile must be enabled AND have mouse tracking switched on; otherwise it returns enabled=false with a reason instead of any numbers.
--  * k-anonymity: a page is only listed once at least 10 different visitor sessions produced points on it, and a grid cell is only returned when at least 3 different sessions
--    contributed to it, so no cell can describe one person. Sessions are the anonymous per-tab random keys the tracker generates (no IP address, no identity is stored).
--  * Page paths are cut at '?' and '#' (query strings can carry tokens) and at most 10 pages are returned.
--  * The window is limited by the profile's own retention_days and never more than 90 days.
-- EXECUTE is granted to authenticated only.

create or replace function public.current_client_screen_attention_map(target_page_path text default null, target_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  grid_cols constant integer := 16;
  grid_rows constant integer := 10;
  min_sessions_page constant integer := 10;
  min_sessions_cell constant integer := 3;
  client_id_value uuid;
  project_id_value uuid;
  profile_row record;
  access jsonb;
  days_value integer;
  since_value timestamptz;
  pages_json jsonb;
  chosen_path text;
  chosen_points integer := 0;
  chosen_sessions integer := 0;
  cells_json jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;

  select id into client_id_value
  from public.clients
  where auth_user_id = auth.uid()
  order by created_at desc
  limit 1;
  if client_id_value is null then
    raise exception 'Client account was not found.';
  end if;

  access := public.current_client_feature_access('behavior_heatmaps');
  if not coalesce((access ->> 'allowed')::boolean, false) then
    raise exception 'The screen attention map is not included in this plan.';
  end if;

  select p.id into project_id_value
  from public.projects p
  where p.client_id = client_id_value
  order by p.created_at desc
  limit 1;

  select * into profile_row
  from public.website_analytics_profiles
  where project_id = project_id_value;

  if project_id_value is null or profile_row.id is null then
    return jsonb_build_object('enabled', false, 'reason', 'no_analytics_profile');
  end if;
  if profile_row.status <> 'enabled' or not profile_row.mouse_tracking_enabled then
    return jsonb_build_object('enabled', false, 'reason', 'mouse_tracking_off');
  end if;

  days_value := least(greatest(coalesce(target_days, 30), 1), least(90, profile_row.retention_days));
  since_value := now() - make_interval(days => days_value);

  with ev as materialized (
    select split_part(split_part(e.page_path, '?', 1), '#', 1) as path,
           coalesce(e.anonymous_session_key, 'event-' || e.id::text) as sess
    from public.website_analytics_events e
    where e.analytics_profile_id = profile_row.id
      and e.event_type = 'mouse_heatpoint'
      and e.occurred_at >= since_value
      and e.normalized_x is not null
      and e.normalized_y is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('path', t.path, 'sessions', t.sessions, 'points', t.points) order by t.points desc, t.path), '[]'::jsonb)
    into pages_json
  from (
    select path, count(*)::integer as points, count(distinct sess)::integer as sessions
    from ev
    group by path
    having count(distinct sess) >= min_sessions_page
    order by count(*) desc, path
    limit 10
  ) t;

  chosen_path := nullif(left(btrim(coalesce(target_page_path, '')), 500), '');
  if chosen_path is null or not exists (select 1 from jsonb_array_elements(pages_json) pg where pg ->> 'path' = chosen_path) then
    chosen_path := pages_json -> 0 ->> 'path';
  end if;

  if chosen_path is not null then
    select (pg ->> 'points')::integer, (pg ->> 'sessions')::integer into chosen_points, chosen_sessions
    from jsonb_array_elements(pages_json) pg where pg ->> 'path' = chosen_path;

    select coalesce(jsonb_agg(jsonb_build_object('x', c.cx, 'y', c.cy, 'points', c.points) order by c.cy, c.cx), '[]'::jsonb)
      into cells_json
    from (
      select least(grid_cols - 1, floor(e.normalized_x * grid_cols))::integer as cx,
             least(grid_rows - 1, floor(e.normalized_y * grid_rows))::integer as cy,
             count(*)::integer as points
      from public.website_analytics_events e
      where e.analytics_profile_id = profile_row.id
        and e.event_type = 'mouse_heatpoint'
        and e.occurred_at >= since_value
        and e.normalized_x is not null
        and e.normalized_y is not null
        and split_part(split_part(e.page_path, '?', 1), '#', 1) = chosen_path
      group by 1, 2
      having count(distinct coalesce(e.anonymous_session_key, 'event-' || e.id::text)) >= min_sessions_cell
    ) c;
  end if;

  return jsonb_build_object(
    'enabled', true,
    'days', days_value,
    'cols', grid_cols,
    'rows', grid_rows,
    'min_sessions_page', min_sessions_page,
    'min_sessions_cell', min_sessions_cell,
    'pages', pages_json,
    'page', chosen_path,
    'sessions', chosen_sessions,
    'points', chosen_points,
    'cells', cells_json
  );
end;
$$;

revoke all on function public.current_client_screen_attention_map(text, integer) from public, anon;
grant execute on function public.current_client_screen_attention_map(text, integer) to authenticated;

comment on function public.current_client_screen_attention_map(text, integer) is
  'Client-only, read-only. A 16 x 10 grid of where visitors'' pointers rested on their visible screen for one page (positions are fractions of the screen, not of the page). Pages need 10 sessions and cells 3 sessions (k-anonymity); paths are cut at ? and #; plan feature behavior_heatmaps and an enabled analytics profile with mouse tracking are required.';
