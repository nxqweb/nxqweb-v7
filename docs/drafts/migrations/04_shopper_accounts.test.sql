-- Sidecar test for draft 04 (shopper accounts). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

-- two store owners (the signup trigger turns business_name metadata into clients), three shoppers (no business_name => never a client)
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-one@synthetic.invalid','',now(),'{}','{"business_name":"Shop One Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('dddddddd-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-two@synthetic.invalid','',now(),'{}','{"business_name":"Shop Two Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('dddddddd-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','Shopper.A@synthetic.invalid','',now(),'{}','{}'),
 ('dddddddd-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','shopper.b@synthetic.invalid','',now(),'{}','{}'),
 ('dddddddd-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','shopper.c@synthetic.invalid','',null,'{}','{}');

insert into public.commerce_storefronts (client_id, store_name, store_slug, status, customer_accounts_enabled)
select c.id, v.name, v.slug, 'active', v.enabled
from (values ('dddddddd-0000-0000-0000-0000000000a1'::uuid, 'Store One', 'store-one', true),
             ('dddddddd-0000-0000-0000-0000000000a2'::uuid, 'Store Two', 'store-two', true)) as v(uid, name, slug, enabled)
join public.clients c on c.auth_user_id = v.uid;

-- a third, accounts-off store owned by a third client so "disabled" can be tested without touching the other two
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-three@synthetic.invalid','',now(),'{}','{"business_name":"Shop Three Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, customer_accounts_enabled)
select c.id, 'Store Three', 'store-three', 'active', false from public.clients c where c.auth_user_id = 'dddddddd-0000-0000-0000-0000000000a3';

-- orders: A at store one (mixed-case email, plus a test order that must be hidden), B at store one, A at store two
insert into public.commerce_orders (client_id, storefront_id, order_number, customer_email, customer_name, placed_at, is_test, grand_total)
select s.client_id, s.id, v.num, v.email, 'Fixture', now(), v.is_test, v.total
from public.commerce_storefronts s
join (values ('store-one','ORD-A1','SHOPPER.A@synthetic.invalid',false,12.00),
             ('store-one','ORD-A-TEST','shopper.a@synthetic.invalid',true,99.00),
             ('store-one','ORD-B1','shopper.b@synthetic.invalid',false,30.00),
             ('store-two','ORD-A2','shopper.a@synthetic.invalid',false,45.00)) as v(slug, num, email, is_test, total)
  on v.slug = s.store_slug;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;

create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;

do $$
declare
  a uuid := 'dddddddd-0000-0000-0000-0000000000b1';
  b uuid := 'dddddddd-0000-0000-0000-0000000000b2';
  c uuid := 'dddddddd-0000-0000-0000-0000000000b3';
  owner_one uuid := 'dddddddd-0000-0000-0000-0000000000a1';
  r jsonb;
  n integer;
begin
  -- fixtures must exist, or every later check would be vacuous
  if (select count(*) from public.commerce_storefronts where store_slug in ('store-one','store-two','store-three')) <> 3 then raise exception 'storefront fixtures missing'; end if;
  if (select count(*) from public.commerce_orders where order_number like 'ORD-%') <> 4 then raise exception 'order fixtures missing'; end if;
  if exists (select 1 from public.clients where auth_user_id in (a, b, c)) then raise exception 'a shopper account must never become a client'; end if;

  -- deny-by-default table
  if not (select relrowsecurity from pg_class where oid = 'public.commerce_shopper_profiles'::regclass) then raise exception 'RLS must be enabled on the profile table'; end if;
  if has_table_privilege('authenticated', 'public.commerce_shopper_profiles', 'select') or has_table_privilege('anon', 'public.commerce_shopper_profiles', 'select')
     or has_table_privilege('authenticated', 'public.commerce_shopper_profiles', 'insert') then raise exception 'API roles must have no direct access to profiles'; end if;

  -- privileges
  if has_function_privilege('anon', 'public.get_my_shopper_profile(text)', 'execute') or has_function_privilege('anon', 'public.list_my_shopper_orders(text)', 'execute')
     or has_function_privilege('anon', 'public.save_my_shopper_profile(text,jsonb)', 'execute') or has_function_privilege('anon', 'public.set_my_customer_accounts_enabled(boolean)', 'execute') then raise exception 'anon must not execute shopper functions'; end if;
  if has_function_privilege('authenticated', 'public.nxq_shopper_context(text)', 'execute') then raise exception 'the internal helper must not be callable'; end if;
  if not has_function_privilege('anon', 'public.get_public_store_accounts_status(text)', 'execute') then raise exception 'anon must be able to read the public accounts status'; end if;

  -- signed out, disabled store, unconfirmed email, unknown store
  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.get_my_shopper_profile('store-one')$q$, 'Sign in') then raise exception 'signed-out calls must be refused'; end if;
  perform pg_temp.as_user(a);
  if not pg_temp.fails($q$select public.get_my_shopper_profile('store-three')$q$, 'not available') then raise exception 'a store with accounts off must refuse'; end if;
  if not pg_temp.fails($q$select public.get_my_shopper_profile('no-such-store')$q$, 'not available') then raise exception 'an unknown store must refuse'; end if;
  perform pg_temp.as_user(c);
  if not pg_temp.fails($q$select public.list_my_shopper_orders('store-one')$q$, 'Confirm your email') then raise exception 'an unconfirmed email must be refused'; end if;

  -- profile save / read / overwrite
  perform pg_temp.as_user(a);
  r := public.get_my_shopper_profile('store-one');
  if (r->>'has_profile')::boolean is not false then raise exception 'new shopper should have no profile yet: %', r; end if;
  if r->>'email' <> 'shopper.a@synthetic.invalid' then raise exception 'email should come from the confirmed account, lower-cased: %', r; end if;
  perform public.save_my_shopper_profile('store-one', '{"full_name":"Shopper A","phone":"555-0101","shipping_address":{"line1":"1 Main St","city":"Austin","state":"TX","zip":"78701"}}'::jsonb);
  r := public.get_my_shopper_profile('store-one');
  if r->>'full_name' <> 'Shopper A' or r->'shipping_address'->>'city' <> 'Austin' or (r->>'has_profile')::boolean is not true then raise exception 'saved profile did not read back: %', r; end if;
  perform public.save_my_shopper_profile('store-one', '{"full_name":"Shopper A2","shipping_address":{"city":"Dallas"}}'::jsonb);
  select count(*) into n from public.commerce_shopper_profiles where user_id = a and storefront_id = (select id from public.commerce_storefronts where store_slug = 'store-one');
  if n <> 1 then raise exception 'saving twice must update the same row, found %', n; end if;
  if public.get_my_shopper_profile('store-one')->>'full_name' <> 'Shopper A2' then raise exception 'second save did not overwrite'; end if;

  -- validation
  if not pg_temp.fails($q$select public.save_my_shopper_profile('store-one', '"nope"'::jsonb)$q$, 'invalid') then raise exception 'non-object payload must be refused'; end if;
  if not pg_temp.fails(format($q$select public.save_my_shopper_profile('store-one', jsonb_build_object('full_name', %L))$q$, repeat('x', 161)), '160') then raise exception 'overlong name must be refused'; end if;
  if not pg_temp.fails(format($q$select public.save_my_shopper_profile('store-one', jsonb_build_object('shipping_address', jsonb_build_object('line1', %L)))$q$, repeat('y', 5001)), 'too large') then raise exception 'oversized address must be refused'; end if;

  -- isolation between shoppers and between stores
  if (public.get_my_shopper_profile('store-two')->>'has_profile')::boolean is not false then raise exception 'a profile saved at store one must not appear at store two'; end if;
  perform pg_temp.as_user(b);
  r := public.get_my_shopper_profile('store-one');
  if (r->>'has_profile')::boolean is not false or r->>'full_name' is not null then raise exception 'shopper B must not see shopper A''s profile: %', r; end if;

  -- order history: own confirmed email, own store only, test orders hidden
  perform pg_temp.as_user(a);
  r := public.list_my_shopper_orders('store-one');
  if jsonb_array_length(r->'orders') <> 1 or r->'orders'->0->>'order_number' <> 'ORD-A1' then raise exception 'shopper A at store one should see exactly ORD-A1 (mixed-case email matched, test order hidden): %', r; end if;
  if (r->'orders'->0->>'grand_total')::numeric <> 12.00 then raise exception 'order total missing: %', r; end if;
  r := public.list_my_shopper_orders('store-two');
  if jsonb_array_length(r->'orders') <> 1 or r->'orders'->0->>'order_number' <> 'ORD-A2' then raise exception 'shopper A at store two should see exactly ORD-A2: %', r; end if;
  perform pg_temp.as_user(b);
  r := public.list_my_shopper_orders('store-one');
  if jsonb_array_length(r->'orders') <> 1 or r->'orders'->0->>'order_number' <> 'ORD-B1' then raise exception 'shopper B should see only ORD-B1: %', r; end if;
  if jsonb_array_length(public.list_my_shopper_orders('store-two')->'orders') <> 0 then raise exception 'shopper B has no orders at store two'; end if;

  -- delete my saved details
  perform pg_temp.as_user(a);
  perform public.delete_my_shopper_profile('store-one');
  if (public.get_my_shopper_profile('store-one')->>'has_profile')::boolean is not false then raise exception 'profile should be gone after delete'; end if;
  if jsonb_array_length(public.list_my_shopper_orders('store-one')->'orders') <> 1 then raise exception 'deleting saved details must not delete order history'; end if;

  -- the owner switch only touches the owner's own store
  perform pg_temp.as_user(owner_one);
  r := public.set_my_customer_accounts_enabled(false);
  if (select customer_accounts_enabled from public.commerce_storefronts where store_slug = 'store-one') then raise exception 'owner switch did not turn accounts off'; end if;
  if not (select customer_accounts_enabled from public.commerce_storefronts where store_slug = 'store-two') then raise exception 'owner one must not change store two'; end if;
  perform pg_temp.as_user(a);
  if not pg_temp.fails($q$select public.get_my_shopper_profile('store-one')$q$, 'not available') then raise exception 'accounts-off store must refuse shoppers immediately'; end if;
  perform pg_temp.as_user(owner_one);
  perform public.set_my_customer_accounts_enabled(true);
  if not (select customer_accounts_enabled from public.commerce_storefronts where store_slug = 'store-one') then raise exception 'owner switch did not turn accounts back on'; end if;
  perform pg_temp.as_user(a);
  if not pg_temp.fails($q$select public.set_my_customer_accounts_enabled(true)$q$, 'Client workspace not found') then raise exception 'a shopper must not be able to use the owner switch'; end if;

  -- public status reveals only on/off
  perform pg_temp.as_user(null);
  if (public.get_public_store_accounts_status('store-one')->>'accounts_enabled')::boolean is not true then raise exception 'status should be true for store one'; end if;
  if (public.get_public_store_accounts_status('store-three')->>'accounts_enabled')::boolean is not false then raise exception 'status should be false for store three'; end if;
  if (public.get_public_store_accounts_status('no-such-store')->>'accounts_enabled')::boolean is not false then raise exception 'status should be false for an unknown store'; end if;
  if public.get_public_store_accounts_status('store-one')::text !~ '^\{"accounts_enabled": (true|false)\}$' then raise exception 'status must reveal nothing but on/off'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
