-- Sidecar test for 09 (confirm a late direct payment). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000009b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','late-owner@synthetic.invalid','',now(),'{}','{"business_name":"Late Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000009b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','late-other@synthetic.invalid','',now(),'{}','{"business_name":"Other Late Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'active', '{"paypal_url":"https://paypal.me/latestore"}'::jsonb
from (values ('ffffffff-0000-0000-0000-0000000009b1'::uuid, 'Late Store', 'late-store'),
             ('ffffffff-0000-0000-0000-0000000009b2'::uuid, 'Other Late Store', 'other-late-store')) as v(uid, name, slug)
join public.clients c on c.auth_user_id = v.uid;
insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory)
select 'ffffffff-0000-0000-0000-00000009f001', s.client_id, s.id, 'Late Candle', 'late-candle', 'active', true from public.commerce_storefronts s where s.store_slug = 'late-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000009f0a1', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000009f001', '8 oz', 12.00, 5, 'deny', true from public.commerce_storefronts s where s.store_slug = 'late-store';

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;
create or replace function pg_temp.as_service() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $f$;
create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;
-- Places an order as a shopper and returns its id.
create or replace function pg_temp.place(n integer, qty integer) returns uuid language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.as_user(null);
  r := public.create_public_direct_payment_order('late-store',
    json_build_array(json_build_object('variant_id', 'ffffffff-0000-0000-0000-00000009f0a1', 'quantity', qty))::jsonb,
    jsonb_build_object('name', 'Late Shopper ' || n, 'email', 'late.shopper' || n || '@synthetic.invalid'));
  return (r->>'order_id')::uuid;
end $f$;
-- Makes the hold run out and lets the system cancel the order, exactly as the scheduled job does.
create or replace function pg_temp.expire(o uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.as_service();
  update public.commerce_orders set reservation_expires_at = now() - interval '1 minute' where id = o;
  perform public.release_expired_commerce_reservations(null);
end $f$;

do $$
declare
  ow uuid := 'ffffffff-0000-0000-0000-0000000009b1';
  ot uuid := 'ffffffff-0000-0000-0000-0000000009b2';
  v uuid := 'ffffffff-0000-0000-0000-00000009f0a1';
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; r jsonb; reserved integer; o public.commerce_orders%rowtype; n integer;
begin
  if has_function_privilege('anon', 'public.confirm_my_late_direct_payment(uuid)', 'execute') then raise exception 'anon must not call it'; end if;

  -- an order that is still being held is not a late order
  o1 := pg_temp.place(1, 2);
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format('select public.confirm_my_late_direct_payment(%L)', o1), 'still being held') then raise exception 'a held order must be refused'; end if;

  -- the hold runs out: the system cancels it, stock goes back, the normal confirm refuses it for good
  perform pg_temp.expire(o1);
  select * into o from public.commerce_orders where id = o1;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if o.fulfillment_stage <> 'cancelled' or o.reservation_released_at is null or reserved <> 0 then raise exception 'fixture: the order should be auto-cancelled and stock released (stage %, reserved %)', o.fulfillment_stage, reserved; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format('select public.confirm_my_direct_payment_order(%L)', o1), 'already released') then raise exception 'fixture: the normal confirm should refuse a released order'; end if;

  -- another shop cannot touch it
  perform pg_temp.as_user(ot);
  if not pg_temp.fails(format('select public.confirm_my_late_direct_payment(%L)', o1), 'Order was not found') then raise exception 'another client must not confirm this order'; end if;

  -- the owner confirms late: paid, back to new, stock reserved again, both steps in the history
  perform pg_temp.as_user(ow);
  r := public.confirm_my_late_direct_payment(o1);
  if (r->>'ok')::boolean is not true or (r->>'late')::boolean is not true then raise exception 'late confirm failed: %', r; end if;
  select * into o from public.commerce_orders where id = o1;
  if o.payment_status <> 'paid' or o.status <> 'confirmed' or o.fulfillment_stage <> 'new' or o.fulfillment_status <> 'unfulfilled'
     or o.reservation_released_at is not null or o.cancelled_at is not null or o.reservation_expires_at is not null or o.paid_at is null or o.fulfillment_note is not null then
    raise exception 'order state wrong after late confirm: % % % % note=%', o.payment_status, o.status, o.fulfillment_stage, o.fulfillment_status, o.fulfillment_note;
  end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 2 then raise exception 'stock must be reserved again (2), found %', reserved; end if;
  select count(*) into n from public.commerce_order_events where order_id = o1 and event_type in ('reservation_reopened', 'payment_confirmed');
  if n <> 2 then raise exception 'both steps must be in the history, found %', n; end if;
  if (public.confirm_my_late_direct_payment(o1)->>'already_paid')::boolean is not true then raise exception 'a second call must be a no-op'; end if;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if reserved <> 2 then raise exception 'a second call must not reserve again, found %', reserved; end if;
  -- the order now moves on like any paid order
  perform public.update_my_commerce_order(o1, 'processing', null, null);

  -- sold out in the meantime: refused, nothing changed
  o2 := pg_temp.place(2, 3);
  perform pg_temp.expire(o2);
  o3 := pg_temp.place(3, 3);  -- someone else takes the last 3 (5 in stock, 2 reserved by o1)
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format('select public.confirm_my_late_direct_payment(%L)', o2), 'has sold out since this order was cancelled') then raise exception 'a sold-out item must refuse the late confirm'; end if;
  select * into o from public.commerce_orders where id = o2;
  select reserved_quantity into reserved from public.commerce_product_variants where id = v;
  if o.payment_status = 'paid' or o.fulfillment_stage <> 'cancelled' or reserved <> 5 then raise exception 'a refused late confirm must change nothing (stage %, reserved %)', o.fulfillment_stage, reserved; end if;

  -- an order the owner cancelled by hand can never be confirmed late
  perform public.update_my_commerce_order(o3, 'cancelled', null, 'Customer changed their mind');
  if not pg_temp.fails(format('select public.confirm_my_late_direct_payment(%L)', o3), 'cancelled automatically for running out of time') then raise exception 'a hand-cancelled order must be refused'; end if;

  -- an automatically cancelled order that the owner then closed by hand (saved as cancelled with a note, for example after a refund) stays closed
  o5 := pg_temp.place(5, 1);
  perform pg_temp.expire(o5);
  perform pg_temp.as_user(ow);
  perform public.update_my_commerce_order(o5, 'cancelled', null, 'Refunded the customer');
  if not pg_temp.fails(format('select public.confirm_my_late_direct_payment(%L)', o5), 'cancelled automatically for running out of time') then raise exception 'an order the owner closed by hand after the automatic cancel must be refused'; end if;

  -- too old
  o4 := pg_temp.place(4, 1);
  perform pg_temp.expire(o4);
  perform pg_temp.as_service();
  update public.commerce_orders set placed_at = now() - interval '31 days' where id = o4;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format('select public.confirm_my_late_direct_payment(%L)', o4), 'too old') then raise exception 'an order older than 30 days must be refused'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
