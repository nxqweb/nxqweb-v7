-- Regression test for migration 288 (was draft 05) (tighten the ai_rules read policy and the change-request insert policy). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec05-one@synthetic.invalid','',now(),'{}','{"business_name":"Sec05 One Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000005a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec05-two@synthetic.invalid','',now(),'{}','{"business_name":"Sec05 Two Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000005a9','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec05-owner@synthetic.invalid','',now(),'{}','{}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000005a9');

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;

do $$
declare
  u1 uuid := 'ffffffff-0000-0000-0000-0000000005a1';
  u2 uuid := 'ffffffff-0000-0000-0000-0000000005a2';
  ow uuid := 'ffffffff-0000-0000-0000-0000000005a9';
  c1 uuid; c2 uuid; p1 uuid; p2 uuid; n integer; blocked boolean;
begin
  select id into c1 from public.clients where auth_user_id = u1;
  select id into c2 from public.clients where auth_user_id = u2;
  if c1 is null or c2 is null then raise exception 'client fixtures missing (test would be vacuous)'; end if;
  insert into public.projects(client_id, project_name) values (c1, 'Sec One site') returning id into p1;
  insert into public.projects(client_id, project_name) values (c2, 'Sec Two site') returning id into p2;
  insert into public.ai_rules(rule_key, rule_text, is_active) values ('sec05_fixture_rule', 'fixture', true);

  -- ai_rules: anon has no privilege at all, a signed-in client sees nothing, the owner still reads
  if has_table_privilege('anon', 'public.ai_rules', 'select') then raise exception 'anon still has select on ai_rules'; end if;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  select count(*) into n from public.ai_rules;
  reset role;
  if n <> 0 then raise exception 'a client can still read ai_rules (% rows)', n; end if;
  perform pg_temp.as_user(ow);
  set local role authenticated;
  select count(*) into n from public.ai_rules where rule_key = 'sec05_fixture_rule';
  reset role;
  if n <> 1 then raise exception 'the owner can no longer read ai_rules'; end if;

  -- change requests: client one may file for its own project ...
  perform pg_temp.as_user(u1);
  set local role authenticated;
  insert into public.website_change_requests(client_id, project_id, request_type, title, description, requested_by_auth_user_id)
    values (c1, p1, 'design', 'Own project request', 'Fixture request for the client''s own project.', u1);
  reset role;

  -- ... but not with its own client id and ANOTHER client's project (already refused before this migration,
  -- through row security on projects; this pins the behaviour so the rewritten policy cannot loosen it)
  blocked := false;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  begin
    insert into public.website_change_requests(client_id, project_id, request_type, title, description, requested_by_auth_user_id)
      values (c1, p2, 'design', 'Other project request', 'Must be refused by row security.', u1);
  exception when insufficient_privilege then
    blocked := true;
  end;
  reset role;
  if not blocked then raise exception 'a client could file a change request against another client''s project'; end if;

  -- ... and not for another client's row either
  blocked := false;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  begin
    insert into public.website_change_requests(client_id, project_id, request_type, title, description, requested_by_auth_user_id)
      values (c2, p2, 'design', 'Other client request', 'Must be refused by row security.', u1);
  exception when insufficient_privilege then
    blocked := true;
  end;
  reset role;
  if not blocked then raise exception 'a client could file a change request as another client'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
