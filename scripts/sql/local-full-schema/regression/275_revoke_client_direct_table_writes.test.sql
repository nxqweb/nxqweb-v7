-- Regression test for migration 275 (revoke direct client writes). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('99999999-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','attacker@synthetic.invalid','',now(),'{}','{"business_name":"Attacker Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('99999999-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','victim@synthetic.invalid','',now(),'{}','{"business_name":"Victim Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status)
select c.id, v.name, v.slug, 'draft' from (values ('99999999-0000-0000-0000-0000000000a1'::uuid, 'Attacker Store', 'attacker-store'), ('99999999-0000-0000-0000-0000000000a2'::uuid, 'Victim Store', 'victim-store')) v(uid, name, slug)
join public.clients c on c.auth_user_id = v.uid;

do $$
declare
  t text;
  attacker_client uuid; victim_store uuid; attacker_store uuid;
  blocked boolean;
  r jsonb;
begin
  -- 1. no write grants left on any of the ten Commerce tables; reads are untouched
  foreach t in array array['commerce_storefronts','commerce_categories','commerce_products','commerce_product_variants','commerce_inventory_movements','commerce_customers','commerce_carts','commerce_cart_items','commerce_orders','commerce_order_items'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete') then
      raise exception 'authenticated must have no write grant on %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('anon', 'public.' || t, 'update') then raise exception 'anon must have no write grant on %', t; end if;
  end loop;
  foreach t in array array['commerce_storefronts','commerce_categories','commerce_products','commerce_product_variants','commerce_customers','commerce_orders','commerce_order_items'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'select') then raise exception 'authenticated must still be able to read % (the pages read it)', t; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.data_subject_requests', 'insert') or has_table_privilege('authenticated', 'public.privacy_consents', 'insert') then raise exception 'direct privacy inserts must be closed'; end if;
  if not has_table_privilege('service_role', 'public.commerce_products', 'insert') then raise exception 'the service role must keep its access'; end if;

  select c.id into attacker_client from public.clients c where c.auth_user_id = '99999999-0000-0000-0000-0000000000a1';
  select id into victim_store from public.commerce_storefronts where store_slug = 'victim-store';
  select id into attacker_store from public.commerce_storefronts where store_slug = 'attacker-store';

  -- 2. THE ATTACK itself, as a real signed-in client over the data API role: put a product into the victim's storefront
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-0000000000a1', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  execute 'set local role authenticated';
  blocked := false;
  begin
    insert into public.commerce_products (client_id, storefront_id, name, slug, status, base_price) values (attacker_client, victim_store, 'Planted Product', 'planted', 'active', 1);
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'the cross-tenant product insert must be refused'; end if;
  blocked := false;
  begin
    update public.commerce_storefronts set status = 'active' where id = attacker_store;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'a client must not be able to open their own store by writing the table directly'; end if;
  blocked := false;
  begin
    insert into public.data_subject_requests (nxq_account_id, client_id, request_type, requested_by_auth_user_id) values (public.current_nxq_account_id(), (select id from public.clients where auth_user_id = '99999999-0000-0000-0000-0000000000a2'), 'export', '99999999-0000-0000-0000-0000000000a1');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'a forged data-request row naming another client must be refused'; end if;

  -- 3. the supported paths keep working for the same signed-in client: reading their own store, and a save through a function
  if (select count(*) from public.commerce_storefronts where client_id = attacker_client) <> 1 then raise exception 'a client must still read their own storefront'; end if;
  r := public.set_my_customer_accounts_enabled(true);
  if (r->>'customer_accounts_enabled')::boolean is not true then raise exception 'saving through a function must still work after the revoke: %', r; end if;
  execute 'reset role';
end $$;

select 'DRAFT_TEST_OK';
rollback;
