-- Sidecar test for 05 (QA maintenance off the shared cost pool). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  fam uuid; tier uuid;
  u_qa uuid := gen_random_uuid(); u_stopped uuid := gen_random_uuid(); u_real uuid := gen_random_uuid();
  c_qa uuid := gen_random_uuid(); c_stopped uuid := gen_random_uuid(); c_real uuid := gen_random_uuid();
  p_qa uuid; p_stopped uuid; p_real uuid; plan_qa uuid; plan_stopped uuid; plan_real uuid;
  t_qa uuid := gen_random_uuid(); t_qa2 uuid := gen_random_uuid(); t_qa3 uuid := gen_random_uuid(); t_stopped uuid := gen_random_uuid(); t_real uuid := gen_random_uuid();
  before_cents integer; after_cents integer; err text; direct_err text; trigger_err text;
begin
  select pf.id into fam from public.product_families pf where pf.slug='business' and pf.is_active=true;
  select pft.id into tier from public.product_family_tiers pft where pft.product_family_id=fam and pft.tier_key='growth' and pft.is_active=true;
  if fam is null or tier is null then raise exception 'business/growth catalog entry missing (test would be vacuous)'; end if;
  if not exists(select 1 from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='growth' and feature_key='technical_maintenance' and enabled) then
    raise exception 'business/growth technical_maintenance entitlement missing (test would be vacuous)';
  end if;

  -- The shared pool is on, and OVER its cap for this month (worse than the exact situation of 2026-11-01, so even a 0-cent reservation would be refused if it were checked).
  update public.nxq_platform_cost_settings set enabled=true, emergency_stop=false, monthly_limit_cents=500, updated_at=now() where singleton;
  insert into public.nxq_platform_cost_reservations(operation_key, idempotency_key, estimated_cost_cents, status)
    values ('test:fill-the-pool', 'test-fill-' || gen_random_uuid()::text, 600, 'consumed');

  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated','qa-maint-'||u::text||'@synthetic.invalid','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
  from unnest(array[u_qa,u_stopped,u_real]) u;
  insert into public.clients (id,auth_user_id,business_name,contact_email,business_type,status,monthly_price,billing_status,billing_provider,product_family_id,product_tier_id,qa_only) values
    (c_qa,u_qa,'QA Maint One','qa-maint-'||u_qa::text||'@synthetic.invalid','Synthetic','approved',0,'not_configured',null,fam,tier,true),
    (c_stopped,u_stopped,'QA Maint Stopped','qa-maint-'||u_stopped::text||'@synthetic.invalid','Synthetic','approved',0,'not_configured',null,fam,tier,true),
    (c_real,u_real,'Real Maint Active','qa-maint-'||u_real::text||'@synthetic.invalid','Synthetic','approved',100,'active','synthetic',fam,tier,false);
  update public.clients set pipeline_stopped_at=now() where id=c_stopped;

  insert into public.projects(client_id, project_name) values (c_qa, 'QA maint site') returning id into p_qa;
  insert into public.projects(client_id, project_name) values (c_stopped, 'QA stopped site') returning id into p_stopped;
  insert into public.projects(client_id, project_name) values (c_real, 'Real maint site') returning id into p_real;
  insert into public.website_maintenance_plans(client_id, project_id) values (c_qa, p_qa) returning id into plan_qa;
  insert into public.website_maintenance_plans(client_id, project_id) values (c_stopped, p_stopped) returning id into plan_stopped;
  insert into public.website_maintenance_plans(client_id, project_id) values (c_real, p_real) returning id into plan_real;
  insert into public.website_maintenance_tasks(id, maintenance_plan_id, client_id, project_id, task_type, idempotency_key) values
    (t_qa, plan_qa, c_qa, p_qa, 'uptime_check', 'qa-maint-t1-' || t_qa::text),
    (t_qa2, plan_qa, c_qa, p_qa, 'ssl_check', 'qa-maint-t2-' || t_qa2::text),
    (t_qa3, plan_qa, c_qa, p_qa, 'seo_check', 'qa-maint-t5-' || t_qa3::text),
    (t_stopped, plan_stopped, c_stopped, p_stopped, 'uptime_check', 'qa-maint-t3-' || t_stopped::text),
    (t_real, plan_real, c_real, p_real, 'uptime_check', 'qa-maint-t4-' || t_real::text);

  -- CONTROL: with the pool full, the OLD behavior (a 1-cent reservation for a QA client) is refused. This is why the first QA run stalled.
  begin
    perform public.nxq_authorize_paid_capability(c_qa, 'technical_maintenance', '{"automation_jobs":1}'::jsonb, 1, 'control-' || gen_random_uuid()::text, '{}'::jsonb);
    err := null;
  exception when others then err := sqlerrm; end;
  if err is null or err !~ 'PLATFORM_COST_BLOCKER' then raise exception 'control failed: a 1-cent QA reservation should be refused when the pool is full (got: %)', err; end if;

  -- THE FIX: a QA client's maintenance task starts running with the pool full, and adds nothing to the pool.
  select coalesce(sum(coalesce(actual_cost_cents,estimated_cost_cents)),0)::integer into before_cents from public.nxq_platform_cost_reservations
    where status<>'released' and occurred_at>=date_trunc('month',now());
  update public.website_maintenance_tasks set status='running' where id=t_qa;
  update public.website_maintenance_tasks set status='running' where id=t_qa2;
  select coalesce(sum(coalesce(actual_cost_cents,estimated_cost_cents)),0)::integer into after_cents from public.nxq_platform_cost_reservations
    where status<>'released' and occurred_at>=date_trunc('month',now());
  if (select count(*) from public.website_maintenance_tasks where id in (t_qa,t_qa2) and status='running') <> 2 then raise exception 'QA maintenance tasks must be allowed to start running with the pool full'; end if;
  if after_cents <> before_cents then raise exception 'QA maintenance must add 0 cents to the pool (before %, after %)', before_cents, after_cents; end if;
  if before_cents <> 600 then raise exception 'sanity: the pool should still read exactly the 600 test cents, got %', before_cents; end if;

  -- With ROOM in the pool, QA maintenance still adds nothing: the estimate is 0 cents, not 1 (the full-pool case above would hide a 1-cent reservation, because it is refused and excused).
  update public.nxq_platform_cost_settings set monthly_limit_cents=5000, updated_at=now() where singleton;
  select coalesce(sum(coalesce(actual_cost_cents,estimated_cost_cents)),0)::integer into before_cents from public.nxq_platform_cost_reservations
    where status<>'released' and occurred_at>=date_trunc('month',now());
  update public.website_maintenance_tasks set status='running' where id=t_qa3;
  select coalesce(sum(coalesce(actual_cost_cents,estimated_cost_cents)),0)::integer into after_cents from public.nxq_platform_cost_reservations
    where status<>'released' and occurred_at>=date_trunc('month',now());
  if (select status from public.website_maintenance_tasks where id=t_qa3) <> 'running' then raise exception 'QA maintenance must start running when the pool has room'; end if;
  if after_cents <> before_cents then raise exception 'with room in the pool, QA maintenance must still add 0 cents (before %, after %)', before_cents, after_cents; end if;
  update public.nxq_platform_cost_settings set monthly_limit_cents=500, updated_at=now() where singleton;

  -- Every other check still applies to QA clients: a stopped QA client is still refused, and the refusal is the lifecycle one, not the pool one.
  begin
    update public.website_maintenance_tasks set status='running' where id=t_stopped;
    err := null;
  exception when others then err := sqlerrm; end;
  if err is null or err !~ 'denied by client lifecycle' then raise exception 'a stopped QA client must still be refused by the lifecycle check (got: %)', err; end if;

  -- Real clients are unchanged: starting their task gives the same outcome as calling the guard directly with the same 1-cent estimate as before.
  begin
    perform public.nxq_authorize_paid_capability(c_real, 'technical_maintenance', jsonb_build_object('automation_jobs',1,'bandwidth_bytes',2097152), 1, 'direct-' || gen_random_uuid()::text, '{}'::jsonb);
    direct_err := null;
  exception when others then direct_err := sqlerrm; end;
  begin
    update public.website_maintenance_tasks set status='running' where id=t_real;
    trigger_err := null;
  exception when others then trigger_err := sqlerrm; end;
  if coalesce(direct_err,'ok') <> coalesce(trigger_err,'ok') then raise exception 'real-client outcome changed: direct=% trigger=%', direct_err, trigger_err; end if;
  -- ...and a real client never draws from the shared pool for maintenance.
  select coalesce(sum(coalesce(actual_cost_cents,estimated_cost_cents)),0)::integer into after_cents from public.nxq_platform_cost_reservations
    where status<>'released' and occurred_at>=date_trunc('month',now());
  if after_cents <> 600 then raise exception 'a real client must not touch the shared pool (now %)', after_cents; end if;

  -- privileges: the trigger function is still not callable by the API roles
  if has_function_privilege('anon','public.nxq_guard_maintenance_transition()','execute') or has_function_privilege('authenticated','public.nxq_guard_maintenance_transition()','execute') then raise exception 'the trigger function must not be callable by API roles'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
