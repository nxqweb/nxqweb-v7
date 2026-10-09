-- Sidecar test for draft 03 (rollup top pages). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','toppages@synthetic.invalid','',now(),'{}','{"business_name":"Top Pages Co","product_family_slug":"business","product_tier_key":"growth"}');

do $$
declare c uuid; p uuid; prof uuid; r jsonb; pages jsonb; roll record; i int; n int;
begin
  select id into c from public.clients where auth_user_id = 'dddddddd-0000-0000-0000-000000000001';
  if c is null then raise exception 'client fixture missing (test would be vacuous)'; end if;
  insert into public.projects(client_id, project_name) values (c, 'Top pages site') returning id into p;
  insert into public.website_analytics_profiles(client_id, project_id, status) values (c, p, 'paused') returning id into prof;

  -- /a: 4 views (2 of them with a query string that must be merged), 2 clicks, scroll 80 and 55.   /b: exactly 3 views.   /c: only 2 views (hidden).
  insert into public.website_analytics_events(analytics_profile_id,client_id,project_id,event_type,page_path,scroll_depth,occurred_at)
  select prof,c,p,'page_view','/a',null,now() from generate_series(1,2);
  insert into public.website_analytics_events(analytics_profile_id,client_id,project_id,event_type,page_path,scroll_depth,occurred_at) values
    (prof,c,p,'page_view','/a?email=jane@example.com',null,now()),
    (prof,c,p,'page_view','/a#team',null,now()),
    (prof,c,p,'click','/a',null,now()), (prof,c,p,'click','/a?x=1',null,now()),
    (prof,c,p,'scroll_depth','/a',80,now()), (prof,c,p,'scroll_depth','/a',55,now());
  insert into public.website_analytics_events(analytics_profile_id,client_id,project_id,event_type,page_path,occurred_at)
  select prof,c,p,'page_view','/b',now() from generate_series(1,3);
  insert into public.website_analytics_events(analytics_profile_id,client_id,project_id,event_type,page_path,occurred_at)
  select prof,c,p,'page_view','/c',now() from generate_series(1,2);
  -- 12 more pages with 5 views each: only the top 10 overall may be kept.
  for i in 1..12 loop
    insert into public.website_analytics_events(analytics_profile_id,client_id,project_id,event_type,page_path,occurred_at)
    select prof,c,p,'page_view','/many-'||lpad(i::text,2,'0'),now() from generate_series(1,5);
  end loop;

  r := public.rollup_website_analytics_day(current_date);
  if (r->>'ok')::boolean is not true then raise exception 'rollup failed: %', r; end if;
  select * into roll from public.website_analytics_daily_rollups where project_id = p and rollup_date = current_date;
  if roll.id is null then raise exception 'rollup row missing'; end if;

  -- daily totals unchanged by the new feature: 4 + 3 + 2 + 60 = 69 views, 2 clicks, max scroll 80
  if roll.page_views <> 69 then raise exception 'daily page_views total must stay 69, got %', roll.page_views; end if;
  if roll.clicks <> 2 then raise exception 'daily clicks total must stay 2, got %', roll.clicks; end if;
  if roll.max_scroll_depth <> 80 then raise exception 'daily max scroll must stay 80, got %', roll.max_scroll_depth; end if;

  pages := roll.summary->'top_pages';
  if pages is null then raise exception 'summary.top_pages is missing: %', roll.summary; end if;
  if jsonb_typeof(pages) is distinct from 'array' then raise exception 'summary.top_pages must be an array: %', roll.summary; end if;
  if jsonb_array_length(pages) <> 10 then raise exception 'top_pages must be capped at 10, got %', jsonb_array_length(pages); end if;
  if (roll.summary->>'top_pages_min_views')::int is distinct from 3 then raise exception 'min views marker missing'; end if;
  if exists (select 1 from jsonb_array_elements(pages) e where e->>'path' like '%?%' or e->>'path' like '%#%') then raise exception 'query strings or fragments leaked into top_pages: %', pages; end if;
  if exists (select 1 from jsonb_array_elements(pages) e where e->>'path' = '/c') then raise exception 'a page with fewer than 3 views must be hidden'; end if;
  if exists (select 1 from jsonb_array_elements(pages) e where (e->>'views')::int < 3) then raise exception 'every listed page needs at least 3 views'; end if;
  if (pages->0->>'views')::int < (pages->9->>'views')::int then raise exception 'top_pages must be ordered by views, descending'; end if;

  -- /a (4 views incl. the query-string and fragment rows) would rank below the 12 five-view pages, so it must be absent from the capped list.
  if exists (select 1 from jsonb_array_elements(pages) e where e->>'path' = '/a') then raise exception '/a has 4 views and must fall outside the top 10 here'; end if;

  -- second scenario: remove the 12 busy pages' views so /a and /b are listed, then check merging and per-page numbers
  delete from public.website_analytics_events where project_id = p and page_path like '/many-%';
  r := public.rollup_website_analytics_day(current_date);
  select * into roll from public.website_analytics_daily_rollups where project_id = p and rollup_date = current_date;
  pages := roll.summary->'top_pages';
  if pages is null or jsonb_typeof(pages) is distinct from 'array' then raise exception 'summary.top_pages is missing after the second rollup: %', roll.summary; end if;
  if jsonb_array_length(pages) <> 2 then raise exception 'expected /a and /b only, got %', pages; end if;
  if pages->0->>'path' <> '/a' or (pages->0->>'views')::int <> 4 then raise exception '/a must merge its query-string and fragment rows into 4 views: %', pages->0; end if;
  if (pages->0->>'clicks')::int <> 2 then raise exception '/a must show 2 clicks (one carried a query string): %', pages->0; end if;
  if (pages->0->>'max_scroll')::int <> 80 then raise exception '/a deepest scroll must be 80: %', pages->0; end if;
  if pages->1->>'path' <> '/b' or (pages->1->>'views')::int <> 3 then raise exception '/b must show 3 views: %', pages->1; end if;
  if (pages->1->'max_scroll') is distinct from 'null'::jsonb then raise exception '/b has no scroll events, max_scroll must be null: %', pages->1; end if;
  if (select count(*) from public.website_analytics_daily_rollups where project_id = p and rollup_date = current_date) <> 1 then raise exception 're-running the rollup must update the same row'; end if;

  -- privileges unchanged
  if has_function_privilege('anon','public.rollup_website_analytics_day(date)','execute') then raise exception 'anon must not execute the rollup'; end if;
  if has_function_privilege('authenticated','public.rollup_website_analytics_day(date)','execute') then raise exception 'authenticated must not execute the rollup'; end if;
  if not has_function_privilege('service_role','public.rollup_website_analytics_day(date)','execute') then raise exception 'service_role must execute the rollup'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
