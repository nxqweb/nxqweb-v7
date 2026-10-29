-- Regression test for migration 279 (screen attention map). Rolled back. Must end by selecting DRAFT_TEST_OK.
-- Proves, on a real database: the exact grid; pages and cells below the privacy thresholds are never returned; query strings are cut; only mouse heat points count; the time window
-- works; one client never sees another's data; the plan, status and profile gates; and the privileges.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@synthetic.invalid','',now(),'{}','{"business_name":"Heat Client A"}'),
 ('dddddddd-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@synthetic.invalid','',now(),'{}','{"business_name":"Heat Client B"}'),
 ('dddddddd-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','growth@synthetic.invalid','',now(),'{}','{"business_name":"Heat Growth Co"}'),
 ('dddddddd-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','off@synthetic.invalid','',now(),'{}','{"business_name":"Heat Off Co"}'),
 ('dddddddd-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','noproject@synthetic.invalid','',now(),'{}','{"business_name":"Heat No Project Co"}'),
 ('dddddddd-0000-0000-0000-00000000000f','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lead@synthetic.invalid','',now(),'{}','{"business_name":"Heat Lead Co"}');

-- tiers: Intelligence for A, B, Off, NoProject and Lead; Growth for the Growth client. Everyone approved except the lead client.
update public.clients c set product_family_id = (select id from public.product_families where slug = 'business'),
  product_tier_id = (select t.id from public.product_family_tiers t join public.product_families f on f.id = t.product_family_id where f.slug = 'business' and t.tier_key = 'intelligence'),
  status = 'approved'
 where business_name in ('Heat Client A', 'Heat Client B', 'Heat Off Co', 'Heat No Project Co');
update public.clients c set product_family_id = (select id from public.product_families where slug = 'business'),
  product_tier_id = (select t.id from public.product_family_tiers t join public.product_families f on f.id = t.product_family_id where f.slug = 'business' and t.tier_key = 'growth'),
  status = 'approved'
 where business_name = 'Heat Growth Co';
update public.clients c set product_family_id = (select id from public.product_families where slug = 'business'),
  product_tier_id = (select t.id from public.product_family_tiers t join public.product_families f on f.id = t.product_family_id where f.slug = 'business' and t.tier_key = 'intelligence')
 where business_name = 'Heat Lead Co';

-- the gate also needs billing to be in good standing (migration 246)
update public.clients set billing_status = 'active', billing_provider = 'manual' where business_name in ('Heat Client A', 'Heat Client B', 'Heat Growth Co', 'Heat Off Co', 'Heat No Project Co');

insert into public.projects(client_id, project_name)
select id, business_name || ' Website Project' from public.clients where business_name in ('Heat Client A', 'Heat Client B', 'Heat Growth Co', 'Heat Off Co', 'Heat Lead Co');
insert into public.website_analytics_profiles(client_id, project_id, status, mouse_tracking_enabled, retention_days, allowed_origins)
select p.client_id, p.id,
       case when c.business_name = 'Heat Off Co' then 'disabled' else 'enabled' end,
       c.business_name <> 'Heat Off Co', 90, array['https://heat.synthetic.invalid']
  from public.projects p join public.clients c on c.id = p.client_id
 where c.business_name in ('Heat Client A', 'Heat Client B', 'Heat Growth Co', 'Heat Off Co', 'Heat Lead Co');

-- helper: add n points for a set of sessions (session ids s01.. with the given prefix)
create function pg_temp.add_points(who text, path text, prefix text, sessions int, per_session int, x numeric, y numeric, days_ago int default 0, kind text default 'mouse_heatpoint') returns void language plpgsql as $f$
begin
  insert into public.website_analytics_events(analytics_profile_id, client_id, project_id, event_type, page_path, anonymous_session_key, normalized_x, normalized_y, occurred_at)
  select prof.id, prof.client_id, prof.project_id, kind, path, prefix || lpad(s::text, 2, '0'), x, y, now() - make_interval(days => days_ago) - make_interval(secs => p)
    from public.website_analytics_profiles prof join public.clients c on c.id = prof.client_id,
         generate_series(1, sessions) s, generate_series(1, per_session) p
   where c.business_name = who;
end $f$;

-- Client A
select pg_temp.add_points('Heat Client A', '/', 's', 12, 4, 0.52, 0.12);                       -- cell (8,1): 12 sessions
select pg_temp.add_points('Heat Client A', '/', 's', 12, 1, 0.50, 0.50);                       -- cell (8,5): 12 sessions
select pg_temp.add_points('Heat Client A', '/', 's', 2, 2, 0.95, 0.95);                        -- cell (15,9): only 2 sessions -> must be suppressed
select pg_temp.add_points('Heat Client A', '/?utm_source=secret#top', 't', 3, 1, 0.52, 0.12);  -- the query string must be cut, merging into '/'
select pg_temp.add_points('Heat Client A', '/pricing', 'q', 5, 2, 0.40, 0.40);                 -- only 5 sessions -> the page must not be listed
select pg_temp.add_points('Heat Client A', '/about', 'p', 10, 1, 0.10, 0.10);                  -- exactly 10 sessions -> listed
select pg_temp.add_points('Heat Client A', '/', 'o', 12, 1, 0.30, 0.30, 40);                   -- 40 days old: outside the default 30-day window
select pg_temp.add_points('Heat Client A', '/', 'v', 20, 1, 0.50, 0.50, 0, 'page_view');       -- not mouse points: must be ignored
-- Client B (isolation): lots of data of their own on the same page path
select pg_temp.add_points('Heat Client B', '/', 'b', 20, 3, 0.90, 0.10);
-- the Growth client has data too, but must not be allowed to read it
select pg_temp.add_points('Heat Growth Co', '/', 'g', 12, 2, 0.20, 0.20);

-- privileges
do $$ begin
  if has_function_privilege('anon', 'public.current_client_screen_attention_map(text,integer)', 'execute') then raise exception 'anon can execute the map'; end if;
  if not has_function_privilege('authenticated', 'public.current_client_screen_attention_map(text,integer)', 'execute') then raise exception 'authenticated cannot execute the map'; end if;
  if has_table_privilege('anon', 'public.website_analytics_events', 'select') or has_table_privilege('authenticated', 'public.website_analytics_events', 'select') then raise exception 'the raw events table became readable'; end if;
end $$;

-- ===== Client A =====
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.current_client_screen_attention_map();
  if r->>'enabled' <> 'true' then raise exception 'A: expected enabled, got %', r; end if;
  if (r->>'days')::int <> 30 or (r->>'cols')::int <> 16 or (r->>'rows')::int <> 10 then raise exception 'A: wrong days/grid: %', r; end if;
  -- pages: '/' (48+12+4+3 = 67 points, 12+3 = 15 sessions) then '/about' (10, 10); '/pricing' (5 sessions) is NOT listed; the 40-day-old points are not counted
  if r->'pages' <> '[{"path":"/","points":67,"sessions":15},{"path":"/about","points":10,"sessions":10}]'::jsonb then raise exception 'A: wrong pages: %', r->'pages'; end if;
  if r->>'page' <> '/' or (r->>'points')::int <> 67 or (r->>'sessions')::int <> 15 then raise exception 'A: wrong chosen page: %', r; end if;
  -- cells: (8,1) = 48 + 3 = 51 points; (8,5) = 12; the 2-session cell (15,9) is suppressed; nothing from Client B at (14,1)
  if r->'cells' <> '[{"x":8,"y":1,"points":51},{"x":8,"y":5,"points":12}]'::jsonb then raise exception 'A: wrong cells: %', r->'cells'; end if;
  if r::text like '%secret%' or r::text like '%utm_source%' then raise exception 'A: a query string leaked: %', r; end if;
  if r::text like '%anonymous%' or r::text like '%session_key%' or r->'cells' @> '[{"x":14}]'::jsonb then raise exception 'A: private or foreign data in the answer'; end if;

  -- asking for a listed page
  r := public.current_client_screen_attention_map('/about');
  if r->>'page' <> '/about' or r->'cells' <> '[{"x":1,"y":1,"points":10}]'::jsonb then raise exception 'A: /about wrong: %', r; end if;
  -- asking for a page that is not listed (too few sessions) or that does not exist falls back to the top page, never reveals a thin page
  r := public.current_client_screen_attention_map('/pricing');
  if r->>'page' <> '/' then raise exception 'A: /pricing should fall back to the top page, got %', r->>'page'; end if;
  r := public.current_client_screen_attention_map('/does-not-exist');
  if r->>'page' <> '/' then raise exception 'A: unknown page should fall back, got %', r->>'page'; end if;
  -- the query-string form of a path is treated as the same page
  r := public.current_client_screen_attention_map('/?utm_source=secret');
  if r->>'page' <> '/' then raise exception 'A: query-string request should fall back to the clean page, got %', r->>'page'; end if;

  -- the window: 60 days brings in the 40-day-old points (12 sessions at one cell, so that cell appears), 500 is cut to the 90-day maximum, 0 and null are safe
  r := public.current_client_screen_attention_map(null, 60);
  if (r->>'days')::int <> 60 or (r->>'points')::int <> 79 or r->'cells' <> '[{"x":8,"y":1,"points":51},{"x":4,"y":3,"points":12},{"x":8,"y":5,"points":12}]'::jsonb then raise exception 'A: 60-day window wrong: %', r; end if;
  r := public.current_client_screen_attention_map(null, 500);
  if (r->>'days')::int <> 90 then raise exception 'A: days not capped at 90: %', r->>'days'; end if;
  r := public.current_client_screen_attention_map(null, 0);
  if (r->>'days')::int <> 1 then raise exception 'A: days not raised to 1: %', r->>'days'; end if;
  r := public.current_client_screen_attention_map(null, null);
  if (r->>'days')::int <> 30 then raise exception 'A: null days should mean 30, got %', r->>'days'; end if;
end $$;
reset role;

-- ===== Client B only ever sees their own data (same page path, different numbers) =====
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-00000000000b', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.current_client_screen_attention_map();
  if r->'pages' <> '[{"path":"/","points":60,"sessions":20}]'::jsonb then raise exception 'B: wrong pages: %', r->'pages'; end if;
  if r->'cells' <> '[{"x":14,"y":1,"points":60}]'::jsonb then raise exception 'B: wrong cells (must be only their own): %', r->'cells'; end if;
end $$;
reset role;

-- ===== the gates =====
-- Growth client: the plan does not include it, even though data exists
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-00000000000c', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.current_client_screen_attention_map(); raise exception 'a Growth client could read the map';
  exception when others then if sqlerrm not like '%not included in this plan%' then raise; end if; end;
end $$;
reset role;
-- an Intelligence client who is not approved yet
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-00000000000f', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000f","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.current_client_screen_attention_map(); raise exception 'an unapproved client could read the map';
  exception when others then if sqlerrm not like '%not included in this plan%' then raise; end if; end;
end $$;
reset role;
-- mouse tracking switched off for the project: no numbers, a plain reason
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-00000000000d', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.current_client_screen_attention_map();
  if r <> '{"enabled":false,"reason":"mouse_tracking_off"}'::jsonb then raise exception 'Off client: wrong answer %', r; end if;
end $$;
reset role;
-- no project yet
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-00000000000e', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000e","role":"authenticated"}', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.current_client_screen_attention_map();
  if r <> '{"enabled":false,"reason":"no_analytics_profile"}'::jsonb then raise exception 'No-project client: wrong answer %', r; end if;
end $$;
reset role;
-- a visitor with no account at all
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin
  begin perform public.current_client_screen_attention_map(); raise exception 'anon could call the map';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select 'DRAFT_TEST_OK';
