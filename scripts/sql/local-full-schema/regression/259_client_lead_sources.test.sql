-- Regression test for migration 259. Rolled back. Proves the lead-source function returns correct, sanitized, aggregated counts for the
-- signed-in client only, returns no personal data, clamps its window, and stays authenticated-only.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','alpha@synthetic.invalid','',now(),'{}','{"business_name":"Alpha Tree Care","product_family_slug":"business","product_tier_key":"growth"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','beta@synthetic.invalid','',now(),'{}','{"business_name":"Beta Roofing","product_family_slug":"business","product_tier_key":"growth"}');

do $$ declare a uuid; b uuid; begin
  select id into a from public.clients where auth_user_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select id into b from public.clients where auth_user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if a is null or b is null then raise exception 'client fixtures were not created (test would be vacuous)'; end if;

  -- Alpha: 7 countable leads in the window, plus one spam, plus one older than 90 days
  insert into public.client_leads(client_id, status, utm, contact_name, contact_email, message, created_at) values
    (a, 'new',       '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"spring-storm"}', 'Secret Person One', 'one@private.invalid', 'private message one', now() - interval '2 days'),
    (a, 'won',       '{"utm_source":"  GOOGLE ","utm_medium":"cpc","utm_campaign":"spring-storm"}', 'Secret Person Two', 'two@private.invalid', 'private message two', now() - interval '5 days'),
    (a, 'qualified', '{"utm_source":"facebook","utm_medium":"social"}', null, null, null, now() - interval '9 days'),
    (a, 'lost',      '{}', null, null, null, now() - interval '10 days'),
    (a, 'new',       '{"utm_source":"<script>alert(1)</script>"}', null, null, null, now() - interval '11 days'),
    (a, 'contacted', '{"utm_source":"google","utm_medium":"organic"}', null, null, null, now() - interval '12 days'),
    (a, 'won',       '[]', null, null, null, now() - interval '13 days'),
    (a, 'spam',      '{"utm_source":"spambot"}', null, null, null, now() - interval '1 day'),
    (a, 'new',       '{"utm_source":"too-old"}', null, null, null, now() - interval '120 days');
  -- long value must be truncated; non-object and numeric values must not crash
  insert into public.client_leads(client_id, status, utm, created_at) values
    (a, 'new', jsonb_build_object('utm_source', repeat('x', 500)), now() - interval '3 days'),
    (a, 'new', '{"utm_source":12345}', now() - interval '3 days');
  -- Beta: its own leads must never appear for Alpha
  insert into public.client_leads(client_id, status, utm, created_at) values
    (b, 'won', '{"utm_source":"betaonly","utm_campaign":"betacampaign"}', now() - interval '1 day'),
    (b, 'new', '{"utm_source":"betaonly"}', now() - interval '1 day');
end $$;

-- privileges
do $$ begin
  if has_function_privilege('anon', 'public.current_client_lead_sources(integer)', 'execute') then raise exception 'anon can execute'; end if;
  if has_function_privilege('service_role', 'public.current_client_lead_sources(integer)', 'execute') then raise exception 'service_role can execute (must be authenticated only)'; end if;
  if not has_function_privilege('authenticated', 'public.current_client_lead_sources(integer)', 'execute') then raise exception 'authenticated cannot execute'; end if;
end $$;

-- as Alpha
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ declare r jsonb; txt text; g jsonb; begin
  r := public.current_client_lead_sources(90);
  txt := r::text;

  -- window and spam handling: 7 named + 2 awkward (long, numeric) = 9 countable; spam and the 120-day-old lead are excluded
  if (r->>'days')::int <> 90 then raise exception 'days wrong: %', r->>'days'; end if;
  if (r->>'total')::int <> 9 then raise exception 'total should be 9, got %', r->>'total'; end if;

  -- sources: google = 3 (one padded/upper-case), 1 won; facebook = 1
  select e into g from jsonb_array_elements(r->'sources') e where e->>'value' = 'google';
  if g is null or (g->>'leads')::int <> 3 or (g->>'won')::int <> 1 then raise exception 'google row wrong: %', g; end if;
  select e into g from jsonb_array_elements(r->'sources') e where e->>'value' = 'facebook';
  if g is null or (g->>'leads')::int <> 1 then raise exception 'facebook row wrong: %', g; end if;

  -- untagged leads are grouped under a null value (the UI decides how to label it): lost + won('[]') = 2
  select e into g from jsonb_array_elements(r->'sources') e where e->'value' = 'null'::jsonb;
  if g is null or (g->>'leads')::int <> 2 or (g->>'won')::int <> 1 then raise exception 'untagged row wrong: %', g; end if;

  -- tagged counts only leads that carry any utm field: google(3)+facebook(1)+script(1)+long(1)+numeric(1) = 7
  if (r->>'tagged')::int <> 7 then raise exception 'tagged should be 7, got %', r->>'tagged'; end if;

  -- mediums and campaigns
  select e into g from jsonb_array_elements(r->'mediums') e where e->>'value' = 'cpc';
  if g is null or (g->>'leads')::int <> 2 or (g->>'won')::int <> 1 then raise exception 'cpc row wrong: %', g; end if;
  select e into g from jsonb_array_elements(r->'campaigns') e where e->>'value' = 'spring-storm';
  if g is null or (g->>'leads')::int <> 2 then raise exception 'campaign row wrong: %', g; end if;

  -- the channel is still the stored source ('website')
  select e into g from jsonb_array_elements(r->'channels') e where e->>'value' = 'website';
  if g is null or (g->>'leads')::int <> 9 then raise exception 'channel row wrong: %', g; end if;

  -- sanitisation: no markup characters, nothing over 60 chars, hostile text neutralised
  if txt ~ '[<>/()]' then raise exception 'unsafe characters in output: %', txt; end if;
  if exists (select 1 from jsonb_array_elements(r->'sources') e where length(coalesce(e->>'value','')) > 60) then raise exception 'value over 60 chars'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'sources') e where e->>'value' = 'scriptalert1script') then raise exception 'script value was not reduced to safe text'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'sources') e where e->>'value' = repeat('x', 60)) then raise exception 'long value was not truncated to 60'; end if;

  -- isolation and privacy
  if txt like '%betaonly%' or txt like '%betacampaign%' then raise exception 'another client''s data leaked'; end if;
  if txt like '%spambot%' or txt like '%too-old%' then raise exception 'spam or out-of-window lead counted'; end if;
  if txt ~* 'secret person|private\.invalid|private message|@' then raise exception 'personal data in output'; end if;
  if jsonb_typeof(r->'sources') <> 'array' or jsonb_array_length(r->'sources') > 10 then raise exception 'sources not a capped array'; end if;

  -- window clamping and shorter window
  if (public.current_client_lead_sources(0)->>'days')::int <> 1 then raise exception 'days not clamped up to 1'; end if;
  if (public.current_client_lead_sources(1000)->>'days')::int <> 365 then raise exception 'days not clamped to 365'; end if;
  if (public.current_client_lead_sources(null)->>'days')::int <> 90 then raise exception 'null days not defaulted to 90'; end if;
  if (public.current_client_lead_sources(7)->>'total')::int <> 4 then raise exception '7-day window should hold 4 leads (2, 3, 3 and 5 days ago), got %', public.current_client_lead_sources(7)->>'total'; end if;
  if (public.current_client_lead_sources(365)->>'total')::int <> 10 then raise exception '365-day window should include the 120-day-old lead, got %', public.current_client_lead_sources(365)->>'total'; end if;
end $$;

-- as Beta: sees only its own two leads
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := public.current_client_lead_sources(90);
  if (r->>'total')::int <> 2 then raise exception 'beta total should be 2, got %', r->>'total'; end if;
  if r::text like '%google%' then raise exception 'alpha data leaked to beta'; end if;
end $$;

-- a signed-out caller is refused
reset role;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform public.current_client_lead_sources(90);
    raise exception 'signed-out call was not refused';
  exception when others then
    if sqlerrm = 'signed-out call was not refused' then raise; end if;
  end;
end $$;

select 'DRAFT_TEST_OK';
rollback;
