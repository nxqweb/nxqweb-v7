-- Regression test for migration 274 (duplicate-variant oversell fix). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-os@synthetic.invalid','',now(),'{}','{"business_name":"Oversell Co","product_family_slug":"business","product_tier_key":"starter"}');

insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, 'Oversell Store', 'oversell-store', 'active', '{"paypal_url":"https://paypal.me/oversell"}'::jsonb
from public.clients c where c.auth_user_id = 'ffffffff-0000-0000-0000-0000000000a1';

insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory)
select 'ffffffff-0000-0000-0000-00000000f001', s.client_id, s.id, 'Scarce Candle', 'scarce', 'active', true from public.commerce_storefronts s where s.store_slug = 'oversell-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000000f0a1', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000000f001', '8 oz', 12.00, 5, 'deny', true from public.commerce_storefronts s where s.store_slug = 'oversell-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000000f0a2', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000000f001', '16 oz', 20.00, 5, 'deny', true from public.commerce_storefronts s where s.store_slug = 'oversell-store';

create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;

do $$
declare
  v1 text := 'ffffffff-0000-0000-0000-00000000f0a1';
  v2 text := 'ffffffff-0000-0000-0000-00000000f0a2';
  cust jsonb := '{"name":"Shopper One","email":"shopper.one@synthetic.invalid"}';
  r jsonb;
  reserved integer;
  orders_before integer;
begin
  perform set_config('request.jwt.claim.role', 'anon', true);
  select count(*) into orders_before from public.commerce_orders;

  -- the same variant in different spellings must be refused, and must reserve nothing
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'oversell-store',
        json_build_array(json_build_object('variant_id', v1, 'quantity', 5), json_build_object('variant_id', upper(v1), 'quantity', 5))::text, cust::text), 'Combine duplicate') then
    raise exception 'upper-case spelling of the same variant must be refused'; end if;
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'oversell-store',
        json_build_array(json_build_object('variant_id', v1, 'quantity', 5), json_build_object('variant_id', '{' || v1 || '}', 'quantity', 5))::text, cust::text), 'Combine duplicate') then
    raise exception 'braced spelling of the same variant must be refused'; end if;
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'oversell-store',
        json_build_array(json_build_object('variant_id', v1, 'quantity', 5), json_build_object('variant_id', replace(v1, '-', ''), 'quantity', 5))::text, cust::text), 'Combine duplicate') then
    raise exception 'hyphen-less spelling of the same variant must be refused'; end if;
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'oversell-store',
        json_build_array(json_build_object('variant_id', v1, 'quantity', 1), json_build_object('variant_id', v1, 'quantity', 1))::text, cust::text), 'Combine duplicate') then
    raise exception 'the plain duplicate must still be refused'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v1::uuid;
  if reserved <> 0 then raise exception 'refused orders must reserve nothing, found %', reserved; end if;
  if (select count(*) from public.commerce_orders) <> orders_before then raise exception 'refused orders must create no order'; end if;

  -- normal behaviour is unchanged: one line works, two different variants work, and real stock limits still apply
  r := public.create_public_direct_payment_order('oversell-store', json_build_array(json_build_object('variant_id', v1, 'quantity', 3))::jsonb, cust);
  if r is null then raise exception 'a normal single-line order must still work'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v1::uuid;
  if reserved <> 3 then raise exception 'a 3-unit order must reserve exactly 3, found %', reserved; end if;
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'oversell-store',
        json_build_array(json_build_object('variant_id', v1, 'quantity', 3))::text, '{"name":"Shopper Two","email":"shopper.two@synthetic.invalid"}'), 'enough available stock') then
    raise exception 'the remaining stock limit must still apply'; end if;
  r := public.create_public_direct_payment_order('oversell-store', json_build_array(json_build_object('variant_id', v1, 'quantity', 1), json_build_object('variant_id', v2, 'quantity', 2))::jsonb,
        '{"name":"Shopper Three","email":"shopper.three@synthetic.invalid"}');
  if r is null then raise exception 'two different variants in one order must still work'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v1::uuid;
  if reserved <> 4 then raise exception 'variant one must now have 4 reserved, found %', reserved; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v2::uuid;
  if reserved <> 2 then raise exception 'variant two must have 2 reserved, found %', reserved; end if;

  -- grants are unchanged: anonymous checkout still works, nothing else about the function opened up
  if not has_function_privilege('anon', 'public.create_public_direct_payment_order(text,jsonb,jsonb)', 'execute') then raise exception 'anon checkout must stay available'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
