-- Sidecar test for 03 (pre-launch waitlist). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000003a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wl-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000003b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wl-nobody@synthetic.invalid','',now(),'{}','{}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000003a1');

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
  ow uuid := 'ffffffff-0000-0000-0000-0000000003a1';
  nb uuid := 'ffffffff-0000-0000-0000-0000000003b1';
  r1 jsonb; r2 jsonb; n integer; tok uuid; tok_b uuid; s jsonb;
begin
  -- privileges: anon and signed-in users cannot call the service functions or read the table directly
  if has_function_privilege('anon', 'public.nxq_waitlist_join(text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_waitlist_join(text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.nxq_waitlist_confirm(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_waitlist_remove(uuid)', 'execute')
     or has_function_privilege('anon', 'public.owner_waitlist_invite_wave(integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.owner_waitlist_summary()', 'execute')
     or not has_function_privilege('service_role', 'public.nxq_waitlist_join(text,text,text)', 'execute')
  then raise exception 'unexpected execute privileges'; end if;
  if has_table_privilege('anon', 'public.nxq_waitlist_signups', 'select') then raise exception 'anon must not read the list'; end if;
  if has_column_privilege('authenticated', 'public.nxq_waitlist_signups', 'removal_token', 'select') then raise exception 'the removal token must not be readable by signed-in users'; end if;

  -- join: normalizes, and the answer is identical for a new and an existing address
  perform pg_temp.as_service();
  r1 := public.nxq_waitlist_join('  Fan.One@Example.INVALID ', 'Creator_A', 'v1');
  r2 := public.nxq_waitlist_join('fan.one@example.invalid', 'someone_else', 'v1');
  if r1 is distinct from r2 or r1->>'ok' <> 'true' then raise exception 'join answers differ: % vs %', r1, r2; end if;
  select count(*) into n from public.nxq_waitlist_signups;
  if n <> 1 then raise exception 'duplicate address created a second row (%)', n; end if;
  if (select source from public.nxq_waitlist_signups) <> 'creator_a' then raise exception 'source not normalized or overwritten'; end if;
  if (select status from public.nxq_waitlist_signups) <> 'pending' then raise exception 'new signup must start pending'; end if;

  -- bad input is rejected; a weird source falls back to direct
  if not pg_temp.fails($q$select public.nxq_waitlist_join('not-an-email', 'x', 'v1')$q$, 'valid email') then raise exception 'bad email accepted'; end if;
  if not pg_temp.fails($q$select public.nxq_waitlist_join('a@b.invalid', 'x', '')$q$, 'consent') then raise exception 'missing consent version accepted'; end if;
  perform public.nxq_waitlist_join('fan.two@example.invalid', 'drop table; --', 'v1');
  if (select source from public.nxq_waitlist_signups where email = 'fan.two@example.invalid') <> 'direct' then raise exception 'unsafe source kept'; end if;

  -- a non-service caller cannot join
  perform pg_temp.as_user(nb);
  if not pg_temp.fails($q$select public.nxq_waitlist_join('x@y.invalid', 'x', 'v1')$q$, 'Service-role') then raise exception 'non-service join allowed'; end if;
  perform pg_temp.as_service();

  -- confirm only works on the matching token and only from pending
  select removal_token into tok from public.nxq_waitlist_signups where email = 'fan.one@example.invalid';
  select removal_token into tok_b from public.nxq_waitlist_signups where email = 'fan.two@example.invalid';
  perform public.nxq_waitlist_confirm(gen_random_uuid());
  if exists (select 1 from public.nxq_waitlist_signups where status <> 'pending') then raise exception 'an unknown token confirmed someone'; end if;
  perform public.nxq_waitlist_confirm(tok);
  if (select status from public.nxq_waitlist_signups where email = 'fan.one@example.invalid') <> 'confirmed' then raise exception 'confirm failed'; end if;
  if (select status from public.nxq_waitlist_signups where email = 'fan.two@example.invalid') <> 'pending' then raise exception 'confirm touched the wrong row'; end if;
  perform public.nxq_waitlist_confirm(tok_b);

  -- owner: wave invites take confirmed people, oldest first, and never twice
  perform pg_temp.as_user(nb);
  if not pg_temp.fails($q$select public.owner_waitlist_invite_wave(1, 1)$q$, 'Owner access') then raise exception 'non-owner invited a wave'; end if;
  if not pg_temp.fails($q$select public.owner_waitlist_summary()$q$, 'Owner access') then raise exception 'non-owner read the summary'; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails($q$select public.owner_waitlist_invite_wave(0, 1)$q$, 'wave number') then raise exception 'wave 0 accepted'; end if;
  if not pg_temp.fails($q$select public.owner_waitlist_invite_wave(1, 101)$q$, '1 and 100') then raise exception 'oversized wave accepted'; end if;
  s := public.owner_waitlist_invite_wave(1, 1);
  if (s->>'invited')::int <> 1 then raise exception 'wave 1 should invite exactly one: %', s; end if;
  if (select status from public.nxq_waitlist_signups where email = 'fan.one@example.invalid') <> 'invited'
     or (select wave from public.nxq_waitlist_signups where email = 'fan.one@example.invalid') <> 1 then raise exception 'oldest confirmed was not invited first'; end if;
  s := public.owner_waitlist_invite_wave(2, 5);
  if (s->>'invited')::int <> 1 then raise exception 'wave 2 should only find the one remaining confirmed person: %', s; end if;
  s := public.owner_waitlist_invite_wave(3, 5);
  if (s->>'invited')::int <> 0 then raise exception 'an already-invited person was invited again: %', s; end if;
  s := public.owner_waitlist_summary();
  if (s->'by_status'->>'invited')::int <> 2 or (s->'by_source'->>'creator_a')::int <> 1 then raise exception 'summary counts wrong: %', s; end if;

  -- the owner can read rows (but not the token); a signed-in non-owner reads nothing
  set local role authenticated;
  select count(*) into n from public.nxq_waitlist_signups;
  reset role;
  if n <> 2 then raise exception 'owner should see 2 rows, saw %', n; end if;
  perform pg_temp.as_user(nb);
  set local role authenticated;
  select count(*) into n from public.nxq_waitlist_signups;
  reset role;
  if n <> 0 then raise exception 'a non-owner saw % rows', n; end if;

  -- removal erases the row; an unknown token answers the same way
  perform pg_temp.as_service();
  r1 := public.nxq_waitlist_remove(tok);
  r2 := public.nxq_waitlist_remove(gen_random_uuid());
  if r1 is distinct from r2 then raise exception 'remove answers differ'; end if;
  if exists (select 1 from public.nxq_waitlist_signups where email = 'fan.one@example.invalid') then raise exception 'the row was not erased'; end if;
  if (select count(*) from public.nxq_waitlist_signups) <> 1 then raise exception 'remove erased the wrong rows'; end if;

  -- the table check: a status of invited needs a wave number
  if not pg_temp.fails($q$update public.nxq_waitlist_signups set status = 'invited', wave = null$q$, 'violates check') then raise exception 'invited without a wave accepted'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
