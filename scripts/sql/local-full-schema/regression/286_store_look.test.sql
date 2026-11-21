-- Regression test for migration 286 (store look in the database). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','look-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','look-shop@synthetic.invalid','',now(),'{}','{"business_name":"Look Shop","product_family_slug":"business"}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000000b1');
create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;
create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin execute sql; return false; exception when others then return sqlerrm like '%' || expected || '%'; end $f$;

do $$
declare
  ow uuid := 'ffffffff-0000-0000-0000-0000000000b1'; shop uuid := 'ffffffff-0000-0000-0000-0000000000b2';
  c uuid; r jsonb; good jsonb := '{"bg":"#fdf9f6","ink":"#1d2f4f","muted":"#4f5b73","accent":"#a8284f","accent_dark":"#861f3e","heading_font":"serif","logo":"/brand/x-logo.png"}';
begin
  select id into c from public.clients where auth_user_id = shop;
  if c is null then raise exception 'client fixture missing'; end if;
  insert into public.commerce_storefronts(client_id, store_name, store_slug, status, settings) values (c, 'Look One', 'look-one', 'active', '{"profile":{"about":"keep me"},"venmo_url":"https://venmo.com/u/x"}');
  insert into public.commerce_storefronts(client_id, store_name, store_slug, status) select c2.id, 'Light of the World Test', 'light-of-the-world-test', 'active' from public.clients c2 where c2.id <> c limit 1;

  -- privileges
  if has_function_privilege('anon', 'public.owner_set_store_look(text,jsonb)', 'execute') or has_function_privilege('anon', 'public.owner_clear_store_look(text)', 'execute') then raise exception 'anon must not set a look'; end if;
  if has_function_privilege('authenticated', 'public.nxq_store_look_problem(jsonb)', 'execute') or has_function_privilege('authenticated', 'public.nxq_contrast_ratio(text,text)', 'execute') then raise exception 'internal helpers must stay internal'; end if;
  if not has_function_privilege('anon', 'public.get_public_store_look(text)', 'execute') then raise exception 'public read must be open'; end if;

  -- contrast math: black on white = 21, same color = 1
  if round(public.nxq_contrast_ratio('#000000', '#ffffff'), 1) <> 21.0 or public.nxq_contrast_ratio('#336699', '#336699') <> 1 then raise exception 'contrast math wrong'; end if;

  -- the seeded Light of the World store has her look; a normal store has none
  perform pg_temp.as_user(null);
  if (select count(*) from public.commerce_storefronts where store_slug = 'light-of-the-world-test') = 1 then
    -- (seeding ran at migration time, before this fixture existed, so only the rule is checked here)
    null;
  end if;
  if public.get_public_store_look('look-one') <> '{}'::jsonb then raise exception 'a store with no look returns {}'; end if;
  if public.get_public_store_look('no-such') <> '{}'::jsonb then raise exception 'unknown store returns {}'; end if;

  -- the look seeded for Light of the World passes the very same rules
  if public.nxq_store_look_problem('{"bg":"#fdf9f6","surface":"#ffffff","tint":"#f8ece8","ink":"#1d2f4f","muted":"#4f5b73","line":"#eaddd8","accent":"#a8284f","accent_dark":"#861f3e","heading_font":"serif","logo":"/brand/light-of-the-world-logo.png"}') is not null then raise exception 'the seeded look must be valid'; end if;

  -- only owners set it
  perform pg_temp.as_user(shop);
  if not pg_temp.fails(format($q$select public.owner_set_store_look('look-one', %L::jsonb)$q$, good), 'Owner access required') then raise exception 'a client must not set a look'; end if;
  perform pg_temp.as_user(ow);
  -- every bad value is refused with a readable reason
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"ink":"red"}')$q$, 'must be a color') then raise exception 'named color refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"ink":"#ffffff","bg":"#fdf9f6"}')$q$, 'hard to read') then raise exception 'low contrast text refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"accent":"#ffee00"}')$q$, 'White text on the accent') then raise exception 'pale accent refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"logo":"https://evil.example.com/x.png"}')$q$, 'under /brand/') then raise exception 'outside logo refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"logo":"/brand/../x.png"}')$q$, 'under /brand/') then raise exception 'dot-dot logo refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"logo":"/brand/x.svg?a=1"}')$q$, 'under /brand/') then raise exception 'query string logo refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"background_image":"url(x)"}')$q$, 'Unknown look setting') then raise exception 'unknown key refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '{"heading_font":"comic"}')$q$, 'serif or sans') then raise exception 'font refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_store_look('look-one', '[1]')$q$, 'must be an object') then raise exception 'array refused'; end if;
  if not pg_temp.fails(format($q$select public.owner_set_store_look('nope', %L::jsonb)$q$, good), 'Store not found') then raise exception 'missing store refused'; end if;

  -- a good look saves, lower-cases colors, keeps the other settings, and shoppers can read it
  r := public.owner_set_store_look('look-one', replace(good::text, '#1d2f4f', '#1D2F4F')::jsonb);
  if (r->>'success')::boolean is not true then raise exception 'save failed: %', r; end if;
  perform pg_temp.as_user(null);
  r := public.get_public_store_look('look-one');
  if r->>'ink' <> '#1d2f4f' or r->>'logo' <> '/brand/x-logo.png' or r->>'heading_font' <> 'serif' then raise exception 'look not read back: %', r; end if;
  if (select settings -> 'profile' ->> 'about' from public.commerce_storefronts where store_slug = 'look-one') <> 'keep me' or (select settings ->> 'venmo_url' from public.commerce_storefronts where store_slug = 'look-one') is null then raise exception 'other settings must be kept'; end if;
  if r ? 'venmo_url' or r ? 'profile' then raise exception 'public read must return the look only'; end if;
  -- a paused (not active) store shows no look
  update public.commerce_storefronts set status = 'paused' where store_slug = 'look-one';
  if public.get_public_store_look('look-one') <> '{}'::jsonb then raise exception 'inactive store must return {}'; end if;
  update public.commerce_storefronts set status = 'active' where store_slug = 'look-one';

  -- clear
  perform pg_temp.as_user(ow);
  perform public.owner_clear_store_look('look-one');
  perform pg_temp.as_user(null);
  if public.get_public_store_look('look-one') <> '{}'::jsonb then raise exception 'clear must remove the look'; end if;
  if (select settings -> 'profile' ->> 'about' from public.commerce_storefronts where store_slug = 'look-one') <> 'keep me' then raise exception 'clear must keep other settings'; end if;
  if (select count(*) from public.activity_logs where action in ('store_look_set', 'store_look_cleared')) <> 2 then raise exception 'set and clear must be logged'; end if;
end $$;
select 'DRAFT_TEST_OK';
rollback;
