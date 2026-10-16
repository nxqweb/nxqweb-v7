-- Regression test for migration 269 (public store profile). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-one@synthetic.invalid','',now(),'{}','{"business_name":"Profile Shop One","product_family_slug":"business","product_tier_key":"starter"}'),
 ('eeeeeeee-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-two@synthetic.invalid','',now(),'{}','{"business_name":"Profile Shop Two","product_family_slug":"business","product_tier_key":"starter"}'),
 ('eeeeeeee-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-three@synthetic.invalid','',now(),'{}','{"business_name":"Profile Shop Three","product_family_slug":"business","product_tier_key":"starter"}'),
 ('eeeeeeee-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-four@synthetic.invalid','',now(),'{}','{"business_name":"Profile Shop Four","product_family_slug":"business","product_tier_key":"starter"}');

-- one: open store with a payment link already saved; two: open store; three: DRAFT store; four: client with no storefront at all
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, v.status, v.settings
from (values ('eeeeeeee-0000-0000-0000-0000000000a1'::uuid, 'Profile Shop One', 'profile-one', 'active', '{"venmo_url":"https://venmo.com/u/one"}'::jsonb),
             ('eeeeeeee-0000-0000-0000-0000000000a2'::uuid, 'Profile Shop Two', 'profile-two', 'active', '{}'::jsonb),
             ('eeeeeeee-0000-0000-0000-0000000000a3'::uuid, 'Profile Shop Three', 'profile-three', 'draft', '{}'::jsonb)) as v(uid, name, slug, status, settings)
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
  o1 uuid := 'eeeeeeee-0000-0000-0000-0000000000a1';
  o2 uuid := 'eeeeeeee-0000-0000-0000-0000000000a2';
  o3 uuid := 'eeeeeeee-0000-0000-0000-0000000000a3';
  o4 uuid := 'eeeeeeee-0000-0000-0000-0000000000a4';
  r jsonb;
begin
  -- fixtures must exist, or every later check would be vacuous
  if (select count(*) from public.commerce_storefronts where store_slug in ('profile-one','profile-two','profile-three')) is distinct from 3 then raise exception 'storefront fixtures missing'; end if;
  if (select count(*) from public.clients where auth_user_id in (o1,o2,o3,o4)) is distinct from 4 then raise exception 'client fixtures missing'; end if;

  -- privileges
  if has_function_privilege('anon', 'public.get_my_store_profile()', 'execute') or has_function_privilege('anon', 'public.save_my_store_profile(text,text,text,text)', 'execute') then raise exception 'anon must not call the owner functions'; end if;
  if not has_function_privilege('authenticated', 'public.get_my_store_profile()', 'execute') or not has_function_privilege('authenticated', 'public.save_my_store_profile(text,text,text,text)', 'execute') then raise exception 'owners must be able to call the owner functions'; end if;
  if not has_function_privilege('anon', 'public.get_public_store_profile(text)', 'execute') then raise exception 'anon must be able to read a public profile'; end if;

  -- signed out
  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.get_my_store_profile()$q$, 'Client workspace not found') then raise exception 'signed-out read must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile('x')$q$, 'Client workspace not found') then raise exception 'signed-out save must be refused'; end if;

  -- a client with no storefront yet
  perform pg_temp.as_user(o4);
  r := public.get_my_store_profile();
  if (r->>'has_storefront')::boolean is not false then raise exception 'no storefront should be reported: %', r; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile('hello')$q$, 'Create your storefront first') then raise exception 'saving without a storefront must be refused'; end if;

  -- empty profile, then save and read back
  perform pg_temp.as_user(o1);
  r := public.get_my_store_profile();
  if (r->>'has_storefront')::boolean is not true or r->>'about' is not null then raise exception 'new profile should be empty: %', r; end if;
  r := public.save_my_store_profile('  Hand-poured candles and natural soap.  ', 'Hello@Example.com ', '(555) 123-4567', 'https://instagram.com/lightcandles');
  if r->>'about' is distinct from 'Hand-poured candles and natural soap.' or r->>'contact_email' is distinct from 'hello@example.com' or r->>'contact_phone' is distinct from '(555) 123-4567' or r->>'social_url' is distinct from 'https://instagram.com/lightcandles' then raise exception 'save did not trim, lower-case or read back: %', r; end if;
  if public.get_my_store_profile()->>'about' is distinct from 'Hand-poured candles and natural soap.' then raise exception 'read after save differs'; end if;

  -- the public read: open store, exactly the four fields, nothing else
  perform pg_temp.as_user(null);
  r := public.get_public_store_profile('profile-one');
  if r->>'about' is distinct from 'Hand-poured candles and natural soap.' or r->>'contact_email' is distinct from 'hello@example.com' then raise exception 'public read of an open store failed: %', r; end if;
  if r - array['about','contact_email','contact_phone','social_url'] is distinct from '{}'::jsonb then raise exception 'public read must expose only the four profile fields: %', r; end if;
  if r::text like '%venmo%' or r::text like '%payment%' then raise exception 'payment details must never be in the public profile: %', r; end if;
  if public.get_public_store_profile('profile-two') is distinct from '{}'::jsonb then raise exception 'an open store with no profile should return an empty object: %', public.get_public_store_profile('profile-two'); end if;
  if public.get_public_store_profile('no-such-store') is not null then raise exception 'an unknown store must return null'; end if;

  -- a store that is not open reveals nothing, even with a saved profile
  perform pg_temp.as_user(o3);
  perform public.save_my_store_profile('Draft store about text');
  perform pg_temp.as_user(null);
  if public.get_public_store_profile('profile-three') is not null then raise exception 'a draft store must not expose its profile'; end if;

  -- isolation: owner two saving does not touch owner one
  perform pg_temp.as_user(o2);
  perform public.save_my_store_profile('Store two about');
  if public.get_my_store_profile()->>'about' is distinct from 'Store two about' then raise exception 'owner two read-back failed'; end if;
  perform pg_temp.as_user(o1);
  if public.get_my_store_profile()->>'about' is distinct from 'Hand-poured candles and natural soap.' then raise exception 'owner one profile changed by owner two'; end if;

  -- validation
  if not pg_temp.fails(format($q$select public.save_my_store_profile(%L)$q$, repeat('a', 601)), '600') then raise exception 'overlong about must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile(null, 'not-an-email')$q$, 'valid contact email') then raise exception 'bad email must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile(null, 'a<b>@example.com')$q$, 'valid contact email') then raise exception 'markup in email must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile(null, null, 'call me maybe')$q$, 'valid contact phone') then raise exception 'letters in phone must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile(null, null, null, 'http://insecure.example.com')$q$, 'https://') then raise exception 'non-https social link must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_profile(null, null, null, 'https://x.example.com/"><script>')$q$, 'https://') then raise exception 'markup in social link must be refused'; end if;
  if public.get_my_store_profile()->>'about' is distinct from 'Hand-poured candles and natural soap.' then raise exception 'a refused save must change nothing'; end if;

  -- saving the payment settings later must keep the profile (and the profile save must keep the payment link)
  perform public.save_my_stripe_ready_storefront_settings(store_name_value => 'Profile Shop One', stripe_payment_link_value => null, legacy_paypal_url_value => null, legacy_venmo_url_value => 'https://venmo.com/u/one2', payment_note_value => null, make_live => true);
  if public.get_my_store_profile()->>'about' is distinct from 'Hand-poured candles and natural soap.' then raise exception 'saving payment settings wiped the profile'; end if;
  if (select settings->>'venmo_url' from public.commerce_storefronts where store_slug = 'profile-one') is distinct from 'https://venmo.com/u/one2' then raise exception 'payment link missing after payment save'; end if;
  perform public.save_my_store_profile('New about text');
  if (select settings->>'venmo_url' from public.commerce_storefronts where store_slug = 'profile-one') is distinct from 'https://venmo.com/u/one2' then raise exception 'saving the profile wiped the payment link'; end if;

  -- empty values clear the profile
  r := public.save_my_store_profile('', '', '', '');
  if r->>'about' is not null or r->>'contact_email' is not null then raise exception 'empty values must clear the profile: %', r; end if;
  perform pg_temp.as_user(null);
  if public.get_public_store_profile('profile-one') is distinct from '{}'::jsonb then raise exception 'cleared profile must read as empty publicly: %', public.get_public_store_profile('profile-one'); end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
