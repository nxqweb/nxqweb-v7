-- Sidecar test for 08 (store shipping fee). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ship-owner@synthetic.invalid','',now(),'{}','{"business_name":"Ship Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000008a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ship-other@synthetic.invalid','',now(),'{}','{"business_name":"Other Ship Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'active', '{"paypal_url":"https://paypal.me/shipstore"}'::jsonb
from (values ('ffffffff-0000-0000-0000-0000000008a1'::uuid, 'Ship Store', 'ship-store'),
             ('ffffffff-0000-0000-0000-0000000008a2'::uuid, 'Other Ship Store', 'other-ship-store')) as v(uid, name, slug)
join public.clients c on c.auth_user_id = v.uid;
insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory, requires_shipping)
select v.id, s.client_id, s.id, v.name, v.slug, 'active', true, v.ships
from public.commerce_storefronts s,
     (values ('ffffffff-0000-0000-0000-00000008f001'::uuid, 'Ship Candle', 'ship-candle', true),
             ('ffffffff-0000-0000-0000-00000008f002'::uuid, 'Gift Card', 'gift-card', false)) as v(id, name, slug, ships)
where s.store_slug = 'ship-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select v.id, s.client_id, s.id, v.pid, 'Standard', v.price, 500, 'deny', true
from public.commerce_storefronts s,
     (values ('ffffffff-0000-0000-0000-00000008f0a1'::uuid, 'ffffffff-0000-0000-0000-00000008f001'::uuid, 12.00),
             ('ffffffff-0000-0000-0000-00000008f0a2'::uuid, 'ffffffff-0000-0000-0000-00000008f002'::uuid, 25.00)) as v(id, pid, price)
where s.store_slug = 'ship-store';

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
create or replace function pg_temp.cust(n integer, extra jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object('name', 'Shopper ' || n, 'email', 'ship.shopper' || n || '@synthetic.invalid', 'idempotency_key', 'ship-test-key-' || lpad(n::text, 6, '0')) || extra
$f$;

do $$
declare
  ow uuid := 'ffffffff-0000-0000-0000-0000000008a1';
  ot uuid := 'ffffffff-0000-0000-0000-0000000008a2';
  candle jsonb := '[{"variant_id":"ffffffff-0000-0000-0000-00000008f0a1","quantity":2}]';
  big jsonb := '[{"variant_id":"ffffffff-0000-0000-0000-00000008f0a1","quantity":5}]';
  card jsonb := '[{"variant_id":"ffffffff-0000-0000-0000-00000008f0a2","quantity":1}]';
  r jsonb; r2 jsonb; o public.commerce_orders%rowtype; reserved integer;
begin
  -- privileges
  if has_function_privilege('anon', 'public.save_my_store_shipping(text,numeric,numeric,boolean,text)', 'execute')
     or has_function_privilege('anon', 'public.get_my_store_shipping()', 'execute')
     or has_function_privilege('anon', 'public.nxq_store_shipping_rule(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_store_shipping_rule(jsonb)', 'execute') then
    raise exception 'owner functions must not be callable by anon; the helper by nobody';
  end if;
  if not has_function_privilege('anon', 'public.create_public_store_order_with_shipping(text,jsonb,jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.get_public_store_shipping(text)', 'execute') then
    raise exception 'shoppers must be able to read the rule and order';
  end if;

  -- no rule yet: the public rule says none, and an order through the new function costs exactly the old amount
  perform pg_temp.as_user(null);
  r := public.get_public_store_shipping('ship-store');
  if r->>'mode' <> 'none' or (r->>'pickup_allowed')::boolean then raise exception 'default rule must be none: %', r; end if;
  if public.get_public_store_shipping('no-such-store') is not null then raise exception 'unknown store must return nothing'; end if;
  r := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(1));
  if (r->>'total')::numeric <> 24 or (r->>'shipping_total')::numeric <> 0 then raise exception 'no rule must mean no fee: %', r; end if;
  if not pg_temp.fails(format('select public.create_public_store_order_with_shipping(%L, %L::jsonb, %L::jsonb)', 'ship-store', candle::text, pg_temp.cust(2, '{"delivery_method":"pickup"}')::text), 'does not offer pickup') then raise exception 'pickup must be refused when the store does not offer it'; end if;
  if not pg_temp.fails(format('select public.create_public_store_order_with_shipping(%L, %L::jsonb, %L::jsonb)', 'ship-store', candle::text, pg_temp.cust(2, '{"delivery_method":"teleport"}')::text), 'Choose shipping or pickup') then raise exception 'unknown delivery method must be refused'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = 'ffffffff-0000-0000-0000-00000008f0a1';
  if reserved <> 2 then raise exception 'a refused order must hold no stock, found %', reserved; end if;

  -- the owner saves a rule; bad input is refused; another client's store is untouched
  perform pg_temp.as_user(ow);
  if not pg_temp.fails($q$select public.save_my_store_shipping('weight', 5)$q$, 'Choose no shipping fee') then raise exception 'unknown mode refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_shipping('flat', -1)$q$, 'between 0 and 9999.99') then raise exception 'negative fee refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_shipping('flat', 0)$q$, 'above 0') then raise exception 'flat fee of 0 refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_shipping('flat', 5, 0)$q$, 'Free shipping must start above 0') then raise exception 'free-over 0 refused'; end if;
  if not pg_temp.fails(format($q$select public.save_my_store_shipping('flat', 5, null, true, %L)$q$, repeat('x', 301)), '300 characters') then raise exception 'long note refused'; end if;
  r := public.save_my_store_shipping('flat', 6.5, 50, true, '  Saturdays at the market  ');
  if r->>'mode' <> 'flat' or (r->>'flat_fee')::numeric <> 6.5 or (r->>'free_over')::numeric <> 50 or not (r->>'pickup_allowed')::boolean or r->>'pickup_note' <> 'Saturdays at the market' then raise exception 'saved rule wrong: %', r; end if;
  if (select settings->>'paypal_url' from public.commerce_storefronts where store_slug = 'ship-store') is distinct from 'https://paypal.me/shipstore' then raise exception 'saving shipping must keep the payment link'; end if;
  if (select settings ? 'shipping' from public.commerce_storefronts where store_slug = 'other-ship-store') then raise exception 'another store must be untouched'; end if;
  perform pg_temp.as_user(ot);
  if (public.get_my_store_shipping())->>'mode' <> 'none' then raise exception 'another client must not see this rule'; end if;

  -- shoppers: flat fee on a shipped order
  perform pg_temp.as_user(null);
  r := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(3));
  if (r->>'subtotal')::numeric <> 24 or (r->>'shipping_total')::numeric <> 6.5 or (r->>'total')::numeric <> 30.5 or r->>'delivery_method' <> 'ship' then raise exception 'flat fee wrong: %', r; end if;
  select * into o from public.commerce_orders where id = (r->>'order_id')::uuid;
  if o.shipping_total <> 6.5 or o.grand_total <> 30.5 or o.subtotal <> 24 or o.metadata->>'delivery_method' <> 'ship' then raise exception 'stored order wrong: % % %', o.subtotal, o.shipping_total, o.grand_total; end if;
  if r->>'order_number' is distinct from o.order_number or o.order_number like 'NXQ-%' then raise exception 'order number must be the store-prefixed one: % vs %', r->>'order_number', o.order_number; end if;

  -- a shopper cannot set the fee: an injected amount is ignored
  r := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(4, '{"shipping_total":0,"flat_fee":0,"shipping":{"mode":"none"}}'));
  if (r->>'total')::numeric <> 30.5 then raise exception 'a shopper-sent amount must be ignored: %', r; end if;

  -- replay: the same answer, one order, and no re-pricing even after the rule changes
  r := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(5));
  perform pg_temp.as_user(ow);
  perform public.save_my_store_shipping('flat', 9, 50, true, null);
  perform pg_temp.as_user(null);
  r2 := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(5));
  if r2->>'order_id' is distinct from r->>'order_id' or (r2->>'total')::numeric <> 30.5 or (r2->>'shipping_total')::numeric <> 6.5 or r2->>'idempotent_replay' is distinct from 'true' then raise exception 'a replay must return the first order unchanged: % vs %', r, r2; end if;

  -- free over the threshold (5 x 12 = 60 >= 50), pickup, and a cart with nothing to ship
  r := public.create_public_store_order_with_shipping('ship-store', big, pg_temp.cust(6));
  if (r->>'shipping_total')::numeric <> 0 or (r->>'total')::numeric <> 60 then raise exception 'free-over must ship free: %', r; end if;
  r := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(7, '{"delivery_method":"pickup"}'));
  if (r->>'shipping_total')::numeric <> 0 or (r->>'total')::numeric <> 24 or r->>'delivery_method' <> 'pickup' then raise exception 'pickup must be free: %', r; end if;
  if (select metadata->>'delivery_method' from public.commerce_orders where id = (r->>'order_id')::uuid) <> 'pickup' then raise exception 'pickup must be recorded on the order'; end if;
  r := public.create_public_store_order_with_shipping('ship-store', card, pg_temp.cust(8));
  if (r->>'shipping_total')::numeric <> 0 or (r->>'total')::numeric <> 25 then raise exception 'nothing to ship must mean no fee: %', r; end if;
  r := public.create_public_store_order_with_shipping('ship-store', candle || card, pg_temp.cust(9));
  if (r->>'shipping_total')::numeric <> 9 or (r->>'total')::numeric <> 58 then raise exception 'mixed cart under the threshold pays the new fee once: %', r; end if;

  -- switching the fee off again
  perform pg_temp.as_user(ow);
  r := public.save_my_store_shipping('none', 0, null, false, 'ignored');
  if r->>'mode' <> 'none' or (r->>'flat_fee')::numeric <> 0 or r ? 'free_over' and r->>'free_over' is not null or r->>'pickup_note' is not null then raise exception 'none must clear the rule: %', r; end if;
  perform pg_temp.as_user(null);
  r := public.create_public_store_order_with_shipping('ship-store', candle, pg_temp.cust(10));
  if (r->>'total')::numeric <> 24 then raise exception 'fee off must mean no fee: %', r; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
