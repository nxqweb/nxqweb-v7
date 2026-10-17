-- Test for draft 08 (Membership tracking). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-m1@synthetic.invalid','',now(),'{}','{"business_name":"Club One Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('eeeeeeee-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-m2@synthetic.invalid','',now(),'{}','{"business_name":"Club Two Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('eeeeeeee-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-m3@synthetic.invalid','',now(),'{}','{"business_name":"No Store Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('eeeeeeee-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','Member.One@synthetic.invalid','',now(),'{}','{}'),
 ('eeeeeeee-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outsider@synthetic.invalid','',now(),'{}','{}'),
 ('eeeeeeee-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','unconfirmed@synthetic.invalid','',null,'{}','{}');

insert into public.commerce_storefronts (client_id, store_name, store_slug, status, customer_accounts_enabled)
select c.id, v.name, v.slug, 'active', true
from (values ('eeeeeeee-0000-0000-0000-0000000000a1'::uuid, 'Club One', 'club-one'),
             ('eeeeeeee-0000-0000-0000-0000000000a2'::uuid, 'Club Two', 'club-two')) as v(uid, name, slug)
join public.clients c on c.auth_user_id = v.uid;

insert into public.commerce_products (client_id, storefront_id, name, slug)
select s.client_id, s.id, 'Candle ' || s.store_slug, 'candle-' || s.store_slug from public.commerce_storefronts s where s.store_slug in ('club-one','club-two');

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
  s1 uuid := 'eeeeeeee-0000-0000-0000-0000000000b1';
  s2 uuid := 'eeeeeeee-0000-0000-0000-0000000000b2';
  s3 uuid := 'eeeeeeee-0000-0000-0000-0000000000b3';
  r jsonb;
  tier1 uuid; tier2 uuid; tier_other uuid; member1 uuid; prod1 uuid; prod2 uuid;
  i integer;
begin
  -- tables are closed to every API role
  perform pg_temp.as_user(o1);
  if has_table_privilege('authenticated', 'public.commerce_members', 'select') or has_table_privilege('anon', 'public.commerce_member_tiers', 'select')
     or has_table_privilege('authenticated', 'public.commerce_member_only_products', 'insert') then raise exception 'membership tables must have no API grants'; end if;
  if has_function_privilege('anon', 'public.list_my_membership()', 'execute') or has_function_privilege('authenticated', 'public.nxq_member_owner_store()', 'execute') then
    raise exception 'owner functions must not be public and the helper must be internal';
  end if;

  -- no store yet
  perform pg_temp.as_user(o3);
  if not pg_temp.fails('select public.list_my_membership()', 'Create your storefront first') then raise exception 'no store must be refused'; end if;
  perform pg_temp.as_user(null);
  if not pg_temp.fails('select public.list_my_membership()', 'Client workspace not found') then raise exception 'signed-out must be refused'; end if;

  -- tiers
  perform pg_temp.as_user(o1);
  r := public.save_my_member_tier(null, '  Gold  ', 'Free shipping', true);
  tier1 := (r->>'id')::uuid;
  if (select name from public.commerce_member_tiers where id = tier1) <> 'Gold' then raise exception 'tier name must be trimmed'; end if;
  if not pg_temp.fails(format('select public.save_my_member_tier(null, %L, null, true)', 'gold'), 'already have a tier') then raise exception 'duplicate tier name (case-insensitive) must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member_tier(null, %L, null, true)', '   '), 'Tier name must be') then raise exception 'blank tier name must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member_tier(null, %L, null, true)', repeat('x', 81)), 'Tier name must be') then raise exception 'long tier name must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member_tier(null, %L, null, true)', 'Bad' || chr(7)), 'not allowed') then raise exception 'control chars in tier name must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member_tier(null, %L, %L, true)', 'Long', repeat('p', 501)), 'Perks must be') then raise exception 'long perks must be refused'; end if;
  tier2 := (public.save_my_member_tier(null, 'Silver', null, true)->>'id')::uuid;
  for i in 3..10 loop perform public.save_my_member_tier(null, 'Tier ' || i, null, true); end loop;
  if not pg_temp.fails(format('select public.save_my_member_tier(null, %L, null, true)', 'Eleventh'), 'up to 10 tiers') then raise exception 'tier cap must hold'; end if;

  -- another store's tier can never be used or edited
  perform pg_temp.as_user(o2);
  tier_other := (public.save_my_member_tier(null, 'Gold', null, true)->>'id')::uuid;  -- same name is fine in another store
  perform pg_temp.as_user(o1);
  if not pg_temp.fails(format('select public.save_my_member_tier(%L, %L, null, true)', tier_other, 'Hijack'), 'Tier not found') then raise exception 'cannot edit another store tier'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, %L, %L, null, null)', 'x@example.com', tier_other, 'active'), 'Choose one of your tiers') then raise exception 'cannot use another store tier'; end if;

  -- members
  r := public.save_my_member(null, '  Member.One@Synthetic.invalid ', 'Mia', '555-0101', tier1, 'active', current_date + 30, 'club founder');
  member1 := (r->>'id')::uuid;
  if (select email from public.commerce_members where id = member1) <> 'member.one@synthetic.invalid' then raise exception 'email must be lowercased and trimmed'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, %L, %L, null, null)', 'MEMBER.one@synthetic.invalid', tier1, 'active'), 'already a member') then raise exception 'duplicate email must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, %L, %L, null, null)', 'not-an-email', tier1, 'active'), 'valid email') then raise exception 'bad email must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, %L, %L, null, null)', 'ok@example.com', tier1, 'vip'), 'Status must be') then raise exception 'bad status must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, %L, %L, %L, null)', 'ok@example.com', tier1, 'active', (current_date + 99999)::text), 'Renewal date') then raise exception 'far-future renewal must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, %L, null, %L, %L, null, null)', 'ok@example.com', 'Bad' || chr(0 + 7), tier1, 'active'), 'not allowed') then raise exception 'control chars in name must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, null, %L, null, null)', 'ok@example.com', 'active'), 'Choose one of your tiers') then raise exception 'tier is required'; end if;

  -- editing: cannot collide with another member, cannot touch another store's member
  perform public.save_my_member(null, 'second@example.com', null, null, tier2, 'paused', null, null);
  if not pg_temp.fails(format('select public.save_my_member(%L, %L, null, null, %L, %L, null, null)', member1, 'second@example.com', tier1, 'active'), 'already a member') then raise exception 'edit must not steal another member email'; end if;
  perform pg_temp.as_user(o2);
  if not pg_temp.fails(format('select public.save_my_member(%L, %L, null, null, %L, %L, null, null)', member1, 'x@example.com', tier_other, 'active'), 'Member not found') then raise exception 'cannot edit another store member'; end if;
  if not pg_temp.fails(format('select public.remove_my_member(%L)', member1), 'Member not found') then raise exception 'cannot remove another store member'; end if;
  r := public.list_my_membership();
  if jsonb_array_length(r->'members') <> 0 or jsonb_array_length(r->'tiers') <> 1 then raise exception 'store two must see only its own data: %', r; end if;

  -- members-only products
  perform pg_temp.as_user(o1);
  select id into prod1 from public.commerce_products where slug = 'candle-club-one';
  select id into prod2 from public.commerce_products where slug = 'candle-club-two';
  r := public.set_my_product_members_only(prod1, true);
  if (r->>'enforced')::boolean is not false then raise exception 'the flag must say it is not enforced yet'; end if;
  perform public.set_my_product_members_only(prod1, true); -- idempotent
  if not pg_temp.fails(format('select public.set_my_product_members_only(%L, true)', prod2), 'Product not found') then raise exception 'cannot flag another store product'; end if;
  if jsonb_array_length(public.list_my_membership()->'members_only_product_ids') <> 1 then raise exception 'flag must be listed once'; end if;
  perform public.set_my_product_members_only(prod1, false);
  if jsonb_array_length(public.list_my_membership()->'members_only_product_ids') <> 0 then raise exception 'unflagging must remove it'; end if;

  -- shopper status
  perform pg_temp.as_user(s1);
  r := public.get_my_membership_status('club-one');
  if (r->>'is_member')::boolean is not true or r->>'tier' <> 'Gold' or r->>'perks' <> 'Free shipping' then raise exception 'confirmed member must see their tier: %', r; end if;
  if r ? 'email' or r::text like '%founder%' or r::text like '%555-0101%' then raise exception 'shopper must not see owner notes or contact data: %', r; end if;
  if (public.get_my_membership_status('club-two')->>'is_member')::boolean is not false then raise exception 'membership must not carry across stores'; end if;
  perform pg_temp.as_user(s2);
  if (public.get_my_membership_status('club-one')->>'is_member')::boolean is not false then raise exception 'a non-member must get false'; end if;
  perform pg_temp.as_user(s3);
  if not pg_temp.fails(format('select public.get_my_membership_status(%L)', 'club-one'), 'Confirm your email') then raise exception 'unconfirmed email must be refused'; end if;
  perform pg_temp.as_user(null);
  if not pg_temp.fails(format('select public.get_my_membership_status(%L)', 'club-one'), 'Sign in') then raise exception 'signed-out must be refused'; end if;

  -- paused members and paused tiers do not count as members
  perform pg_temp.as_user(o1);
  perform public.save_my_member(member1, 'member.one@synthetic.invalid', 'Mia', null, tier1, 'paused', null, null);
  perform pg_temp.as_user(s1);
  if (public.get_my_membership_status('club-one')->>'is_member')::boolean is not false then raise exception 'paused member must not count'; end if;
  perform pg_temp.as_user(o1);
  perform public.save_my_member(member1, 'member.one@synthetic.invalid', 'Mia', null, tier1, 'active', null, null);
  perform public.save_my_member_tier(tier1, 'Gold', 'Free shipping', false);
  perform pg_temp.as_user(s1);
  if (public.get_my_membership_status('club-one')->>'is_member')::boolean is not false then raise exception 'a member of a paused tier must not count'; end if;

  -- accounts-off store hides membership status entirely
  perform pg_temp.as_user(o1);
  update public.commerce_storefronts set customer_accounts_enabled = false where store_slug = 'club-one';
  perform pg_temp.as_user(s1);
  if not pg_temp.fails(format('select public.get_my_membership_status(%L)', 'club-one'), 'not available') then raise exception 'accounts-off store must refuse'; end if;
  update public.commerce_storefronts set customer_accounts_enabled = true where store_slug = 'club-one';

  -- removing a tier that still has members is refused by the database; removing members works
  perform pg_temp.as_user(o1);
  if not pg_temp.fails(format('delete from public.commerce_member_tiers where id = %L', tier1), 'violates foreign key') then raise exception 'tier with members must not be deletable'; end if;
  perform public.remove_my_member(member1);
  if exists (select 1 from public.commerce_members where id = member1) then raise exception 'member must be removed'; end if;

  -- member cap
  for i in 1..2000 loop
    insert into public.commerce_members (client_id, storefront_id, tier_id, email)
    select t.client_id, t.storefront_id, t.id, 'bulk' || i || '@example.com' from public.commerce_member_tiers t where t.id = tier2;
  end loop;
  if not pg_temp.fails(format('select public.save_my_member(null, %L, null, null, %L, %L, null, null)', 'one-too-many@example.com', tier2, 'active'), '2000 member limit') then raise exception 'member cap must hold'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
