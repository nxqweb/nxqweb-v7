-- Sidecar test for 10 (idempotency key on direct-payment orders). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','idem-owner@synthetic.invalid','',now(),'{}','{"business_name":"Idem Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, 'Idem Store', 'idem-store', 'active', '{"paypal_url":"https://paypal.me/idemstore"}'::jsonb from public.clients c where c.auth_user_id = 'ffffffff-0000-0000-0000-0000000010a1';
insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory)
select 'ffffffff-0000-0000-0000-00000010f001', s.client_id, s.id, 'Idem Candle', 'idem-candle', 'active', true from public.commerce_storefronts s where s.store_slug = 'idem-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000010f0a1', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000010f001', '8 oz', 12.00, 50, 'deny', true from public.commerce_storefronts s where s.store_slug = 'idem-store';

create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;

do $$
declare
  v uuid := 'ffffffff-0000-0000-0000-00000010f0a1';
  items jsonb := json_build_array(json_build_object('variant_id', 'ffffffff-0000-0000-0000-00000010f0a1', 'quantity', 2))::jsonb;
  cust_a jsonb := '{"name":"Shopper Ten","email":"shopper.ten@synthetic.invalid","idempotency_key":"co-test-key-aaaaaaaa"}';
  cust_b jsonb := '{"name":"Shopper Ten","email":"shopper.ten@synthetic.invalid","idempotency_key":"co-test-key-bbbbbbbb"}';
  r1 jsonb; r2 jsonb; r3 jsonb; reserved integer; n0 integer; w1 jsonb; w2 jsonb;
begin
  if (select count(*) from public.commerce_product_variants where id = v) <> 1 then raise exception 'fixture missing (test would be vacuous)'; end if;
  perform set_config('request.jwt.claim.role', 'anon', true);
  select count(*) into n0 from public.commerce_orders;

  -- the same key twice: one order, one reservation, the same answer
  r1 := public.create_public_direct_payment_order('idem-store', items, cust_a);
  r2 := public.create_public_direct_payment_order('idem-store', items, cust_a);
  if r1->>'order_id' is distinct from r2->>'order_id' or r1->>'order_number' is distinct from r2->>'order_number' then raise exception 'a repeated key must return the same order: % vs %', r1, r2; end if;
  if (r1->>'total')::numeric is distinct from (r2->>'total')::numeric or (r1->>'total')::numeric <> 24 then raise exception 'the replay must carry the same total (24): % vs %', r1->>'total', r2->>'total'; end if;
  if r2->>'idempotent_replay' is distinct from 'true' then raise exception 'the replay must say so'; end if;
  if (select count(*) from public.commerce_orders) <> n0 + 1 then raise exception 'a repeated key must create exactly one order'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 2 then raise exception 'a repeated key must reserve stock once, found %', reserved; end if;

  -- a different key is a different order
  r3 := public.create_public_direct_payment_order('idem-store', items, cust_b);
  if r3->>'order_id' = r1->>'order_id' then raise exception 'a different key must create a new order'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 4 then raise exception 'two keys must reserve 4, found %', reserved; end if;

  -- the same key with a different email, and malformed keys, are refused
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'idem-store', items::text, '{"name":"Someone Else","email":"other@synthetic.invalid","idempotency_key":"co-test-key-aaaaaaaa"}'), 'Checkout session is invalid') then raise exception 'the same key with another email must be refused'; end if;
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'idem-store', items::text, '{"name":"Shopper Ten","email":"shopper.ten@synthetic.invalid","idempotency_key":"short"}'), 'Checkout session is invalid') then raise exception 'a too-short key must be refused'; end if;
  if not pg_temp.fails(format('select public.create_public_direct_payment_order(%L, %L::jsonb, %L::jsonb)', 'idem-store', items::text, '{"name":"Shopper Ten","email":"shopper.ten@synthetic.invalid","idempotency_key":"bad key with spaces!"}'), 'Checkout session is invalid') then raise exception 'a key with odd characters must be refused'; end if;

  -- no key: the old behaviour, a new order every time
  perform public.create_public_direct_payment_order('idem-store', items, '{"name":"Shopper Ten","email":"shopper.ten@synthetic.invalid"}');
  perform public.create_public_direct_payment_order('idem-store', items, '{"name":"Shopper Ten","email":"shopper.ten@synthetic.invalid"}');
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 8 then raise exception 'two orders without a key must reserve 4 more (8 in all), found %', reserved; end if;

  -- the Stripe-ready wrapper (what the store page calls): the same key twice gives the same, store-prefixed order number
  w1 := public.create_public_stripe_ready_direct_payment_order('idem-store', items, '{"name":"Shopper Eleven","email":"shopper.eleven@synthetic.invalid","idempotency_key":"co-wrap-key-cccccccc"}');
  w2 := public.create_public_stripe_ready_direct_payment_order('idem-store', items, '{"name":"Shopper Eleven","email":"shopper.eleven@synthetic.invalid","idempotency_key":"co-wrap-key-cccccccc"}');
  if w1->>'order_id' is distinct from w2->>'order_id' or w1->>'order_number' is distinct from w2->>'order_number' then raise exception 'the wrapper must replay the same order: % vs %', w1, w2; end if;
  if (select count(*) from public.commerce_orders where id = (w1->>'order_id')::uuid and order_number = w1->>'order_number') <> 1 then raise exception 'the stored order number must match the one returned'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 10 then raise exception 'the wrapper pair must reserve 2 more (10 in all), found %', reserved; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
