-- Regression test for migration 270 (orders by email). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mode-one@synthetic.invalid','',now(),'{}','{"business_name":"Mode Shop One","product_family_slug":"business","product_tier_key":"starter"}'),
 ('dddddddd-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mode-two@synthetic.invalid','',now(),'{}','{"business_name":"Mode Shop Two","product_family_slug":"business","product_tier_key":"starter"}');

-- one: draft store with a contact email and a payment link; two: draft store without a contact email
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'draft', v.settings
from (values ('dddddddd-0000-0000-0000-0000000000a1'::uuid, 'Mode Shop One', 'mode-one', '{"profile":{"contact_email":"shop@example.com"},"venmo_url":"https://venmo.com/u/one"}'::jsonb),
             ('dddddddd-0000-0000-0000-0000000000a2'::uuid, 'Mode Shop Two', 'mode-two', '{}'::jsonb)) as v(uid, name, slug, settings)
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
  o1 uuid := 'dddddddd-0000-0000-0000-0000000000a1';
  o2 uuid := 'dddddddd-0000-0000-0000-0000000000a2';
  r jsonb;
begin
  if (select count(*) from public.commerce_storefronts where store_slug in ('mode-one','mode-two')) is distinct from 2 then raise exception 'storefront fixtures missing'; end if;

  if has_function_privilege('anon', 'public.get_my_store_order_mode()', 'execute') or has_function_privilege('anon', 'public.save_my_store_order_mode(text,boolean)', 'execute') then raise exception 'anon must not call the owner functions'; end if;
  if not has_function_privilege('anon', 'public.get_public_store_order_mode(text)', 'execute') then raise exception 'anon must read the public mode'; end if;

  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.save_my_store_order_mode('email')$q$, 'Client workspace not found') then raise exception 'signed-out save must be refused'; end if;

  -- default is online
  perform pg_temp.as_user(o1);
  r := public.get_my_store_order_mode();
  if r->>'order_mode' is distinct from 'online' then raise exception 'default must be online: %', r; end if;

  -- bad mode refused
  if not pg_temp.fails($q$select public.save_my_store_order_mode('carrier-pigeon')$q$, 'Choose online payment or orders by email') then raise exception 'unknown mode must be refused'; end if;

  -- email mode without a contact email is refused (client two)
  perform pg_temp.as_user(o2);
  if not pg_temp.fails($q$select public.save_my_store_order_mode('email', true)$q$, 'Add a contact email') then raise exception 'email mode needs a contact email'; end if;
  if (select status from public.commerce_storefronts where store_slug = 'mode-two') is distinct from 'draft' then raise exception 'a refused save must not open the store'; end if;

  -- email mode, saved private: stays draft, and the public cannot see it
  perform pg_temp.as_user(o1);
  r := public.save_my_store_order_mode('email', false);
  if r->>'order_mode' is distinct from 'email' or r->>'status' is distinct from 'draft' then raise exception 'email saved private: %', r; end if;
  perform pg_temp.as_user(null);
  if public.get_public_store_order_mode('mode-one') is not null then raise exception 'a store that is not open reveals nothing'; end if;

  -- email mode, opened: public sees mode + email, and no payment link or other setting
  perform pg_temp.as_user(o1);
  r := public.save_my_store_order_mode('email', true);
  if r->>'status' is distinct from 'active' then raise exception 'email store should be open: %', r; end if;
  perform pg_temp.as_user(null);
  r := public.get_public_store_order_mode('mode-one');
  if r->>'order_mode' is distinct from 'email' or r->>'contact_email' is distinct from 'shop@example.com' then raise exception 'public email mode: %', r; end if;
  if r::text like '%venmo%' or r::text like '%paypal%' or r::text like '%stripe%' then raise exception 'public mode leaks payment links: %', r; end if;
  if public.get_public_store_order_mode('no-such-store') is not null then raise exception 'unknown store must return null'; end if;

  -- back to online: no contact email is exposed, store is not closed or opened by this call
  perform pg_temp.as_user(o1);
  r := public.save_my_store_order_mode('online', true);
  if r->>'order_mode' is distinct from 'online' or r->>'status' is distinct from 'active' then raise exception 'online switch: %', r; end if;
  perform pg_temp.as_user(null);
  r := public.get_public_store_order_mode('mode-one');
  if r->>'order_mode' is distinct from 'online' or r ? 'contact_email' then raise exception 'online mode must not expose the email: %', r; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
