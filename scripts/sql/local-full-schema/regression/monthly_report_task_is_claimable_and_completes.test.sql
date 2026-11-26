-- Executable proof of the database half of the monthly report pipeline (migrations 126, 143 and 260). Rolled back.
-- The scheduler's monthly_report task must be QUEUED and claimable (never stuck 'blocked'), the internal maintenance worker must be able to
-- claim it, save the report as ready, and complete it; a paused plan must not be worked. (The Edge function's own summarising code is not run here.)
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','delta@synthetic.invalid','',now(),'{}','{"business_name":"Delta Tree Care","product_family_slug":"business","product_tier_key":"growth"}'),
 ('dddddddd-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','echo@synthetic.invalid','',now(),'{}','{"business_name":"Echo Tree Care","product_family_slug":"business","product_tier_key":"growth"}');

do $$ declare c uuid; p uuid; mp uuid; c2 uuid; p2 uuid; mp2 uuid; prev date; t record; claimed jsonb; done jsonb; n int; rpt record; begin
  prev := (date_trunc('month', now()) - interval '1 month')::date;
  select id into c from public.clients where auth_user_id = 'dddddddd-0000-0000-0000-000000000001';
  select id into c2 from public.clients where auth_user_id = 'dddddddd-0000-0000-0000-000000000002';
  if c is null or c2 is null then raise exception 'client fixtures missing (test would be vacuous)'; end if;
  -- the paid-capability guard (migration 246) only lets approved clients with active billing be worked, exactly like production
  update public.clients set status = 'approved', billing_status = 'active', billing_provider = 'manual' where id in (c, c2);
  insert into public.projects(client_id, project_name) values (c, 'Delta site') returning id into p;
  insert into public.projects(client_id, project_name) values (c2, 'Echo site') returning id into p2;
  insert into public.website_maintenance_plans(client_id, project_id, status, monthly_report_enabled, next_monthly_report_at)
    values (c, p, 'active', true, now() - interval '1 hour') returning id into mp;
  insert into public.website_maintenance_plans(client_id, project_id, status, monthly_report_enabled, next_monthly_report_at)
    values (c2, p2, 'active', true, now() - interval '1 hour') returning id into mp2;

  perform public.queue_due_website_maintenance();

  -- the task is queued and connected, not blocked
  select * into t from public.website_maintenance_tasks where maintenance_plan_id = mp and task_type = 'monthly_report';
  if t.id is null then raise exception 'monthly_report task was not queued'; end if;
  if t.status <> 'queued' then raise exception 'monthly_report task should be queued, got % (stuck-blocked bug)', t.status; end if;
  if t.provider_connected is not true then raise exception 'monthly_report task is not marked connected'; end if;
  if t.last_error is not null then raise exception 'monthly_report task carries a stale blocking message: %', t.last_error; end if;

  -- a paused plan is not worked: pause Echo's plan and confirm only Delta's task can be claimed
  update public.website_maintenance_plans set status = 'paused' where id = mp2;
  -- other task types queued by the scheduler for Delta would also be claimable, so claim until Delta's monthly_report appears
  loop
    claimed := public.claim_next_website_maintenance_task('qa-monthly-worker');
    if claimed is null then raise exception 'worker could not claim the monthly_report task (queue empty before it appeared)'; end if;
    if (claimed->>'client_id')::uuid = c2 then raise exception 'worker claimed a task of a PAUSED plan'; end if;
    exit when claimed->>'task_type' = 'monthly_report';
    perform public.complete_website_maintenance_task((claimed->>'id')::uuid, 'qa-monthly-worker', '{}'::jsonb);
  end loop;
  if (claimed->>'id')::uuid <> t.id then raise exception 'claimed a different monthly_report task'; end if;
  if claimed->>'status' <> 'running' then raise exception 'claimed task should be running, got %', claimed->>'status'; end if;
  if (claimed->'input'->>'report_month')::date <> prev then raise exception 'claimed task is not for the previous month'; end if;

  -- another worker cannot finish a task it does not own
  begin
    perform public.complete_website_maintenance_task(t.id, 'someone-else', '{}'::jsonb);
    raise exception 'NO_ERROR';
  exception when others then
    if sqlerrm = 'NO_ERROR' or sqlerrm not like 'Worker does not own this maintenance task.%' then raise exception 'foreign worker completed the task: %', sqlerrm; end if;
  end;

  -- the worker saves the report exactly as run-website-maintenance does (same table, same filter), then completes the task
  update public.website_monthly_reports
    set status = 'ready', health_summary = '{"total_checks":3,"completed_checks":3,"unresolved_checks":0,"generated_from_real_checks":true}'::jsonb,
        recommendations = '["No unresolved maintenance exceptions were recorded for this reporting period."]'::jsonb,
        generated_at = now(), updated_at = now()
    where project_id = p and report_month = prev;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'report row to update not found (updated % rows)', n; end if;

  done := public.complete_website_maintenance_task(t.id, 'qa-monthly-worker', jsonb_build_object('report_month', prev, 'healthy', true));
  if done->>'status' <> 'completed' then raise exception 'task did not complete, got %', done->>'status'; end if;
  select * into rpt from public.website_monthly_reports where project_id = p and report_month = prev;
  if rpt.status <> 'ready' or rpt.generated_at is null then raise exception 'report is not ready after the worker saved it'; end if;
  if not exists (select 1 from public.website_maintenance_plans where id = mp and last_maintenance_at is not null) then raise exception 'plan last_maintenance_at was not set'; end if;

  -- Echo (paused plan) stays untouched: still draft, task still queued, never claimed
  if (select status from public.website_monthly_reports where project_id = p2 and report_month = prev) <> 'draft' then raise exception 'paused plan report changed'; end if;
  if (select status from public.website_maintenance_tasks where maintenance_plan_id = mp2 and task_type = 'monthly_report') <> 'queued' then raise exception 'paused plan task changed'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
