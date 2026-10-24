-- Regression test for migration 277 (AI Desk build plans). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','desk-owner@synthetic.invalid','',now(),'{}','{"business_name":"Owner Co"}'),
 ('dddddddd-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','desk-client1@synthetic.invalid','',now(),'{}','{"business_name":"Candle Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('dddddddd-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','desk-client2@synthetic.invalid','',now(),'{}','{"business_name":"Soap Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.owner_users(auth_user_id) values ('dddddddd-0000-0000-0000-0000000000a1');

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
  owner_id uuid := 'dddddddd-0000-0000-0000-0000000000a1';
  client_user uuid := 'dddddddd-0000-0000-0000-0000000000a2';
  candle uuid; soap uuid;
  fp text := repeat('a', 64);
  req jsonb; res jsonb; r jsonb; n int; job_id uuid; wake timestamptz;
begin
  select id into candle from public.clients where auth_user_id = client_user;
  select id into soap from public.clients where auth_user_id = 'dddddddd-0000-0000-0000-0000000000a3';

  -- the table is closed to every API role; functions are not public
  if has_table_privilege('authenticated', 'public.ai_desk_build_plans', 'select') or has_table_privilege('anon', 'public.ai_desk_build_plans', 'select')
     or has_table_privilege('authenticated', 'public.ai_desk_build_plans', 'insert') or has_table_privilege('authenticated', 'public.ai_desk_build_plans', 'update') then
    raise exception 'the desk table must have no API grants';
  end if;
  if has_function_privilege('anon', 'public.save_ai_desk_build_plan(uuid,jsonb)', 'execute') or has_function_privilege('anon', 'public.get_ai_desk_status(uuid)', 'execute') then
    raise exception 'anon must not execute the desk functions';
  end if;

  req := jsonb_build_object('task', 'enrich_business_build_plan_v1', 'schema_version', 'nxq-business-build-plan-v1', 'request_fingerprint', fp,
    'input', jsonb_build_object('business_name', 'Candle Co', 'services', jsonb_build_array('Soy candles')));
  res := jsonb_build_object('schema_version', 'nxq-business-build-plan-v1', 'request_fingerprint', fp, 'confidence', 0.9, 'risk_flags', '[]'::jsonb, 'strategy', jsonb_build_object('positioning', 'x'));

  -- a plan job exists, with a retry delay (what the worker's "defer" leaves behind)
  insert into public.automation_jobs (client_id, job_type, status, run_after, idempotency_key)
  values (candle, 'prepare_build_plan', 'queued', now() + interval '1 hour', 'desk-test-job') returning id into job_id;

  -- only the owner
  perform pg_temp.as_user(null);
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, res), 'owner access required') then raise exception 'anon must be refused'; end if;
  perform pg_temp.as_user(client_user);
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, res), 'owner access required') then raise exception 'a client must be refused'; end if;
  if not pg_temp.fails(format('select public.get_ai_desk_status(%L)', candle), 'owner access required') then raise exception 'a client must not read desk status'; end if;

  -- as the owner, with no waiting task yet
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  if (public.get_ai_desk_status(candle)->>'status') <> 'none' then raise exception 'status must start as none'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, res), 'No AI Desk task is waiting') then raise exception 'saving with no waiting task must be refused'; end if;
  reset role;

  -- the worker (service role) records the waiting task
  insert into public.ai_desk_build_plans (client_id, desk_fingerprint, request) values (candle, fp, req);
  -- the database allows only one open row per client
  begin
    insert into public.ai_desk_build_plans (client_id, desk_fingerprint, request) values (candle, repeat('c', 64), req);
    raise exception 'a second open row must be refused';
  exception when unique_violation then null; end;

  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  r := public.get_ai_desk_status(candle);
  if r->>'status' <> 'waiting' or r->'request'->>'request_fingerprint' <> fp then raise exception 'status must show the waiting task to copy'; end if;
  if public.get_ai_desk_status(soap)->>'status' <> 'none' then raise exception 'another client must not see this task'; end if;

  -- planted-bug controls: every one of these must be refused and leave the task waiting
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', soap, res), 'No AI Desk task is waiting') then raise exception 'a task must not be savable against another client'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, jsonb_set(res, '{request_fingerprint}', to_jsonb(repeat('b', 64)))), 'does not match the waiting task') then raise exception 'fingerprint mismatch must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, res || '{"extra":1}'::jsonb), 'unexpected shape') then raise exception 'extra key must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, jsonb_set(res, '{confidence}', '0.5')), 'confidence must be 0.82') then raise exception 'low confidence must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, jsonb_set(res, '{confidence}', '"0.9"')), 'must be a number') then raise exception 'text confidence must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, jsonb_set(res, '{risk_flags}', '["unsure"]')), 'risk flags') then raise exception 'risk flags must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, jsonb_set(res, '{schema_version}', '"v2"')), 'wrong schema version') then raise exception 'wrong schema must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, jsonb_set(res, '{strategy}', jsonb_build_object('pad', repeat('x', 70000)))), 'too large') then raise exception 'oversized answer must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, to_jsonb('hi'::text)), 'JSON object') then raise exception 'non-object must be refused'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', null, res), 'required') then raise exception 'null client must be refused'; end if;
  reset role;
  select count(*) into n from public.ai_desk_build_plans where client_id = candle and status = 'waiting' and result is null;
  if n <> 1 then raise exception 'refused saves must leave the task waiting and empty, got %', n; end if;

  -- a good save: the row becomes saved, the owner is recorded, the plan job is woken, and it is audited
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  r := public.save_ai_desk_build_plan(candle, res);
  reset role;
  if r->>'status' <> 'saved' or (r->>'ok')::boolean is not true then raise exception 'good save must succeed'; end if;
  if (select saved_by from public.ai_desk_build_plans where client_id = candle and status = 'saved') is distinct from owner_id then raise exception 'saved_by must be the owner'; end if;
  select run_after into wake from public.automation_jobs where id = job_id;
  if wake > now() then raise exception 'saving must wake the plan job'; end if;
  select count(*) into n from public.automation_audit_log where client_id = candle and event_type = 'ai_desk_plan_saved';
  if n <> 1 then raise exception 'the save must be audited, got %', n; end if;
  select count(*) into n from public.ai_desk_build_plans where client_id = soap;
  if n <> 0 then raise exception 'other clients must be untouched'; end if;

  -- while saved there is no task to copy; saving twice is refused
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  r := public.get_ai_desk_status(candle);
  if r->>'status' <> 'saved' or r->'request' is not null and r->>'request' <> 'null' then raise exception 'a saved status must not offer the old task again'; end if;
  if not pg_temp.fails(format('select public.save_ai_desk_build_plan(%L, %L)', candle, res), 'No AI Desk task is waiting') then raise exception 'a second save must be refused'; end if;
  reset role;

  -- the worker rejects the plan: the owner sees the plain reason and a fresh task is waiting
  update public.ai_desk_build_plans set status = 'rejected', last_error = 'AI build-plan contains unsupported marketing claims: quality claim.' where client_id = candle and status = 'saved';
  insert into public.ai_desk_build_plans (client_id, desk_fingerprint, request) values (candle, fp, req);
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  r := public.get_ai_desk_status(candle);
  if r->>'status' <> 'waiting' or r->>'last_error' not like '%quality claim%' then raise exception 'a rejection must show its reason beside the fresh task'; end if;
  r := public.save_ai_desk_build_plan(candle, jsonb_set(res, '{confidence}', '0.95'));
  reset role;

  -- the worker uses it: used, and no stale rejection is shown any more
  update public.ai_desk_build_plans set status = 'used', used_at = now() where client_id = candle and status = 'saved';
  perform pg_temp.as_user(owner_id);
  set local role authenticated;
  r := public.get_ai_desk_status(candle);
  if r->>'status' <> 'used' or r->>'last_error' is not null then raise exception 'used status must clear the old rejection, got %', r; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
