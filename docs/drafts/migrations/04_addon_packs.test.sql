-- Sidecar test for 04 (add-on packs). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000004a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ap-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000004c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ap-one@synthetic.invalid','',now(),'{}','{"business_name":"Addon One","product_family_slug":"business"}'),
 ('ffffffff-0000-0000-0000-0000000004c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ap-two@synthetic.invalid','',now(),'{}','{"business_name":"Addon Two","product_family_slug":"business"}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000004a1');

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
  ow uuid := 'ffffffff-0000-0000-0000-0000000004a1';
  u1 uuid := 'ffffffff-0000-0000-0000-0000000004c1';
  u2 uuid := 'ffffffff-0000-0000-0000-0000000004c2';
  c1 uuid; c2 uuid; r jsonb; n integer;
begin
  select id into c1 from public.clients where auth_user_id = u1;
  select id into c2 from public.clients where auth_user_id = u2;
  if c1 is null or c2 is null then raise exception 'client fixtures missing'; end if;

  -- privileges
  if has_function_privilege('anon', 'public.owner_set_client_addon_pack(uuid,text,boolean)', 'execute') then raise exception 'anon must not call the owner function'; end if;
  if has_table_privilege('anon', 'public.client_addon_packs', 'select') then raise exception 'anon must not read client packs'; end if;
  if has_table_privilege('authenticated', 'public.client_addon_packs', 'insert') or has_table_privilege('authenticated', 'public.client_addon_pack_events', 'insert')
     then raise exception 'signed-in users must not write packs directly'; end if;

  -- the seeded pack starts inactive: it cannot be switched on yet
  if (select active from public.nxq_addon_pack_catalog where pack_key = 'team_hours') then raise exception 'seed pack must start inactive'; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format($q$select public.owner_set_client_addon_pack(%L, 'team_hours', true)$q$, c1), 'not on sale') then raise exception 'inactive pack was enabled'; end if;
  if not pg_temp.fails(format($q$select public.owner_set_client_addon_pack(%L, 'nope', true)$q$, c1), 'Unknown') then raise exception 'unknown pack accepted'; end if;
  if not pg_temp.fails($q$select public.owner_set_client_addon_pack(gen_random_uuid(), 'team_hours', true)$q$, 'Client not found') then raise exception 'unknown client accepted'; end if;

  -- a non-owner client cannot call it
  perform pg_temp.as_user(u1);
  if not pg_temp.fails(format($q$select public.owner_set_client_addon_pack(%L, 'team_hours', true)$q$, c1), 'Owner access') then raise exception 'client enabled its own pack'; end if;

  -- put the pack on sale (service role), then enable it as the owner
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.nxq_addon_pack_catalog set active = true where pack_key = 'team_hours';
  perform pg_temp.as_user(ow);
  r := public.owner_set_client_addon_pack(c1, 'team_hours', true);
  if r->>'changed' <> 'true' or (r->>'price_cents')::int <> 500 then raise exception 'enable failed: %', r; end if;
  r := public.owner_set_client_addon_pack(c1, 'team_hours', true);
  if r->>'changed' <> 'false' then raise exception 'enabling twice must be a no-op: %', r; end if;
  select count(*) into n from public.client_addon_pack_events where client_id = c1 and event_type = 'enabled';
  if n <> 1 then raise exception 'expected one enabled event, saw %', n; end if;

  -- the price at enable time is remembered even if the catalog price changes later
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.nxq_addon_pack_catalog set monthly_price_cents = 900 where pack_key = 'team_hours';
  perform pg_temp.as_user(ow);
  if (select price_cents_when_enabled from public.client_addon_packs where client_id = c1) <> 500 then raise exception 'price history overwritten'; end if;

  -- cancel records the old price, and a second cancel is a no-op
  r := public.owner_set_client_addon_pack(c1, 'team_hours', false);
  if r->>'changed' <> 'true' or r->>'enabled' <> 'false' then raise exception 'cancel failed: %', r; end if;
  r := public.owner_set_client_addon_pack(c1, 'team_hours', false);
  if r->>'changed' <> 'false' then raise exception 'cancelling twice must be a no-op'; end if;
  if (select price_cents from public.client_addon_pack_events where client_id = c1 and event_type = 'cancelled') <> 500 then raise exception 'cancel event lost the price'; end if;

  -- cancelling for a client that never had it is a quiet no-op (no row, no event)
  r := public.owner_set_client_addon_pack(c2, 'team_hours', false);
  if r->>'changed' <> 'false' or exists (select 1 from public.client_addon_packs where client_id = c2) then raise exception 'phantom pack row created'; end if;

  -- re-enable uses the NEW price
  r := public.owner_set_client_addon_pack(c1, 'team_hours', true);
  if (r->>'price_cents')::int <> 900 then raise exception 'new price not applied on re-enable: %', r; end if;

  -- RLS: a client sees only its own rows, the other client sees none of them, and the owner sees all
  perform public.owner_set_client_addon_pack(c2, 'team_hours', true);
  perform pg_temp.as_user(u1);
  set local role authenticated;
  select count(*) into n from public.client_addon_packs;
  reset role;
  if n <> 1 then raise exception 'client one should see exactly its own pack, saw %', n; end if;
  perform pg_temp.as_user(u2);
  set local role authenticated;
  select count(*) into n from public.client_addon_pack_events where client_id = c1;
  reset role;
  if n <> 0 then raise exception 'client two saw client one events (%)', n; end if;
  perform pg_temp.as_user(ow);
  set local role authenticated;
  select count(*) into n from public.client_addon_packs;
  reset role;
  if n <> 2 then raise exception 'owner should see both packs, saw %', n; end if;

  -- a catalog row with a nonsense key or price is rejected
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if not pg_temp.fails($q$insert into public.nxq_addon_pack_catalog(pack_key, label, monthly_price_cents) values ('Bad Key!', 'x', 100)$q$, 'violates check') then raise exception 'bad pack key accepted'; end if;
  if not pg_temp.fails($q$insert into public.nxq_addon_pack_catalog(pack_key, label, monthly_price_cents) values ('ok_key', 'x', -1)$q$, 'violates check') then raise exception 'negative price accepted'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
