-- Regression test for migration 280 (test clients stop counting as revenue). Rolled back. Must end by selecting DRAFT_TEST_OK.
-- Proves: complimentary clients are left out of Active MRR and Pipeline value but still counted as accounts; real paying clients are untouched; the label step marks only the four
-- named staging test clients (exact names, active billing, not qa_only), is safe to run twice, and the function stays owner-only with the same grants.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@synthetic.invalid','',now(),'{}','{"business_name":"Owner Co"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','real@synthetic.invalid','',now(),'{}','{"business_name":"Real Paying Roofing"}'),
 ('bbbbbbbb-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','starter@synthetic.invalid','',now(),'{}','{"business_name":"Tier Test Starter"}'),
 ('bbbbbbbb-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','growth@synthetic.invalid','',now(),'{}','{"business_name":"Tier Test Growth"}'),
 ('bbbbbbbb-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa@synthetic.invalid','',now(),'{}','{"business_name":"Tier Test Intelligence"}'),
 ('bbbbbbbb-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lookalike@synthetic.invalid','',now(),'{}','{"business_name":"Tier Test Starter Plumbing"}'),
 ('bbbbbbbb-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','already@synthetic.invalid','',now(),'{}','{"business_name":"Already Free Co"}'),
 ('bbbbbbbb-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lead@synthetic.invalid','',now(),'{}','{"business_name":"Pipeline Lead Co"}');
insert into public.owner_users(auth_user_id) values ('bbbbbbbb-0000-0000-0000-000000000001');
create temp table results(k text, v text);
grant all on results to public;

-- fixtures (as the platform would leave them): prices and billing states set by the service role
-- the platform gives every new signup a default Starter price, including the owner's own test account: zero it so only the fixtures below count
update public.clients set monthly_price = 0 where business_name = 'Owner Co';
update public.clients set monthly_price = 100, billing_status = 'active', billing_provider = 'manual'        where business_name = 'Real Paying Roofing';
update public.clients set monthly_price = 50,  billing_status = 'active', billing_provider = 'manual'        where business_name = 'Tier Test Starter';
update public.clients set monthly_price = 100, billing_status = 'active', billing_provider = 'manual'        where business_name = 'Tier Test Growth';
-- a qa_only client must have price 0, billing not_configured and no provider (a database rule), so it stands in as 'must not be labeled'
update public.clients set monthly_price = 0, billing_status = 'not_configured', billing_provider = null, qa_only = true where business_name = 'Tier Test Intelligence';
update public.clients set monthly_price = 50,  billing_status = 'active', billing_provider = 'manual'        where business_name = 'Tier Test Starter Plumbing';
update public.clients set monthly_price = 70,  billing_status = 'active', billing_provider = 'complimentary' where business_name = 'Already Free Co';
update public.clients set monthly_price = 200, billing_status = 'not_configured', billing_provider = null    where business_name = 'Pipeline Lead Co';

-- privileges: anon cannot run the summary; signed-in users can call it but only an owner gets numbers
do $$ begin
  if has_function_privilege('anon', 'public.owner_portal_summary()', 'execute') then raise exception 'anon can execute owner_portal_summary'; end if;
  if not has_function_privilege('authenticated', 'public.owner_portal_summary()', 'execute') then raise exception 'authenticated cannot execute owner_portal_summary'; end if;
  if not has_function_privilege('service_role', 'public.owner_portal_summary()', 'execute') then raise exception 'service_role cannot execute owner_portal_summary'; end if;
end $$;

-- BEFORE the label step: only 'Already Free Co' is complimentary, so it alone is left out
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ declare s record; begin
  select * into s from public.owner_portal_summary();
  -- active manual: Real 100 + Starter 50 + Growth 100 + Plumbing look-alike 50 = 300; Already Free Co (70) is excluded
  if s.active_monthly_revenue <> 300 then raise exception 'before label: expected MRR 300, got %', s.active_monthly_revenue; end if;
  if s.active_clients <> 5 then raise exception 'active accounts must still count the complimentary one (5), got %', s.active_clients; end if;
  -- pipeline: every non-archived client with a price except the complimentary one: 100 + 50 + 100 + 0 (qa) + 50 + 200 (lead) = 500
  if s.pipeline_monthly_value <> 500 then raise exception 'before label: expected pipeline 500, got %', s.pipeline_monthly_value; end if;
end $$;
reset role;

-- the label step, exactly as written in the migration
update public.clients
   set billing_provider = 'complimentary', updated_at = now()
 where business_name in ('Tier Test Starter', 'Tier Test Growth', 'Tier Test Intelligence', 'Tier Test Enterprise')
   and billing_status::text = 'active'
   and coalesce(qa_only, false) = false
   and coalesce(billing_provider, '') <> 'complimentary';

do $$ declare n int; begin
  select count(*) into n from public.clients where business_name in ('Tier Test Starter','Tier Test Growth') and billing_provider = 'complimentary';
  if n <> 2 then raise exception 'the two real staging test clients must be labeled, got %', n; end if;
  if (select billing_provider from public.clients where business_name = 'Tier Test Intelligence') is not null then raise exception 'a qa_only client must not be labeled'; end if;
  if (select billing_provider from public.clients where business_name = 'Tier Test Starter Plumbing') <> 'manual' then raise exception 'a look-alike name must not be labeled (exact names only)'; end if;
  if (select billing_provider from public.clients where business_name = 'Real Paying Roofing') <> 'manual' then raise exception 'a real paying client must not be labeled'; end if;
end $$;

-- a second run changes nothing
do $$ declare n int; begin
  update public.clients set billing_provider = 'complimentary', updated_at = now()
   where business_name in ('Tier Test Starter', 'Tier Test Growth', 'Tier Test Intelligence', 'Tier Test Enterprise')
     and billing_status::text = 'active' and coalesce(qa_only, false) = false and coalesce(billing_provider, '') <> 'complimentary';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the label step is not idempotent: second run changed % rows', n; end if;
end $$;

-- AFTER: the two labeled clients and 'Already Free Co' are out of the money numbers, and the real client and the look-alike stay in (the qa_only one is $0 and not active)
set local role authenticated;
do $$ declare s record; begin
  select * into s from public.owner_portal_summary();
  -- 300 - Starter 50 - Growth 100 = 150 (Real 100 + Plumbing look-alike 50)
  if s.active_monthly_revenue <> 150 then raise exception 'after label: expected MRR 150, got %', s.active_monthly_revenue; end if;
  if s.pipeline_monthly_value <> 350 then raise exception 'after label: expected pipeline 350 (500 - 150), got %', s.pipeline_monthly_value; end if;
  if s.active_clients <> 5 then raise exception 'active accounts must not shrink (5), got %', s.active_clients; end if;
  if s.total_clients <> 8 then raise exception 'total accounts must not shrink (8), got %', s.total_clients; end if;
end $$;
reset role;

-- a signed-in client who is not an owner gets nothing
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform * from public.owner_portal_summary();
    raise exception 'a non-owner could read the owner summary';
  exception when others then
    if sqlerrm not like 'Owner access required%' then raise; end if;
  end;
end $$;
reset role;

rollback;
select 'DRAFT_TEST_OK';
