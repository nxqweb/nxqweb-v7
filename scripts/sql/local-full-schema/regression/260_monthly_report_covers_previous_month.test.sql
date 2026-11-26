-- Regression test for migration 260. Rolled back. Runs the scheduler against a fixture plan and proves the monthly report row and the queued
-- task both cover the PREVIOUS month, the schedule advances, a re-run is idempotent, and privileges are unchanged.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gamma@synthetic.invalid','',now(),'{}','{"business_name":"Gamma Tree Care","product_family_slug":"business","product_tier_key":"growth"}');

do $$ declare c uuid; p uuid; mp uuid; prev date; cur date; n int; rpt record; t record; nxt timestamptz; def text; begin
  prev := (date_trunc('month', now()) - interval '1 month')::date;
  cur := date_trunc('month', now())::date;

  select id into c from public.clients where auth_user_id = 'cccccccc-0000-0000-0000-000000000001';
  if c is null then raise exception 'client fixture missing (test would be vacuous)'; end if;
  insert into public.projects(client_id, project_name) values (c, 'Gamma site') returning id into p;
  insert into public.website_maintenance_plans(client_id, project_id, status, monthly_report_enabled, next_monthly_report_at)
    values (c, p, 'active', true, now() - interval '1 hour') returning id into mp;

  -- the function definition itself no longer uses the current month for the report
  select pg_get_functiondef('public.queue_due_website_maintenance()'::regprocedure) into def;
  if def like '%date_trunc(''month'', now())::date, ''draft''%' then raise exception 'scheduler still creates the report for the current month'; end if;
  if def not like '%interval ''1 month'')::date%' then raise exception 'previous-month expression not found in scheduler'; end if;

  perform public.queue_due_website_maintenance();

  select count(*) into n from public.website_monthly_reports where project_id = p;
  if n <> 1 then raise exception 'expected exactly 1 report row, got %', n; end if;
  select * into rpt from public.website_monthly_reports where project_id = p;
  if rpt.report_month <> prev then raise exception 'report_month is %, expected previous month %', rpt.report_month, prev; end if;
  if rpt.report_month = cur then raise exception 'report was created for the current month'; end if;
  if rpt.status <> 'draft' then raise exception 'new report should start as draft, got %', rpt.status; end if;

  select * into t from public.website_maintenance_tasks where maintenance_plan_id = mp and task_type = 'monthly_report';
  if t.id is null then raise exception 'monthly_report task was not queued'; end if;
  if (t.input->>'report_month')::date <> prev then raise exception 'task input.report_month is %, expected %', t.input->>'report_month', prev; end if;

  select next_monthly_report_at into nxt from public.website_maintenance_plans where id = mp;
  if nxt <> date_trunc('month', now()) + interval '1 month' then raise exception 'next_monthly_report_at not advanced to the 1st of next month: %', nxt; end if;

  -- idempotent: a second run creates no second report or task (the schedule has moved on)
  perform public.queue_due_website_maintenance();
  select count(*) into n from public.website_monthly_reports where project_id = p;
  if n <> 1 then raise exception 'second run created another report row (%)', n; end if;
  select count(*) into n from public.website_maintenance_tasks where maintenance_plan_id = mp and task_type = 'monthly_report';
  if n <> 1 then raise exception 'second run queued another monthly_report task (%)', n; end if;

  -- an existing row for that month is respected (on conflict do nothing), not duplicated or overwritten
  update public.website_maintenance_plans set next_monthly_report_at = now() - interval '1 minute' where id = mp;
  update public.website_monthly_reports set status = 'ready' where id = rpt.id;
  perform public.queue_due_website_maintenance();
  select count(*) into n from public.website_monthly_reports where project_id = p and report_month = prev;
  if n <> 1 then raise exception 'conflict path duplicated the report (%)', n; end if;
  if (select status from public.website_monthly_reports where id = rpt.id) <> 'ready' then raise exception 'conflict path overwrote an existing report'; end if;

  -- privileges and security attributes are unchanged
  if has_function_privilege('anon', 'public.queue_due_website_maintenance()', 'execute') or has_function_privilege('authenticated', 'public.queue_due_website_maintenance()', 'execute') then
    raise exception 'scheduler must stay service-role only';
  end if;
  if not has_function_privilege('service_role', 'public.queue_due_website_maintenance()', 'execute') then raise exception 'service_role lost execute'; end if;
  if not (select prosecdef from pg_proc where oid = 'public.queue_due_website_maintenance()'::regprocedure) then raise exception 'scheduler is no longer security definer'; end if;
  if not exists (select 1 from pg_proc where oid = 'public.queue_due_website_maintenance()'::regprocedure and proconfig @> array['search_path=public']) then raise exception 'scheduler lost its pinned search_path'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
