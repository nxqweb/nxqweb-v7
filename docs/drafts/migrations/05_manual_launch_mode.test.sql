-- Sidecar test for 05 (manual launch mode). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-000000000c01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manual-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-000000000c02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manual-client@synthetic.invalid','',now(),'{}','{"business_name":"Manual Co","product_family_slug":"business","product_tier_key":"starter"}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-000000000c01');

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;
create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin execute sql; return false; exception when others then return sqlerrm like '%' || expected || '%'; end $f$;

do $$
declare
  ow uuid := 'ffffffff-0000-0000-0000-000000000c01'; cl uuid := 'ffffffff-0000-0000-0000-000000000c02';
  three text[] := array['notification_pipeline_ready','change_classifier_ready','business_build_plan_ai_ready'];
  r jsonb; n integer; msg text;
begin
  -- the migration applied the decision: exactly these three checks are waived, with a reason and a time, and nothing else is
  if (select count(*) from public.launch_readiness_checks where check_key = any(three) and required is false and waived_reason like 'Manual launch mode%' and waived_at is not null) <> 3 then raise exception 'the three checks must be waived with a reason'; end if;
  if exists (select 1 from public.launch_readiness_checks where waived_reason is not null and not (check_key = any(three))) then raise exception 'no other check may be waived'; end if;
  if (select required from public.launch_readiness_checks where check_key = 'owner_launch_signoff') is not true then raise exception 'the sign-off itself must stay required'; end if;
  if (select count(*) from public.launch_readiness_checks where check_key in ('file_security_pipeline_ready','ten_clean_runs','rls_isolation_passed') and required) <> 3 then raise exception 'other checks (scanner, ten runs, isolation) must stay required'; end if;

  -- privileges and who may use the switch
  if has_function_privilege('anon', 'public.owner_set_manual_launch_mode(boolean)', 'execute') then raise exception 'anon must not call it'; end if;
  perform pg_temp.as_user(cl);
  if not pg_temp.fails($q$select public.owner_set_manual_launch_mode(false)$q$, 'owner access required') and not pg_temp.fails($q$select public.owner_set_manual_launch_mode(false)$q$, 'Authenticated owner access required') then raise exception 'a client must not use the switch'; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails($q$select public.owner_set_manual_launch_mode(null)$q$, 'Choose on or off') then raise exception 'null refused'; end if;

  -- test setup only: the ten-run check is written only by the strict counter and cannot be set by hand, so it is taken out of the required set for this test
  update public.launch_readiness_checks set required = false where check_key = 'ten_clean_runs';
  -- with manual mode on, the sign-off is NOT blocked by the three waived checks (they can sit at unknown)
  update public.launch_readiness_checks set status = 'ready' where required and check_key <> 'owner_launch_signoff';
  update public.launch_readiness_checks set status = 'unknown' where check_key = any(three);
  r := public.owner_approve_nxq_launch_readiness('APPROVE-NXQ-AUTONOMOUS-LAUNCH');
  if (select status from public.launch_readiness_checks where check_key = 'owner_launch_signoff') <> 'ready' then raise exception 'sign-off must succeed with the three waived: %', r; end if;

  -- turning manual mode OFF makes them required again AND withdraws the sign-off (the status guard alone would miss it)
  r := public.owner_set_manual_launch_mode(false);
  if (r->>'checks_changed')::int <> 3 or (r->>'signoff_withdrawn')::boolean is not true then raise exception 'off must restore three checks and withdraw the sign-off: %', r; end if;
  if (select count(*) from public.launch_readiness_checks where check_key = any(three) and required and waived_reason is null and waived_at is null) <> 3 then raise exception 'off must clear the waiver'; end if;
  if (select status from public.launch_readiness_checks where check_key = 'owner_launch_signoff') <> 'unknown' then raise exception 'the sign-off must be withdrawn'; end if;
  begin
    perform public.owner_approve_nxq_launch_readiness('APPROVE-NXQ-AUTONOMOUS-LAUNCH');
    raise exception 'sign-off must be blocked again';
  exception when others then
    msg := sqlerrm;
    if msg not like '%blocked by required checks%' or msg not like '%notification_pipeline_ready%' or msg not like '%change_classifier_ready%' or msg not like '%business_build_plan_ai_ready%' then raise exception 'the block must name the three again: %', msg; end if;
  end;

  -- and on again: waived again, sign-off possible again; both switches are logged
  r := public.owner_set_manual_launch_mode(true);
  if (r->>'checks_changed')::int <> 3 or (r->>'signoff_withdrawn')::boolean is not false then raise exception 'on must waive three checks: %', r; end if;
  update public.launch_readiness_checks set status = 'ready' where required and check_key <> 'owner_launch_signoff';
  perform public.owner_approve_nxq_launch_readiness('APPROVE-NXQ-AUTONOMOUS-LAUNCH');
  select count(*) into n from public.automation_audit_log where event_type = 'manual_launch_mode_set';
  if n <> 2 then raise exception 'both switches must be logged, got %', n; end if;

  -- an evaluator rewriting status and evidence must not undo the waiver
  update public.launch_readiness_checks set status = 'unknown', evidence = '{"configured": false}'::jsonb, last_checked_at = now() where check_key = any(three);
  if (select count(*) from public.launch_readiness_checks where check_key = any(three) and required is false and waived_reason is not null) <> 3 then raise exception 'an evaluator run must not undo the waiver'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
