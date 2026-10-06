-- Sidecar test for 04. Rolled back. Proves link / unlink / list are owner-only, validate the customer id, refuse QA-only and
-- cross-client links, are idempotent, keep one row per client, and produce links the Stripe webhook can look up.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@synthetic.invalid','',now(),'{}','{"business_name":"Owner Co"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','alpha@synthetic.invalid','',now(),'{}','{"business_name":"Alpha Roofing","product_family_slug":"business","product_tier_key":"growth"}'),
 ('bbbbbbbb-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','beta@synthetic.invalid','',now(),'{}','{"business_name":"Beta Tree Care","product_family_slug":"business","product_tier_key":"growth"}'),
 ('bbbbbbbb-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa@synthetic.invalid','',now(),'{}','{"business_name":"Gamma QA Disposable","product_family_slug":"business","product_tier_key":"growth"}');
insert into public.owner_users(auth_user_id) values ('bbbbbbbb-0000-0000-0000-000000000001');
update public.clients set qa_only = true, monthly_price = 0 where business_name = 'Gamma QA Disposable';
create temp table ids as select business_name, id from public.clients where business_name in ('Alpha Roofing','Beta Tree Care','Gamma QA Disposable');
grant all on ids to public;

-- privileges: anon cannot execute any of the three
do $$ begin
  if has_function_privilege('anon','public.owner_link_stripe_customer(uuid,text)','execute') then raise exception 'anon can link'; end if;
  if has_function_privilege('anon','public.owner_disable_stripe_customer_link(uuid,text)','execute') then raise exception 'anon can disable'; end if;
  if has_function_privilege('anon','public.owner_list_stripe_customer_links()','execute') then raise exception 'anon can list'; end if;
end $$;

-- a non-owner client is refused everywhere
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ declare a uuid; begin
  select id into a from ids where business_name='Alpha Roofing';
  begin perform public.owner_link_stripe_customer(a,'cus_AAAAAAAA0001'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'Owner access required.%' then raise exception 'non-owner link: %', sqlerrm; end if; end;
  begin perform public.owner_list_stripe_customer_links(); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'Owner access required.%' then raise exception 'non-owner list: %', sqlerrm; end if; end;
  begin perform public.owner_disable_stripe_customer_link(a,'x'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'Owner access required.%' then raise exception 'non-owner disable: %', sqlerrm; end if; end;
end $$;
reset role;

-- as the owner
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ declare a uuid; b uuid; g uuid; r jsonb; n int; st text; begin
  select id into a from ids where business_name='Alpha Roofing';
  select id into b from ids where business_name='Beta Tree Care';
  select id into g from ids where business_name='Gamma QA Disposable';

  -- malformed ids
  begin perform public.owner_link_stripe_customer(a,'not-a-customer'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'A Stripe customer ID looks like%' then raise exception 'bad id accepted: %', sqlerrm; end if; end;
  begin perform public.owner_link_stripe_customer(a,'cus_short'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'A Stripe customer ID looks like%' then raise exception 'short id accepted: %', sqlerrm; end if; end;
  begin perform public.owner_link_stripe_customer(a,'sk_live_AAAAAAAAAAAA'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'A Stripe customer ID looks like%' then raise exception 'secret-looking value accepted: %', sqlerrm; end if; end;

  -- QA-only client and unknown client are refused
  begin perform public.owner_link_stripe_customer(g,'cus_GGGGGGGG0001'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'QA-only clients%' then raise exception 'qa client linked: %', sqlerrm; end if; end;
  begin perform public.owner_link_stripe_customer(gen_random_uuid(),'cus_ZZZZZZZZ0001'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'Client not found.%' then raise exception 'unknown client: %', sqlerrm; end if; end;

  -- happy path
  r := public.owner_link_stripe_customer(a,'cus_AAAAAAAA0001');
  if (r->>'success')::boolean is not true then raise exception 'link failed: %', r; end if;
  execute 'reset role';
  select count(*), max(status) into n, st from public.billing_provider_customer_links where client_id=a and provider_key='stripe';
  execute 'set local role authenticated';
  if n<>1 or st<>'active' then raise exception 'expected one active link, got % %', n, st; end if;

  -- idempotent repeat
  r := public.owner_link_stripe_customer(a,'cus_AAAAAAAA0001');
  if (r->>'already_applied')::boolean is not true then raise exception 'repeat was not idempotent: %', r; end if;

  -- same customer to another client, and a second customer for the same client, are refused
  begin perform public.owner_link_stripe_customer(b,'cus_AAAAAAAA0001'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'That Stripe customer is already linked%' then raise exception 'cross-client link: %', sqlerrm; end if; end;
  begin perform public.owner_link_stripe_customer(a,'cus_AAAAAAAA0002'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'This client already has a different active%' then raise exception 'second customer: %', sqlerrm; end if; end;
end $$;

-- the webhook looks links up by customer id + active status through the service role: that lookup must find Alpha
reset role;
do $$ declare found_client uuid; a uuid; begin
  select id into a from ids where business_name='Alpha Roofing';
  select client_id into found_client from public.billing_provider_customer_links
   where provider_key='stripe' and provider_customer_id='cus_AAAAAAAA0001' and status='active';
  if found_client is distinct from a then raise exception 'webhook-style lookup did not find the linked client'; end if;
  -- the audit row records only a short hint, never the full customer id
  if exists (select 1 from public.automation_audit_log where client_id=a and details::text like '%cus_AAAAAAAA0001%') then raise exception 'full customer id leaked into audit log'; end if;
  if not exists (select 1 from public.automation_audit_log where client_id=a and event_type='owner_stripe_customer_linked' and details->>'customer_hint'='0001') then raise exception 'missing audit row'; end if;
end $$;

select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ declare a uuid; b uuid; r jsonb; n int; st text; cnt int; begin
  select id into a from ids where business_name='Alpha Roofing';
  select id into b from ids where business_name='Beta Tree Care';

  -- list shows the link for the owner
  select count(*) into cnt from public.owner_list_stripe_customer_links() l where l.client_id=a and l.status='active';
  if cnt<>1 then raise exception 'list did not show the active link'; end if;

  -- disable, then a second disable is refused (nothing active)
  r := public.owner_disable_stripe_customer_link(a,'test');
  if (r->>'success')::boolean is not true then raise exception 'disable failed: %', r; end if;
  begin perform public.owner_disable_stripe_customer_link(a,'again'); raise exception 'NO_ERROR';
  exception when others then if sqlerrm='NO_ERROR' or sqlerrm not like 'This client has no active%' then raise exception 'double disable: %', sqlerrm; end if; end;

  -- relink after a disable reuses the same row (one row per client) with the new customer
  r := public.owner_link_stripe_customer(a,'cus_AAAAAAAA0003');
  execute 'reset role';
  select count(*), max(status) into n, st from public.billing_provider_customer_links where client_id=a and provider_key='stripe';
  if n<>1 or st<>'active' then raise exception 'relink should keep one active row, got % %', n, st; end if;
  if not exists (select 1 from public.billing_provider_customer_links where client_id=a and provider_customer_id='cus_AAAAAAAA0003' and verified_at is null) then raise exception 'relink did not store the new customer'; end if;

  -- the old customer id is no longer active for anyone
  if exists (select 1 from public.billing_provider_customer_links where provider_customer_id='cus_AAAAAAAA0001' and status='active') then raise exception 'old customer still active'; end if;
  execute 'set local role authenticated';

  -- Beta can now take the old id? No: the id was replaced on Alpha's row, so it is free
  r := public.owner_link_stripe_customer(b,'cus_AAAAAAAA0001');
  if (r->>'success')::boolean is not true then raise exception 'freed customer id could not be linked: %', r; end if;
end $$;
reset role;

select 'DRAFT_TEST_OK';
rollback;
