-- Sidecar test for draft 06 (menu mode). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','menu-one@synthetic.invalid','',now(),'{}','{"business_name":"Menu Shop One","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','menu-two@synthetic.invalid','',now(),'{}','{"business_name":"Menu Shop Two","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','menu-three@synthetic.invalid','',now(),'{}','{"business_name":"Menu Shop Three","product_family_slug":"business","product_tier_key":"starter"}');

-- one: phone only; two: no contact details; three: email and phone
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'draft', v.settings
from (values ('ffffffff-0000-0000-0000-0000000000a1'::uuid, 'Menu Shop One', 'menu-one', '{"profile":{"contact_phone":"555 0100"},"venmo_url":"https://venmo.com/u/one"}'::jsonb),
             ('ffffffff-0000-0000-0000-0000000000a2'::uuid, 'Menu Shop Two', 'menu-two', '{}'::jsonb),
             ('ffffffff-0000-0000-0000-0000000000a3'::uuid, 'Menu Shop Three', 'menu-three', '{"profile":{"contact_email":"cafe@example.com","contact_phone":"555 0199"}}'::jsonb)) as v(uid, name, slug, settings)
join public.clients c on c.auth_user_id = v.uid;

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
  o1 uuid := 'ffffffff-0000-0000-0000-0000000000a1';
  o2 uuid := 'ffffffff-0000-0000-0000-0000000000a2';
  o3 uuid := 'ffffffff-0000-0000-0000-0000000000a3';
  r jsonb;
begin
  if (select count(*) from public.commerce_storefronts where store_slug in ('menu-one','menu-two','menu-three')) is distinct from 3 then raise exception 'storefront fixtures missing'; end if;

  if has_function_privilege('anon', 'public.save_my_store_order_mode(text,boolean)', 'execute') then raise exception 'anon must not save the mode'; end if;
  if not has_function_privilege('anon', 'public.get_public_store_order_mode(text)', 'execute') then raise exception 'anon must read the public mode'; end if;

  -- the app only offers Menu when the database says it supports it
  perform pg_temp.as_user(o1);
  r := public.get_my_store_order_mode();
  if not (r->'supported_modes') ? 'menu' or not (r->'supported_modes') ? 'email' or not (r->'supported_modes') ? 'online' then raise exception 'supported modes: %', r; end if;

  -- unknown mode refused, menu with no contact details refused
  if not pg_temp.fails($q$select public.save_my_store_order_mode('carrier-pigeon')$q$, 'Choose online payment, orders by email, or a menu') then raise exception 'unknown mode must be refused'; end if;
  perform pg_temp.as_user(o2);
  if not pg_temp.fails($q$select public.save_my_store_order_mode('menu', true)$q$, 'Add a contact email or phone') then raise exception 'menu needs contact details'; end if;
  if (select status from public.commerce_storefronts where store_slug = 'menu-two') is distinct from 'draft' then raise exception 'a refused save must not open the store'; end if;
  -- email mode still needs an email (a phone is not enough)
  perform pg_temp.as_user(o1);
  if not pg_temp.fails($q$select public.save_my_store_order_mode('email', true)$q$, 'Add a contact email before taking orders by email') then raise exception 'email mode still needs an email'; end if;

  -- menu with a phone only: opens, public sees mode and phone, no payment link
  r := public.save_my_store_order_mode('menu', true);
  if r->>'order_mode' is distinct from 'menu' or r->>'status' is distinct from 'active' then raise exception 'menu should be open: %', r; end if;
  perform pg_temp.as_user(null);
  r := public.get_public_store_order_mode('menu-one');
  if r->>'order_mode' is distinct from 'menu' or r->>'contact_phone' is distinct from '555 0100' or r ? 'contact_email' then raise exception 'public menu mode: %', r; end if;
  if r::text like '%venmo%' or r::text like '%paypal%' or r::text like '%stripe%' then raise exception 'public mode leaks payment links: %', r; end if;

  -- email mode with both details saved: the public sees only the email, never the phone
  perform pg_temp.as_user(o3);
  r := public.save_my_store_order_mode('email', true);
  perform pg_temp.as_user(null);
  r := public.get_public_store_order_mode('menu-three');
  if r->>'order_mode' is distinct from 'email' or r->>'contact_email' is distinct from 'cafe@example.com' or r ? 'contact_phone' then raise exception 'public email mode must not expose the phone: %', r; end if;

  -- menu mode with both details: the public sees both
  perform pg_temp.as_user(o3);
  r := public.save_my_store_order_mode('menu', true);
  perform pg_temp.as_user(null);
  r := public.get_public_store_order_mode('menu-three');
  if r->>'order_mode' is distinct from 'menu' or r->>'contact_email' is distinct from 'cafe@example.com' or r->>'contact_phone' is distinct from '555 0199' then raise exception 'public menu mode (both): %', r; end if;

  -- switching back to online hides contact details again
  perform pg_temp.as_user(o3);
  perform public.save_my_store_order_mode('online', true);
  perform pg_temp.as_user(null);
  r := public.get_public_store_order_mode('menu-three');
  if r->>'order_mode' is distinct from 'online' or r ? 'contact_email' or r ? 'contact_phone' then raise exception 'online mode must expose no contact: %', r; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
