-- Regression test for migration 265. Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  fam uuid; tier uuid;
  u_qa uuid := gen_random_uuid(); u_qa_stopped uuid := gen_random_uuid(); u_real_nobill uuid := gen_random_uuid(); u_real_active uuid := gen_random_uuid(); u_qa_denied uuid := gen_random_uuid();
  c_qa uuid := gen_random_uuid(); c_qa_stopped uuid := gen_random_uuid(); c_real_nobill uuid := gen_random_uuid(); c_real_active uuid := gen_random_uuid(); c_qa_denied uuid := gen_random_uuid();
  r jsonb;
begin
  select pf.id into fam from public.product_families pf where pf.slug='business' and pf.is_active=true;
  select pft.id into tier from public.product_family_tiers pft where pft.product_family_id=fam and pft.tier_key='growth' and pft.is_active=true;
  if fam is null or tier is null then raise exception 'business/growth catalog entry missing (test would be vacuous)'; end if;
  if not exists(select 1 from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='growth' and feature_key='managed_website' and enabled) then
    raise exception 'business/growth managed_website entitlement missing (test would be vacuous)';
  end if;

  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated','qa-feature-'||u::text||'@synthetic.invalid','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
  from unnest(array[u_qa,u_qa_stopped,u_real_nobill,u_real_active,u_qa_denied]) u;

  insert into public.clients (id,auth_user_id,business_name,contact_email,business_type,status,monthly_price,billing_status,billing_provider,product_family_id,product_tier_id,qa_only) values
    (c_qa,u_qa,'QA Feature One','qa-feature-'||u_qa::text||'@synthetic.invalid','Synthetic','approved',0,'not_configured',null,fam,tier,true),
    (c_qa_denied,u_qa_denied,'QA Feature Denied','qa-feature-'||u_qa_denied::text||'@synthetic.invalid','Synthetic','denied',0,'not_configured',null,fam,tier,true),
    (c_real_nobill,u_real_nobill,'Real No Billing','qa-feature-'||u_real_nobill::text||'@synthetic.invalid','Synthetic','approved',100,'not_configured',null,fam,tier,false),
    (c_real_active,u_real_active,'Real Active','qa-feature-'||u_real_active::text||'@synthetic.invalid','Synthetic','approved',100,'active','synthetic',fam,tier,false),
    (c_qa_stopped,u_qa_stopped,'QA Feature Stopped','qa-feature-'||u_qa_stopped::text||'@synthetic.invalid','Synthetic','approved',0,'not_configured',null,fam,tier,true);
  update public.clients set pipeline_stopped_at=now() where id=c_qa_stopped;

  r := public.client_feature_access(c_qa,'managed_website');
  if (r->>'allowed')::boolean is not true then raise exception 'approved QA-only client must be allowed managed_website: %', r; end if;

  r := public.client_feature_access(c_real_nobill,'managed_website');
  if (r->>'allowed')::boolean is not false or r->>'reason' <> 'billing_not_active' then raise exception 'real client without billing must still be denied: %', r; end if;

  r := public.client_feature_access(c_real_active,'managed_website');
  if (r->>'allowed')::boolean is not true then raise exception 'real client with active billing must stay allowed: %', r; end if;

  r := public.client_feature_access(c_qa_stopped,'managed_website');
  if (r->>'allowed')::boolean is not false or r->>'reason' <> 'pipeline_stopped' then raise exception 'QA client with a stopped pipeline must be denied: %', r; end if;

  r := public.client_feature_access(c_qa_denied,'managed_website');
  if (r->>'allowed')::boolean is not false then raise exception 'denied QA client must not be allowed: %', r; end if;

  r := public.client_feature_access(c_qa,'a_feature_that_does_not_exist');
  if (r->>'allowed')::boolean is not false then raise exception 'QA client must not get a feature with no entitlement row: %', r; end if;

  if has_function_privilege('anon','public.client_feature_access(uuid,text)','execute') then raise exception 'anon must not execute client_feature_access'; end if;
  if not has_function_privilege('service_role','public.client_feature_access(uuid,text)','execute') then raise exception 'service_role must execute client_feature_access'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
