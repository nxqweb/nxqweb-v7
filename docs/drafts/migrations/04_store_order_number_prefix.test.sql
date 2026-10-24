-- Sidecar test for draft 04 (store-branded order numbers). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('cccccccc-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prefix-one@synthetic.invalid','',now(),'{}','{"business_name":"Rehearsal Candle Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('cccccccc-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prefix-two@synthetic.invalid','',now(),'{}','{"business_name":"Candles","product_family_slug":"business","product_tier_key":"starter"}'),
 ('cccccccc-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prefix-three@synthetic.invalid','',now(),'{}','{"business_name":"Custom Prefix Shop","product_family_slug":"business","product_tier_key":"starter"}');

insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'active', v.settings
from (values ('cccccccc-0000-0000-0000-0000000000a1'::uuid, 'Rehearsal Candle Co', 'prefix-one', '{"stripe_payment_link":"https://buy.stripe.com/test_abc"}'::jsonb),
             ('cccccccc-0000-0000-0000-0000000000a2'::uuid, 'Candles', 'prefix-two', '{"paypal_url":"https://paypal.me/Candles"}'::jsonb),
             ('cccccccc-0000-0000-0000-0000000000a3'::uuid, 'Custom Prefix Shop', 'prefix-three', '{"stripe_payment_link":"https://buy.stripe.com/test_def","order_prefix":"abc12"}'::jsonb)) as v(uid, name, slug, settings)
join public.clients c on c.auth_user_id = v.uid;

insert into public.commerce_products (client_id, storefront_id, name, slug, status, base_price)
select s.client_id, s.id, 'Vanilla Candle', 'vanilla-candle', 'active', 12 from public.commerce_storefronts s where s.store_slug like 'prefix-%';
insert into public.commerce_product_variants (client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select p.client_id, p.storefront_id, p.id, 'Default', 12, 10, 'deny', true from public.commerce_products p where p.slug = 'vanilla-candle';

do $$
declare
  r jsonb;
  v uuid;
  order_row public.commerce_orders%rowtype;
  reserved integer;
  suffix text;
  r2 jsonb;
  customer jsonb := '{"name":"Test Person","email":"test@example.com","shipping_address":{"address":"1 Main St"}}'::jsonb;
begin
  -- the prefix rules themselves
  if public.nxq_store_order_prefix('Rehearsal Candle Co', '{}'::jsonb) <> 'RCC' then raise exception 'initials rule: %', public.nxq_store_order_prefix('Rehearsal Candle Co', '{}'::jsonb); end if;
  if public.nxq_store_order_prefix('Candles', '{}'::jsonb) <> 'CAN' then raise exception 'one-word rule'; end if;
  if public.nxq_store_order_prefix('The Very Long Store Name Here', '{}'::jsonb) <> 'TVLS' then raise exception 'four-word cap rule: %', public.nxq_store_order_prefix('The Very Long Store Name Here', '{}'::jsonb); end if;
  if public.nxq_store_order_prefix('Joe''s Candle & Co.', '{}'::jsonb) <> 'JCC' then raise exception 'punctuation rule: %', public.nxq_store_order_prefix('Joe''s Candle & Co.', '{}'::jsonb); end if;
  if public.nxq_store_order_prefix('N X Q', '{}'::jsonb) <> 'ORD' then raise exception 'a derived NXQ prefix must fall back to ORD'; end if;
  if public.nxq_store_order_prefix('A', '{}'::jsonb) <> 'ORD' or public.nxq_store_order_prefix('', '{}'::jsonb) <> 'ORD' or public.nxq_store_order_prefix(null, null) <> 'ORD' then raise exception 'too-short names must fall back to ORD'; end if;
  if public.nxq_store_order_prefix('Anything', '{"order_prefix":"abc12"}'::jsonb) <> 'ABC12' then raise exception 'custom prefix must win and be upper-cased'; end if;
  if public.nxq_store_order_prefix('Rehearsal Candle Co', '{"order_prefix":"x"}'::jsonb) <> 'RCC' or public.nxq_store_order_prefix('Rehearsal Candle Co', '{"order_prefix":"bad prefix!"}'::jsonb) <> 'RCC' then raise exception 'an invalid custom prefix must be ignored'; end if;

  -- the Stripe-ready checkout the storefront really calls
  select v2.id into v from public.commerce_product_variants v2 join public.commerce_storefronts s on s.id = v2.storefront_id where s.store_slug = 'prefix-one';
  if v is null then raise exception 'variant fixture missing (test would be vacuous)'; end if;
  r := public.create_public_stripe_ready_direct_payment_order('prefix-one', jsonb_build_array(jsonb_build_object('variant_id', v, 'quantity', 2)), customer);
  if r->>'order_number' not like 'RCC-%' or r->>'order_number' like 'NXQ-%' then raise exception 'order number should start with the store prefix: %', r->>'order_number'; end if;
  suffix := split_part(r->>'order_number', '-', 2);
  if suffix !~ '^[0-9A-F]{8}$' then raise exception 'the random 8-character suffix must be kept: %', suffix; end if;
  select * into order_row from public.commerce_orders where id = (r->>'order_id')::uuid;
  if order_row.order_number <> r->>'order_number' then raise exception 'the stored order number must match the returned one: % vs %', order_row.order_number, r->>'order_number'; end if;
  if order_row.grand_total <> 24 or (r->>'total')::numeric <> 24 then raise exception 'totals must be unchanged: %', r; end if;
  if (select count(*) from public.commerce_orders where storefront_id = order_row.storefront_id) <> 1 then raise exception 'exactly one order expected'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 2 then raise exception 'inventory must still be reserved (2), got %', reserved; end if;
  if not exists (select 1 from public.commerce_inventory_movements where reference_id = order_row.id and movement_type = 'reservation') then raise exception 'reservation movement must still reference the order id'; end if;
  if not exists (select 1 from public.commerce_order_events where order_id = order_row.id and event_type = 'order_created') then raise exception 'order_created event must still exist'; end if;
  if r->>'stripe_payment_link' <> 'https://buy.stripe.com/test_abc' then raise exception 'stripe link must still be returned: %', r; end if;
  if (select settings ? 'paypal_url' from public.commerce_storefronts where store_slug = 'prefix-one') then raise exception 'the temporary compatibility link must still be removed from settings'; end if;

  -- a second order gets a different number
  r2 := public.create_public_stripe_ready_direct_payment_order('prefix-one', jsonb_build_array(jsonb_build_object('variant_id', v, 'quantity', 1)), customer);
  if r2->>'order_number' = r->>'order_number' or r2->>'order_number' not like 'RCC-%' then raise exception 'second order number must be new and prefixed: %', r2->>'order_number'; end if;

  -- a store with a custom prefix
  select v2.id into v from public.commerce_product_variants v2 join public.commerce_storefronts s on s.id = v2.storefront_id where s.store_slug = 'prefix-three';
  r := public.create_public_stripe_ready_direct_payment_order('prefix-three', jsonb_build_array(jsonb_build_object('variant_id', v, 'quantity', 1)), customer);
  if r->>'order_number' not like 'ABC12-%' then raise exception 'custom prefix not used: %', r->>'order_number'; end if;

  -- the legacy primitive called directly is untouched (still NXQ-)
  select v2.id into v from public.commerce_product_variants v2 join public.commerce_storefronts s on s.id = v2.storefront_id where s.store_slug = 'prefix-two';
  r := public.create_public_direct_payment_order('prefix-two', jsonb_build_array(jsonb_build_object('variant_id', v, 'quantity', 1)), customer);
  if r->>'order_number' not like 'NXQ-%' then raise exception 'the legacy primitive must be unchanged: %', r->>'order_number'; end if;

  -- privileges
  if has_function_privilege('anon', 'public.nxq_store_order_prefix(text,jsonb)', 'execute') or has_function_privilege('authenticated', 'public.nxq_store_order_prefix(text,jsonb)', 'execute') then raise exception 'the prefix helper must not be callable by API roles'; end if;
  if not has_function_privilege('anon', 'public.create_public_stripe_ready_direct_payment_order(text,jsonb,jsonb)', 'execute') then raise exception 'shoppers must still be able to check out'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
