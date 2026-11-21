-- Regression test for migration 289 (was draft 07) (untracked stock is orderable on the public store page). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','untracked-owner@synthetic.invalid','',now(),'{}','{"business_name":"Untracked Co","product_family_slug":"business","product_tier_key":"starter"}');

insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, 'Untracked Store', 'untracked-store', 'active', '{"paypal_url":"https://paypal.me/untracked"}'::jsonb
from public.clients c where c.auth_user_id = 'ffffffff-0000-0000-0000-0000000007a1';

-- one made-to-order product (stock not tracked, nothing on hand) and one tracked product that really is sold out
insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory)
select 'ffffffff-0000-0000-0000-00000007f001', s.client_id, s.id, 'Made To Order Candle', 'made-to-order', 'active', false from public.commerce_storefronts s where s.store_slug = 'untracked-store';
insert into public.commerce_products (id, client_id, storefront_id, name, slug, status, track_inventory)
select 'ffffffff-0000-0000-0000-00000007f002', s.client_id, s.id, 'Counted Candle', 'counted', 'active', true from public.commerce_storefronts s where s.store_slug = 'untracked-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000007f0a1', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000007f001', 'Standard', 15.00, 0, 'deny', true from public.commerce_storefronts s where s.store_slug = 'untracked-store';
insert into public.commerce_product_variants (id, client_id, storefront_id, product_id, title, price, inventory_quantity, inventory_policy, is_active)
select 'ffffffff-0000-0000-0000-00000007f0a2', s.client_id, s.id, 'ffffffff-0000-0000-0000-00000007f002', 'Standard', 15.00, 0, 'deny', true from public.commerce_storefronts s where s.store_slug = 'untracked-store';

do $$
declare
  listing jsonb; untracked_policy text; tracked_policy text; tracked_available integer; r jsonb; blocked boolean := false;
begin
  if (select count(*) from public.commerce_products where storefront_id = (select id from public.commerce_storefronts where store_slug = 'untracked-store')) <> 2 then
    raise exception 'product fixtures missing (test would be vacuous)'; end if;
  perform set_config('request.jwt.claim.role', 'anon', true);
  listing := public.get_public_commerce_storefront('untracked-store');

  select v->>'inventory_policy' into untracked_policy
  from jsonb_array_elements(listing->'products') p, jsonb_array_elements(p->'variants') v where p->>'slug' = 'made-to-order';
  select v->>'inventory_policy', (v->>'available_quantity')::integer into tracked_policy, tracked_available
  from jsonb_array_elements(listing->'products') p, jsonb_array_elements(p->'variants') v where p->>'slug' = 'counted';

  if untracked_policy is distinct from 'continue' then raise exception 'an untracked product must be listed as always orderable, got %', untracked_policy; end if;
  if tracked_policy is distinct from 'deny' or tracked_available <> 0 then raise exception 'a tracked sold-out product must stay sold out, got % / %', tracked_policy, tracked_available; end if;

  -- the listing and the order function now agree: the untracked product can be ordered, the tracked one cannot
  r := public.create_public_direct_payment_order('untracked-store',
    json_build_array(json_build_object('variant_id', 'ffffffff-0000-0000-0000-00000007f0a1', 'quantity', 2))::jsonb,
    '{"name":"Shopper Seven","email":"shopper.seven@synthetic.invalid"}'::jsonb);
  if r is null then raise exception 'ordering an untracked product must work'; end if;
  begin
    perform public.create_public_direct_payment_order('untracked-store',
      json_build_array(json_build_object('variant_id', 'ffffffff-0000-0000-0000-00000007f0a2', 'quantity', 1))::jsonb,
      '{"name":"Shopper Eight","email":"shopper.eight@synthetic.invalid"}'::jsonb);
  exception when others then
    blocked := sqlerrm like '%enough available stock%';
  end;
  if not blocked then raise exception 'a tracked sold-out product must still be refused at order time'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
