-- Sidecar test for 06 (owner-only reads of the tier policy and feature-flag tables). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000006a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec06-one@synthetic.invalid','',now(),'{}','{"business_name":"Sec06 One Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000006a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec06-two@synthetic.invalid','',now(),'{}','{"business_name":"Sec06 Two Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000006a9','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec06-owner@synthetic.invalid','',now(),'{}','{}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000006a9');

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;

do $$
declare
  u1 uuid := 'ffffffff-0000-0000-0000-0000000006a1';
  ow uuid := 'ffffffff-0000-0000-0000-0000000006a9';
  total_policy integer; total_flags integer; n integer;
begin
  select count(*) into total_policy from public.nxq_tier_economic_policies;
  select count(*) into total_flags from public.nxq_feature_flags;
  if total_policy = 0 or total_flags = 0 then raise exception 'seed rows missing (test would be vacuous): % policy rows, % flag rows', total_policy, total_flags; end if;

  perform pg_temp.as_user(u1);
  set local role authenticated;
  select count(*) into n from public.nxq_tier_economic_policies;
  if n <> 0 then raise exception 'a client can still read the tier policy table (% rows)', n; end if;
  select count(*) into n from public.nxq_feature_flags;
  if n <> 0 then raise exception 'a client can still read the feature flags (% rows)', n; end if;
  reset role;

  perform pg_temp.as_user(ow);
  set local role authenticated;
  select count(*) into n from public.nxq_tier_economic_policies;
  if n <> total_policy then raise exception 'the owner lost rows in the tier policy table (% of %)', n, total_policy; end if;
  select count(*) into n from public.nxq_feature_flags;
  if n <> total_flags then raise exception 'the owner lost rows in the feature flags (% of %)', n, total_flags; end if;
  reset role;
end $$;

select 'DRAFT_TEST_OK';
rollback;
