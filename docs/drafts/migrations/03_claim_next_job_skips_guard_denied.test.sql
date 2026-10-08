-- Sidecar test for draft 03. Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  fam uuid; tier uuid;
  u_deny uuid := gen_random_uuid(); u_ok uuid := gen_random_uuid();
  c_deny uuid := gen_random_uuid(); c_ok uuid := gen_random_uuid();
  j_deny uuid := gen_random_uuid(); j_ok uuid := gen_random_uuid();
  r jsonb; denied_row public.automation_jobs%rowtype;
begin
  select pf.id into fam from public.product_families pf where pf.slug='business' and pf.is_active=true;
  select pft.id into tier from public.product_family_tiers pft where pft.product_family_id=fam and pft.tier_key='growth' and pft.is_active=true;
  if fam is null or tier is null then raise exception 'business/growth catalog entry missing (test would be vacuous)'; end if;

  -- Any other queued external job already in the database would make the assertions ambiguous: park them for this rolled-back transaction.
  update public.automation_jobs set run_after = now() + interval '1 year' where status in ('queued','failed');

  -- QA-only clients are paid for from the platform budget, which ships locked (enabled=false, emergency_stop=true). Unlock it inside this
  -- rolled-back transaction so the QA-only job behind the denied one can really be authorized.
  update public.nxq_platform_cost_settings set enabled=true, emergency_stop=false, monthly_limit_cents=500, updated_at=now() where singleton;

  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated','claim-skip-'||u::text||'@synthetic.invalid','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
  from unnest(array[u_deny,u_ok]) u;

  insert into public.clients (id,auth_user_id,business_name,contact_email,business_type,status,monthly_price,billing_status,billing_provider,product_family_id,product_tier_id,qa_only) values
    (c_deny,u_deny,'Claim Skip Denied (real, no billing)','claim-skip-'||u_deny::text||'@synthetic.invalid','Synthetic','approved',100,'not_configured',null,fam,tier,false),
    (c_ok,u_ok,'Claim Skip OK (QA only)','claim-skip-'||u_ok::text||'@synthetic.invalid','Synthetic','approved',0,'not_configured',null,fam,tier,true);

  -- The denied client's job is FIRST in line (older); the QA-only client's job is behind it.
  insert into public.automation_jobs (id,client_id,job_type,priority,run_after,created_at,idempotency_key,execution_target)
  values (j_deny,c_deny,'prepare_build_plan',30,now()-interval '2 hours',now()-interval '2 hours','claim-skip-deny-'||j_deny::text,'ai'),
         (j_ok,c_ok,'prepare_build_plan',30,now()-interval '1 hour',now()-interval '1 hour','claim-skip-ok-'||j_ok::text,'ai');

  r := public.claim_next_external_automation_job_v2('ai','claim-skip-test',array['prepare_build_plan']);
  if r is null then raise exception 'claim returned nothing: the denied job at the front still blocks the queue'; end if;
  if (r->>'id')::uuid <> j_ok then raise exception 'claim should have returned the allowed job behind the denied one, got %', r->>'id'; end if;
  if r->>'status' <> 'running' then raise exception 'claimed job must be running: %', r->>'status'; end if;

  select * into denied_row from public.automation_jobs where id=j_deny;
  if denied_row.status <> 'queued' then raise exception 'denied job must stay queued, got %', denied_row.status; end if;
  if denied_row.attempts <> 0 then raise exception 'denied job must not consume an attempt, got %', denied_row.attempts; end if;
  if denied_row.last_error is null or denied_row.last_error not like 'Skipped by billing guard:%' then raise exception 'denied job must record why it was skipped: %', denied_row.last_error; end if;
  if denied_row.run_after <= now() + interval '10 minutes' then raise exception 'denied job must be pushed back so it stops being the front job: %', denied_row.run_after; end if;

  -- Second claim: nothing else is eligible (the denied job is parked), so the queue is simply empty. It must not error.
  r := public.claim_next_external_automation_job_v2('ai','claim-skip-test',array['prepare_build_plan']);
  if r is not null then raise exception 'second claim should find nothing, got %', r; end if;

  if has_function_privilege('anon','public.claim_next_external_automation_job_v2(text,text,text[])','execute') then raise exception 'anon must not execute the claim function'; end if;
  if not has_function_privilege('service_role','public.claim_next_external_automation_job_v2(text,text,text[])','execute') then raise exception 'service_role must execute the claim function'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
