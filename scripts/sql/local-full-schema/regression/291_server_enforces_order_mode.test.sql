-- Regression test for migration 291 (was draft 09) (the server enforces the store's order mode). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000009a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mode-owner@synthetic.invalid','',now(),'{}','{"business_name":"Mode Co","product_family_slug":"business","product_tier_key":"starter"}');

insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, 'Mode Store', 'mode-store', 'active', '{"paypal_url":"https://paypal.me/modestore"}'::jsonb
from public.clients c where c.auth_user_id = 'ffffffff-0000-0000-0000-0000000009a1';
insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory)
select 'ffffffff-0000-0000-0000-00000009f001', s.client_id, s.id, 'Mode Candle', 'mode-candle', 'active', true from public.commerce_storefronts s where s.store_slug = 'mode-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000009f0a1', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000009f001', '8 oz', 12.00, 50, 'deny', true from public.commerce_storefronts s where s.store_slug = 'mode-store';

create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;

do $$
declare
  v text := 'ffffffff-0000-0000-0000-00000009f0a1';
  cust text := '{"name":"Shopper Nine","email":"shopper.nine@synthetic.invalid"}';
  items text := json_build_array(json_build_object('variant_id', 'ffffffff-0000-0000-0000-00000009f0a1', 'quantity', 2))::text;
  r jsonb; reserved integer; orders_before integer;
begin
  if (select count(*) from public.commerce_product_variants where id = v::uuid) <> 1 then raise exception 'fixture missing (test would be vacuous)'; end if;
  perform set_config('request.jwt.claim.role', 'anon', true);
  select count(*) into orders_before from public.commerce_orders;

  -- email mode and menu mode: refused, nothing created, nothing reserved (both entry points)
  update public.commerce_storefronts set settings = jsonb_set(settings, '{order_mode}', '"email"') where store_slug = 'mode-store';
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'mode-store', items, cust), 'not taking online orders') then raise exception 'email mode must refuse the direct order function'; end if;
  if not pg_temp.fails(format('select public.create_public_stripe_ready_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'mode-store', items, cust), 'not taking online orders') then raise exception 'email mode must refuse the stripe-ready order function'; end if;
  update public.commerce_storefronts set settings = jsonb_set(settings, '{order_mode}', '"menu"') where store_slug = 'mode-store';
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'mode-store', items, cust), 'not taking online orders') then raise exception 'menu mode must refuse the direct order function'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v::uuid;
  if reserved <> 0 then raise exception 'refused orders must reserve nothing, found %', reserved; end if;
  if (select count(*) from public.commerce_orders) <> orders_before then raise exception 'refused orders must create no order'; end if;

  -- online mode, and a store with no mode at all, still take orders as before
  update public.commerce_storefronts set settings = jsonb_set(settings, '{order_mode}', '"online"') where store_slug = 'mode-store';
  r := public.create_public_direct_payment_order('mode-store', items::jsonb, cust::jsonb);
  if r is null then raise exception 'online mode must still take orders'; end if;
  update public.commerce_storefronts set settings = settings - 'order_mode' where store_slug = 'mode-store';
  r := public.create_public_direct_payment_order('mode-store', items::jsonb, cust::jsonb);
  if r is null then raise exception 'a store with no mode set must still take orders'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v::uuid;
  if reserved <> 4 then raise exception 'two orders of 2 must reserve 4, found %', reserved; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
