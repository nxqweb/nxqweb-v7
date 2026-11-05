-- Sidecar test for 05 (team hours). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000005c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-biz1@synthetic.invalid','',now(),'{}','{"business_name":"Hours One","product_family_slug":"business"}'),
 ('ffffffff-0000-0000-0000-0000000005c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-biz2@synthetic.invalid','',now(),'{}','{"business_name":"Hours Two","product_family_slug":"business"}'),
 ('ffffffff-0000-0000-0000-0000000005c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-nopack@synthetic.invalid','',now(),'{}','{"business_name":"No Pack","product_family_slug":"business"}'),
 ('ffffffff-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-worker1@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000005b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-worker2@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000005b3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','th-worker3@synthetic.invalid','',now(),'{}','{}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000005a1');

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
  ow uuid := 'ffffffff-0000-0000-0000-0000000005a1';
  b1 uuid := 'ffffffff-0000-0000-0000-0000000005c1';
  b2 uuid := 'ffffffff-0000-0000-0000-0000000005c2';
  b3 uuid := 'ffffffff-0000-0000-0000-0000000005c3';
  wu1 uuid := 'ffffffff-0000-0000-0000-0000000005b1';
  wu2 uuid := 'ffffffff-0000-0000-0000-0000000005b2';
  wu3 uuid := 'ffffffff-0000-0000-0000-0000000005b3';
  c1 uuid; c2 uuid; c3 uuid; r jsonb; n integer; tok1 text; tok2 text; wk1 uuid; wk2 uuid; wk1b uuid; e1 uuid; e2 uuid; secs bigint;
begin
  select id into c1 from public.clients where auth_user_id = b1;
  select id into c2 from public.clients where auth_user_id = b2;
  select id into c3 from public.clients where auth_user_id = b3;
  if c1 is null or c2 is null or c3 is null then raise exception 'client fixtures missing'; end if;

  -- HARD RULE (owner, 2026-11-05): no location data of any kind in team hours v1.
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name like 'team\_%'
     and column_name ~* '(lat|lon|lng|geo|gps|location|coord|address|ip_)';
  if n <> 0 then raise exception 'team hours tables must not hold location data (% suspicious columns)', n; end if;

  -- privileges: nobody writes tables directly, anon sees nothing, helpers are not callable
  if has_table_privilege('anon', 'public.team_workers', 'select') or has_table_privilege('anon', 'public.team_time_entries', 'select') then raise exception 'anon must not read team data'; end if;
  if has_table_privilege('authenticated', 'public.team_time_entries', 'insert') or has_table_privilege('authenticated', 'public.team_time_entries', 'update')
     or has_table_privilege('authenticated', 'public.team_workers', 'insert') or has_table_privilege('authenticated', 'public.team_time_entry_edits', 'insert')
     then raise exception 'signed-in users must not write team tables directly'; end if;
  if has_column_privilege('authenticated', 'public.team_workers', 'invite_hash', 'select') then raise exception 'the invite hash must not be readable'; end if;
  if has_function_privilege('authenticated', 'public._team_require_client()', 'execute') or has_function_privilege('authenticated', 'public._team_require_worker(uuid)', 'execute')
     then raise exception 'internal helpers must not be callable by users'; end if;
  if has_function_privilege('anon', 'public.team_clock_in(uuid)', 'execute') or has_function_privilege('anon', 'public.client_add_team_worker(text)', 'execute')
     or has_function_privilege('anon', 'public.team_claim_invite(text)', 'execute') then raise exception 'anon must not call team functions'; end if;

  -- the pack must be switched on: a business without it is refused everywhere
  perform pg_temp.as_user(b3);
  if not pg_temp.fails($q$select public.client_add_team_worker('Nope')$q$, 'not switched on') then raise exception 'worker added without the pack'; end if;
  if not pg_temp.fails($q$select public.client_team_hours_summary(now() - interval '1 day', now())$q$, 'not switched on') then raise exception 'summary served without the pack'; end if;
  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.client_add_team_worker('Anon')$q$, 'Sign in required') then raise exception 'anon added a worker'; end if;
  perform pg_temp.as_user(wu1);
  if not pg_temp.fails($q$select public.client_add_team_worker('Not a business')$q$, 'Business account required') then raise exception 'a non-business user added a worker'; end if;

  -- switch the pack on for businesses 1 and 2 (the owner path from draft 04)
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.nxq_addon_pack_catalog set active = true where pack_key = 'team_hours';
  perform pg_temp.as_user(ow);
  perform public.owner_set_client_addon_pack(c1, 'team_hours', true);
  perform public.owner_set_client_addon_pack(c2, 'team_hours', true);

  -- business 1 adds two workers; the token is returned once and only its hash is stored
  perform pg_temp.as_user(b1);
  if not pg_temp.fails($q$select public.client_add_team_worker('   ')$q$, 'Give the worker a name') then raise exception 'blank worker name accepted'; end if;
  r := public.client_add_team_worker('Ada Worker');
  wk1 := (r->>'worker_id')::uuid; tok1 := r->>'invite_token';
  r := public.client_add_team_worker('Ben Worker');
  wk1b := (r->>'worker_id')::uuid;
  if length(tok1) <> 36 then raise exception 'unexpected token shape'; end if;
  if exists (select 1 from public.team_workers where invite_hash = tok1) then raise exception 'raw token was stored'; end if;
  if (select invite_expires_at from public.team_workers where id = wk1) < now() + interval '6 days' then raise exception 'invite should last about 7 days'; end if;
  -- business 2 has its own worker
  perform pg_temp.as_user(b2);
  r := public.client_add_team_worker('Cleo Worker');
  wk2 := (r->>'worker_id')::uuid; tok2 := r->>'invite_token';

  -- claiming: wrong token, then the right one, then reuse
  perform pg_temp.as_user(wu1);
  if not pg_temp.fails($q$select public.team_claim_invite('not-a-real-token-at-all-xyz')$q$, 'not valid') then raise exception 'bad token accepted'; end if;
  if not pg_temp.fails($q$select public.team_claim_invite('short')$q$, 'not valid') then raise exception 'short token accepted'; end if;
  r := public.team_claim_invite(tok1);
  if (r->>'worker_id')::uuid <> wk1 then raise exception 'claimed the wrong worker'; end if;
  if (select invite_hash from public.team_workers where id = wk1) is not null then raise exception 'invite not cleared after use'; end if;
  perform pg_temp.as_user(wu2);
  if not pg_temp.fails(format($q$select public.team_claim_invite(%L)$q$, tok1), 'not valid') then raise exception 'a used invite was claimed again'; end if;
  -- an expired invite is refused with the same message
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.team_workers set invite_expires_at = now() - interval '1 minute' where id = wk1b;
  perform pg_temp.as_user(b1);
  r := public.client_reissue_team_invite(wk1b);
  perform pg_temp.as_user(b2);
  if not pg_temp.fails(format($q$select public.client_reissue_team_invite(%L)$q$, wk1b), 'Worker not found') then raise exception 'business 2 reissued business 1 invite'; end if;
  perform pg_temp.as_user(b1);
  if not pg_temp.fails(format($q$select public.client_reissue_team_invite(%L)$q$, wk1), 'already joined') then raise exception 'a joined worker was re-invited'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.team_workers set invite_expires_at = now() - interval '1 minute' where id = wk1b;
  perform pg_temp.as_user(wu2);
  if not pg_temp.fails(format($q$select public.team_claim_invite(%L)$q$, r->>'invite_token'), 'not valid') then raise exception 'an expired invite was claimed'; end if;
  perform pg_temp.as_user(b1);
  r := public.client_reissue_team_invite(wk1b);
  perform pg_temp.as_user(wu2);
  perform public.team_claim_invite(r->>'invite_token');
  perform pg_temp.as_user(wu3);
  perform public.team_claim_invite(tok2);

  -- clocking: only your own worker row; one open shift at a time; the time is the server's
  perform pg_temp.as_user(wu1);
  if not pg_temp.fails(format($q$select public.team_clock_in(%L)$q$, wk2), 'Worker not found') then raise exception 'worker clocked in as another business worker'; end if;
  if not pg_temp.fails(format($q$select public.team_clock_in(%L)$q$, wk1b), 'Worker not found') then raise exception 'worker clocked in as a colleague'; end if;
  if not pg_temp.fails(format($q$select public.team_clock_out(%L)$q$, wk1), 'Not clocked in') then raise exception 'clock out without a clock in'; end if;
  r := public.team_clock_in(wk1);
  e1 := (r->>'entry_id')::uuid;
  if not pg_temp.fails(format($q$select public.team_clock_in(%L)$q$, wk1), 'Already clocked in') then raise exception 'double clock in accepted'; end if;
  r := public.team_clock_out(wk1);
  if (r->>'clock_out')::timestamptz <= (r->>'clock_in')::timestamptz then raise exception 'clock out must be after clock in'; end if;
  perform pg_temp.as_user(null);
  if not pg_temp.fails(format($q$select public.team_clock_in(%L)$q$, wk1), 'Sign in required') then raise exception 'anon clocked in'; end if;

  -- RLS reads: a worker sees only their own rows, a business only its own, the owner everything
  perform pg_temp.as_user(wu1);
  set local role authenticated;
  select count(*) into n from public.team_time_entries; if n <> 1 then raise exception 'worker one should see exactly their entry, saw %', n; end if;
  select count(*) into n from public.team_workers; if n <> 1 then raise exception 'worker one should see only their own worker row, saw %', n; end if;
  reset role;
  perform pg_temp.as_user(wu3);
  set local role authenticated;
  select count(*) into n from public.team_time_entries where id = e1; if n <> 0 then raise exception 'another business worker saw this entry'; end if;
  reset role;
  perform pg_temp.as_user(b2);
  set local role authenticated;
  select count(*) into n from public.team_time_entries where client_id = c1; if n <> 0 then raise exception 'business two saw business one hours'; end if;
  select count(*) into n from public.team_workers where client_id = c1; if n <> 0 then raise exception 'business two saw business one workers'; end if;
  reset role;
  perform pg_temp.as_user(b1);
  set local role authenticated;
  select count(*) into n from public.team_workers; if n <> 2 then raise exception 'business one should see its 2 workers, saw %', n; end if;
  if pg_temp.fails($q$select invite_hash from public.team_workers$q$, 'permission denied') is not true then raise exception 'invite hash readable'; end if;
  reset role;
  perform pg_temp.as_user(ow);
  set local role authenticated;
  select count(*) into n from public.team_workers; if n <> 3 then raise exception 'owner should see all 3 workers, saw %', n; end if;
  reset role;

  -- corrections: only your own entries, with a reason, sane times, and the old values are kept
  perform pg_temp.as_user(b2);
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() - interval '3 hours', now() - interval '1 hour', 'trying another business')$q$, e1), 'Entry not found') then raise exception 'business two corrected business one entry'; end if;
  perform pg_temp.as_user(b1);
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() - interval '3 hours', now() - interval '1 hour', '')$q$, e1), 'Say why') then raise exception 'correction without a reason accepted'; end if;
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() - interval '1 hour', now() - interval '2 hours', 'backwards')$q$, e1), 'after the start') then raise exception 'end before start accepted'; end if;
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() + interval '2 hours', null, 'future')$q$, e1), 'future') then raise exception 'future time accepted'; end if;
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() - interval '30 hours', now() - interval '1 hour', 'too long')$q$, e1), '24 hours') then raise exception 'a 29-hour shift accepted'; end if;
  r := public.client_correct_team_entry(e1, now() - interval '3 hours', now() - interval '1 hour', 'forgot to clock in on time');
  if r->>'changed' <> 'true' then raise exception 'correction failed: %', r; end if;
  select count(*) into n from public.team_time_entry_edits where entry_id = e1 and reason = 'forgot to clock in on time' and edited_by = b1;
  if n <> 1 then raise exception 'edit trail missing'; end if;
  if (select before_clock_out from public.team_time_entry_edits where entry_id = e1) is null then raise exception 'the old values were not kept'; end if;
  -- the worker can read their own edit trail, another business cannot
  perform pg_temp.as_user(wu1);
  set local role authenticated; select count(*) into n from public.team_time_entry_edits; reset role;
  if n <> 1 then raise exception 'the worker should see the edit of their own entry, saw %', n; end if;
  perform pg_temp.as_user(b2);
  set local role authenticated; select count(*) into n from public.team_time_entry_edits; reset role;
  if n <> 0 then raise exception 'business two saw business one edits'; end if;
  -- reopening an entry while another is open is refused
  perform pg_temp.as_user(wu1);
  e2 := (public.team_clock_in(wk1)->>'entry_id')::uuid;
  perform pg_temp.as_user(b1);
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() - interval '3 hours', null, 'reopen')$q$, e1), 'another open shift') then raise exception 'two open shifts allowed'; end if;
  -- an identical correction is a no-op and writes no edit row
  r := public.client_correct_team_entry(e2, (select clock_in from public.team_time_entries where id = e2), null, 'nothing changed');
  if r->>'changed' <> 'false' then raise exception 'no-op correction should change nothing'; end if;

  -- summary: closed shift = 2 hours, open shift counts up to now; business two sees none of it
  r := public.client_team_hours_summary(now() - interval '1 day', now() + interval '1 hour');
  select (w->>'seconds')::bigint into secs from jsonb_array_elements(r->'workers') w where (w->>'worker_id')::uuid = wk1;
  if secs < 7200 or secs > 7260 then raise exception 'expected about 7200 seconds for Ada, saw %', secs; end if;
  if (select (w->>'clocked_in')::boolean from jsonb_array_elements(r->'workers') w where (w->>'worker_id')::uuid = wk1) is not true then raise exception 'Ada is clocked in'; end if;
  if jsonb_array_length(r->'workers') <> 2 then raise exception 'business one should list exactly its two workers'; end if;
  if not pg_temp.fails($q$select public.client_team_hours_summary(now(), now() - interval '1 day')$q$, 'date range') then raise exception 'backwards range accepted'; end if;
  if not pg_temp.fails($q$select public.client_team_hours_summary(now() - interval '400 days', now())$q$, 'date range') then raise exception 'a 400-day range accepted'; end if;
  perform pg_temp.as_user(b2);
  r := public.client_team_hours_summary(now() - interval '1 day', now() + interval '1 hour');
  if jsonb_array_length(r->'workers') <> 1 or (r->'workers'->0->>'worker_id')::uuid <> wk2 then raise exception 'business two summary leaked or lost a worker: %', r; end if;

  -- a switched-off worker cannot clock; turning the pack off blocks everything; another business cannot switch workers
  perform pg_temp.as_user(b2);
  if (public.client_set_team_worker_active(wk1, false)->>'changed') <> 'false' then raise exception 'business two switched off business one worker'; end if;
  perform pg_temp.as_user(b1);
  if (public.client_set_team_worker_active(wk1b, false)->>'changed') <> 'true' then raise exception 'switch off failed'; end if;
  perform pg_temp.as_user(wu2);
  if not pg_temp.fails(format($q$select public.team_clock_in(%L)$q$, wk1b), 'switched off') then raise exception 'a switched-off worker clocked in'; end if;
  perform pg_temp.as_user(ow);
  perform public.owner_set_client_addon_pack(c1, 'team_hours', false);
  perform pg_temp.as_user(wu1);
  if not pg_temp.fails(format($q$select public.team_clock_out(%L)$q$, wk1), 'not switched on') then raise exception 'a worker clocked out after the pack was cancelled'; end if;
  perform pg_temp.as_user(b1);
  if not pg_temp.fails(format($q$select public.client_correct_team_entry(%L, now() - interval '5 hours', now() - interval '4 hours', 'after cancel')$q$, e1), 'not switched on') then raise exception 'corrected after cancelling the pack'; end if;
  -- business two is unaffected
  perform pg_temp.as_user(wu3);
  perform public.team_clock_in(wk2);

  -- the 50 worker cap: business two has 1 worker, 49 more fit, the 51st is refused
  perform pg_temp.as_user(b2);
  for n in 1..49 loop perform public.client_add_team_worker('Extra ' || n); end loop;
  if not pg_temp.fails($q$select public.client_add_team_worker('One too many')$q$, 'up to 50') then raise exception 'the 51st worker was accepted'; end if;

  -- shape checks (service role inserts bypass the functions, so check the constraints themselves)
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if not pg_temp.fails(format($q$insert into public.team_time_entries(client_id, worker_id, clock_in, clock_out) values (%L, %L, now(), now() - interval '1 hour')$q$, c2, wk2), 'violates check') then raise exception 'end before start accepted by the table'; end if;
  if not pg_temp.fails(format($q$insert into public.team_time_entries(client_id, worker_id) values (%L, %L)$q$, c2, wk2), 'duplicate key') then raise exception 'two open shifts allowed by the table'; end if;
  if not pg_temp.fails(format($q$insert into public.team_workers(client_id, display_name, invite_hash) values (%L, 'x', 'abc')$q$, c2), 'violates check') then raise exception 'a bad invite hash was accepted'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
