-- Sidecar test for 11 (automatic store background: limits, counter, owner approval). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bg-one@synthetic.invalid','',now(),'{}','{"business_name":"BG One","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bg-two@synthetic.invalid','',now(),'{}','{"business_name":"BG Two","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-000000000b03','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bg-nostore@synthetic.invalid','',now(),'{}','{"business_name":"BG NoStore","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-000000000b09','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bg-owner@synthetic.invalid','',now(),'{}','{}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-000000000b09');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'active', '{"look":{"bg":"#fdf9f6","ink":"#1d2f4f","muted":"#4f5b73","accent":"#a8284f","accent_dark":"#861f3e","heading_font":"serif"}}'::jsonb
from (values ('ffffffff-0000-0000-0000-000000000b01'::uuid, 'BG One Store', 'bg-one'),
             ('ffffffff-0000-0000-0000-000000000b02'::uuid, 'BG Two Store', 'bg-two')) as v(uid, name, slug)
join public.clients c on c.auth_user_id = v.uid;

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

do $$
declare
  one uuid := 'ffffffff-0000-0000-0000-000000000b01';
  two uuid := 'ffffffff-0000-0000-0000-000000000b02';
  nostore uuid := 'ffffffff-0000-0000-0000-000000000b03';
  ow uuid := 'ffffffff-0000-0000-0000-000000000b09';
  c1 uuid; c2 uuid; c3 uuid; base text; r jsonb; r2 jsonb; rid uuid; rid2 uuid; look jsonb;
begin
  select id into c1 from public.clients where auth_user_id = one;
  select id into c2 from public.clients where auth_user_id = two;
  select id into c3 from public.clients where auth_user_id = nostore;
  base := 'https://abcdefgh.supabase.co/storage/v1/object/public/commerce-website-content/';

  -- privileges: the owner and client functions are for signed-in users only, the maker's functions for the service role only, the gate and the tables for nobody else
  if has_function_privilege('anon', 'public.owner_set_background_settings(boolean,integer,integer,integer,integer)', 'execute') or has_function_privilege('anon', 'public.get_my_background_status()', 'execute')
     or has_function_privilege('anon', 'public.owner_decide_background_request(uuid,boolean)', 'execute') or has_function_privilege('anon', 'public.owner_list_background_requests(text)', 'execute') then raise exception 'anon must not call owner or client functions'; end if;
  if has_function_privilege('authenticated', 'public.nxq_background_claim_slot(uuid)', 'execute') or has_function_privilege('authenticated', 'public.nxq_background_finish(uuid,boolean,text,numeric)', 'execute')
     or has_function_privilege('anon', 'public.nxq_background_claim_slot(uuid)', 'execute') then raise exception 'only the service role may claim and finish'; end if;
  if has_function_privilege('authenticated', 'public.nxq_background_gate(uuid)', 'execute') or has_function_privilege('anon', 'public.nxq_background_gate(uuid)', 'execute') then raise exception 'the gate is internal'; end if;
  if has_table_privilege('authenticated', 'public.store_background_requests', 'select') or has_table_privilege('anon', 'public.nxq_background_settings', 'select') or has_table_privilege('authenticated', 'public.nxq_background_settings', 'select') then raise exception 'the tables are not readable by clients'; end if;

  -- fails closed out of the box: switch off, nothing allowed, nothing claimed
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not false or r->>'reason' not like '%switched off%' then raise exception 'default must refuse: %', r; end if;
  if (select count(*) from public.store_background_requests) <> 0 then raise exception 'a refusal must not create a row'; end if;
  perform pg_temp.as_user(ow);
  r := public.owner_get_background_settings();
  if (r->>'switched_on')::boolean is not false or (r->>'per_store_allowance')::int <> 0 or (r->>'monthly_cap')::int <> 0 then raise exception 'defaults must be off and zero: %', r; end if;

  -- owner-only settings, with plain validation
  perform pg_temp.as_user(one);
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, 3, 365, 100, 0)$q$, 'Owner access required') then raise exception 'a client cannot set limits'; end if;
  if not pg_temp.fails($q$select public.owner_get_background_settings()$q$, 'Owner access required') then raise exception 'a client cannot read limits'; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, 51, 365, 100, 0)$q$, 'from 0 to 50') then raise exception 'allowance over 50 refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, -1, 365, 100, 0)$q$, 'from 0 to 50') then raise exception 'negative allowance refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, 3, 0, 100, 0)$q$, 'from 1 to 3650') then raise exception 'zero period refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, 3, 365, 100001, 0)$q$, 'from 0 to 100000') then raise exception 'huge monthly cap refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, 3, 365, 100, 90000)$q$, 'from 0 to 86400') then raise exception 'huge wait refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_background_settings(null, 3, 365, 100, 0)$q$, 'Choose on or off') then raise exception 'null switch refused'; end if;
  if not pg_temp.fails($q$select public.owner_set_background_settings(true, null, 365, 100, 0)$q$, 'from 0 to 50') then raise exception 'null allowance refused'; end if;

  -- allowance 2, monthly cap 3, no wait: turn it on
  r := public.owner_set_background_settings(true, 2, 365, 3, 0);
  if (r->>'switched_on')::boolean is not true or (r->>'per_store_allowance')::int <> 2 then raise exception 'settings not saved: %', r; end if;
  if not exists (select 1 from public.automation_audit_log where event_type = 'background_settings_set') then raise exception 'a settings change must be logged'; end if;

  -- a store with no storefront gets a plain refusal; a client sees only their own status
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c3);
  if (r->>'ok')::boolean is not false or r->>'reason' not like '%Create your store first%' then raise exception 'no store refused: %', r; end if;
  perform pg_temp.as_user(one);
  r := public.get_my_background_status();
  if (r->>'can_request')::boolean is not true or (r->>'remaining')::int <> 2 or r ? 'monthly_cap' then raise exception 'client status wrong or leaks global numbers: %', r; end if;

  -- claim, finish, approve: nothing is live until the owner approves
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not true then raise exception 'first claim must work: %', r; end if;
  rid := (r->>'request_id')::uuid;
  if not pg_temp.fails(format($q$select public.nxq_background_finish(%L, true, %L, 0.3)$q$, rid, base || c2 || '/branding/bg.webp'), 'own branding folder') then raise exception 'another store folder refused'; end if;
  if not pg_temp.fails(format($q$select public.nxq_background_finish(%L, true, %L, 0.3)$q$, rid, base || c1 || '/branding/bg.svg'), 'PNG, JPEG or WEBP') then raise exception 'svg refused'; end if;
  if not pg_temp.fails(format($q$select public.nxq_background_finish(%L, true, %L, 0.9)$q$, rid, base || c1 || '/branding/bg.webp'), 'background_overlay') then raise exception 'overlay too big refused'; end if;
  if not pg_temp.fails(format($q$select public.nxq_background_finish(%L, true, null, 0.3)$q$, rid), 'own branding folder') then raise exception 'missing picture refused'; end if;
  r := public.nxq_background_finish(rid, true, base || c1 || '/branding/bg-ai.webp', 0.35);
  if r->>'status' <> 'pending_approval' then raise exception 'a good result must wait for the owner: %', r; end if;
  if not pg_temp.fails(format($q$select public.nxq_background_finish(%L, false)$q$, rid), 'already finished') then raise exception 'a finished request cannot be finished again'; end if;
  perform pg_temp.as_user(null);
  if public.get_public_store_look('bg-one') ? 'background' then raise exception 'NOTHING may be live before approval'; end if;
  perform pg_temp.as_user(one);
  r := public.get_my_background_status();
  if r->>'latest_status' <> 'pending_approval' or (r->>'remaining')::int <> 1 then raise exception 'status after one request: %', r; end if;
  if not pg_temp.fails(format($q$select public.owner_decide_background_request(%L, true)$q$, rid), 'Owner access required') then raise exception 'a client cannot approve'; end if;

  perform pg_temp.as_user(ow);
  r := public.owner_list_background_requests();
  if jsonb_array_length(r) <> 1 or r->0->>'store_slug' <> 'bg-one' or r->0->>'status' <> 'pending_approval' then raise exception 'the owner queue must list the waiting request: %', r; end if;
  r := public.owner_decide_background_request(rid, true);
  if r->>'status' <> 'approved' then raise exception 'approve failed: %', r; end if;
  perform pg_temp.as_user(null);
  look := public.get_public_store_look('bg-one');
  if look->>'background' <> base || c1 || '/branding/bg-ai.webp' or (look->>'background_overlay')::numeric <> 0.35 then raise exception 'approval must put the picture live: %', look; end if;
  if look->>'bg' <> '#fdf9f6' or look->>'heading_font' <> 'serif' or look->>'accent' <> '#a8284f' then raise exception 'approval must keep the owner''s colors: %', look; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format($q$select public.owner_decide_background_request(%L, false)$q$, rid), 'not waiting for a decision') then raise exception 'a decided request cannot be decided again'; end if;

  -- a failed try and a rejected try both COUNT; the store runs out and is told so
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not true then raise exception 'second claim must work: %', r; end if;
  rid2 := (r->>'request_id')::uuid;
  r := public.nxq_background_finish(rid2, false);
  if r->>'status' <> 'failed' then raise exception 'failure must be recorded: %', r; end if;
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not false or r->>'reason' not like '%used its background pictures%' then raise exception 'the store must be out after 2 tries (one approved, one failed): %', r; end if;
  -- reject path counts too
  r := public.nxq_background_claim_slot(c2);
  rid2 := (r->>'request_id')::uuid;
  perform public.nxq_background_finish(rid2, true, base || c2 || '/branding/bg-two.png', 0);
  perform pg_temp.as_user(ow);
  r := public.owner_decide_background_request(rid2, false);
  if r->>'status' <> 'rejected' then raise exception 'reject failed: %', r; end if;
  perform pg_temp.as_user(null);
  if public.get_public_store_look('bg-two') ? 'background' then raise exception 'a rejected picture must never go live'; end if;
  perform pg_temp.as_user(two);
  r := public.get_my_background_status();
  if (r->>'remaining')::int <> 1 then raise exception 'a rejected try still counts: %', r; end if;
  if (r->>'latest_status') <> 'rejected' then raise exception 'latest status for store two: %', r; end if;

  -- the monthly ceiling (3) stops every store: three tries so far (two for store one, one for store two)
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c2);
  if (r->>'ok')::boolean is not false or r->>'reason' not like '%monthly limit%' then raise exception 'the ceiling must stop store two: %', r; end if;
  perform pg_temp.as_user(ow);
  perform public.owner_set_background_settings(true, 2, 365, 4, 0);
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c2);
  if (r->>'ok')::boolean is not true then raise exception 'raising the ceiling must let store two continue: %', r; end if;

  -- last month's tries do not count toward THIS month's ceiling, but still count toward the period allowance
  update public.store_background_requests set created_at = now() - interval '40 days';
  perform pg_temp.as_user(ow);
  perform public.owner_set_background_settings(true, 4, 365, 1, 0);
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not true then raise exception 'old tries must not count to this month''s ceiling: %', r; end if;
  perform pg_temp.as_user(ow);
  perform public.owner_set_background_settings(true, 2, 365, 100, 0);
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not false or r->>'reason' not like '%used its background pictures%' then raise exception 'old tries still count toward the period allowance: %', r; end if;
  -- a short period forgets them
  perform pg_temp.as_user(ow);
  perform public.owner_set_background_settings(true, 2, 30, 100, 0);
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not true then raise exception 'a 30 day period must forget 40 day old tries: %', r; end if;

  -- the wait between tries, with the seconds left
  perform pg_temp.as_user(ow);
  perform public.owner_set_background_settings(true, 50, 365, 1000, 60);
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c2);
  if (r->>'ok')::boolean is not true then raise exception 'the first try after a long gap must work: %', r; end if;
  r := public.nxq_background_claim_slot(c2);
  if (r->>'ok')::boolean is not false or r->>'reason' not like 'Please wait % second%' then raise exception 'cooldown must apply: %', r; end if;
  update public.store_background_requests set created_at = now() - interval '61 seconds';
  r := public.nxq_background_claim_slot(c2);
  if (r->>'ok')::boolean is not true then raise exception 'after the wait it must work: %', r; end if;

  -- the master switch stops everything at once, and nothing changes for a store that already has a picture
  perform pg_temp.as_user(ow);
  perform public.owner_set_background_settings(false, 50, 365, 1000, 0);
  perform pg_temp.as_service();
  r := public.nxq_background_claim_slot(c1);
  if (r->>'ok')::boolean is not false or r->>'reason' not like '%switched off%' then raise exception 'the switch must stop it: %', r; end if;
  perform pg_temp.as_user(one);
  r := public.get_my_background_status();
  if (r->>'enabled')::boolean is not false or (r->>'can_request')::boolean is not false then raise exception 'client status when off: %', r; end if;
  perform pg_temp.as_user(null);
  if public.get_public_store_look('bg-one')->>'background' <> base || c1 || '/branding/bg-ai.webp' then raise exception 'turning the switch off must not remove an approved picture'; end if;
  perform pg_temp.as_user('ffffffff-0000-0000-0000-000000000bff');
  if not pg_temp.fails($q$select public.get_my_background_status()$q$, 'Client workspace not found') then raise exception 'unknown login refused'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
