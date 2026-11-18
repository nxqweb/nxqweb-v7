-- Regression test for migration 294 (was draft 07) (new order notification). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','no-owner@synthetic.invalid','',now(),'{}','{"business_name":"Order Note Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status)
select c.id, 'Note Store', 'note-store', 'active' from public.clients c where c.auth_user_id = 'ffffffff-0000-0000-0000-0000000007a1';

do $$
declare cid uuid; sf uuid; n integer; b text;
begin
  select id into cid from public.clients where auth_user_id = 'ffffffff-0000-0000-0000-0000000007a1';
  select id into sf from public.commerce_storefronts where client_id = cid;

  insert into public.commerce_orders (client_id, storefront_id, order_number, customer_email, customer_name, is_test)
  values (cid, sf, 'NOTE-REAL-1', 'shopper@synthetic.invalid', 'Click evil.example to verify', false);
  select count(*), max(body) into n, b from public.notification_deliveries where client_id = cid and template_key = 'new_order';
  if n <> 1 then raise exception 'a real order must create exactly one notification, got %', n; end if;
  if b ~* 'evil|verify|shopper|NOTE-REAL' then raise exception 'notification must use fixed wording only: %', b; end if;

  insert into public.commerce_orders (client_id, storefront_id, order_number, customer_email, customer_name, is_test)
  values (cid, sf, 'NOTE-TEST-1', 'shopper@synthetic.invalid', 'Tester', true);
  select count(*) into n from public.notification_deliveries where client_id = cid and template_key = 'new_order';
  if n <> 1 then raise exception 'a test order must not notify, got %', n; end if;

  if has_function_privilege('anon', 'public.queue_new_order_owner_notification()', 'execute')
     or has_function_privilege('authenticated', 'public.queue_new_order_owner_notification()', 'execute') then
    raise exception 'trigger function must not be callable by anon or authenticated';
  end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
