-- DRAFT 06 (not applied; migrations are a hard stop-and-ask gate). Replaces ONE function; no table changes.
-- Purpose: a monthly report was created on the 1st for the CURRENT month and summarised that same month's tasks (which
-- had barely started), so a generated report would be almost empty. Now the report created on the 1st is for the PREVIOUS
-- month, which is complete. report_month therefore means "the month this report covers" (the worker, run-website-maintenance
-- monthlyReport, already summarises tasks created inside task.input.report_month, so it needs no change).
--
-- This is the exact live definition of public.queue_due_website_maintenance() (migration 102, never amended since) with only
-- the two month expressions changed: the report row's report_month and the queued task's input.report_month.
--   before: date_trunc('month', now())::date
--   after:  (date_trunc('month', now()) - interval '1 month')::date
-- Not changed here (separate decisions): the queued 'monthly_report' task still starts 'blocked' until a reporting worker is
-- connected; and the combined client_monthly_business_reports table still has no writer.
-- Existing rows already created for the current month are left alone.

create or replace function public.queue_due_website_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  plan_row public.website_maintenance_plans%rowtype;
  queued_count integer := 0;
  blocked_count integer := 0;
  due_key text;
  task_id uuid;
begin
  for plan_row in
    select mp.*
    from public.website_maintenance_plans mp
    left join public.client_automation_controls controls on controls.client_id = mp.client_id
    where mp.status = 'active'
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
  loop
    if plan_row.uptime_enabled and plan_row.next_uptime_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':uptime:' || to_char(plan_row.next_uptime_check_at, 'YYYYMMDDHH24MI');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'uptime_check', 'blocked',
        true, false, 10, plan_row.next_uptime_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for uptime-monitor provider connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_uptime_check_at = now() + make_interval(mins => uptime_interval_minutes)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.ssl_enabled and plan_row.next_ssl_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':ssl:' || to_char(plan_row.next_ssl_check_at, 'YYYYMMDDHH24');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'ssl_check', 'blocked',
        true, false, 20, plan_row.next_ssl_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for SSL-monitor provider connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_ssl_check_at = now() + make_interval(hours => ssl_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.form_test_enabled and plan_row.next_form_test_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':form:' || to_char(plan_row.next_form_test_at, 'YYYYMMDDHH24');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'form_test', 'blocked',
        true, false, 30, plan_row.next_form_test_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url, 'submit_real_form', false),
        'Waiting for form-test worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_form_test_at = now() + make_interval(hours => form_test_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.broken_link_enabled and plan_row.next_broken_link_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':links:' || to_char(plan_row.next_broken_link_check_at, 'IYYYIW');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'broken_link_scan', 'blocked',
        true, false, 40, plan_row.next_broken_link_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for broken-link worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_broken_link_check_at = now() + make_interval(hours => broken_link_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.security_scan_enabled and plan_row.next_security_scan_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':security:' || to_char(plan_row.next_security_scan_at, 'YYYYMMDDHH24');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'security_scan', 'blocked',
        true, false, 15, plan_row.next_security_scan_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url, 'non_destructive', true),
        'Waiting for security-scan provider connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_security_scan_at = now() + make_interval(hours => security_scan_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.seo_check_enabled and plan_row.next_seo_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':seo:' || to_char(plan_row.next_seo_check_at, 'YYYYMM');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'seo_check', 'blocked',
        true, false, 60, plan_row.next_seo_check_at,
        due_key, jsonb_build_object('url', plan_row.monitored_url),
        'Waiting for SEO-check worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_seo_check_at = now() + make_interval(hours => seo_check_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.backup_check_enabled and plan_row.next_backup_check_at <= now() then
      due_key := 'maintenance:' || plan_row.id::text || ':backup:' || to_char(plan_row.next_backup_check_at, 'YYYYMMDD');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'backup_check', 'blocked',
        true, false, 35, plan_row.next_backup_check_at,
        due_key, jsonb_build_object('project_id', plan_row.project_id),
        'Waiting for backup-verification worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_backup_check_at = now() + make_interval(hours => backup_check_interval_hours)
      where id = plan_row.id;
      task_id := null;
    end if;

    if plan_row.monthly_report_enabled and plan_row.next_monthly_report_at <= now() then
      insert into public.website_monthly_reports (
        maintenance_plan_id, client_id, project_id, report_month, status
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id,
        (date_trunc('month', now()) - interval '1 month')::date, 'draft'
      ) on conflict (project_id, report_month) do nothing;

      due_key := 'maintenance:' || plan_row.id::text || ':monthly-report:' || to_char(now(), 'YYYYMM');
      insert into public.website_maintenance_tasks (
        maintenance_plan_id, client_id, project_id, task_type, status,
        requires_external_worker, provider_connected, priority, scheduled_for,
        idempotency_key, input, last_error
      ) values (
        plan_row.id, plan_row.client_id, plan_row.project_id, 'monthly_report', 'blocked',
        true, false, 80, plan_row.next_monthly_report_at,
        due_key, jsonb_build_object('report_month', (date_trunc('month', now()) - interval '1 month')::date),
        'Waiting for reporting/AI-summary worker connection.'
      ) on conflict (idempotency_key) do nothing returning id into task_id;
      if task_id is not null then blocked_count := blocked_count + 1; end if;
      update public.website_maintenance_plans
      set next_monthly_report_at = date_trunc('month', now()) + interval '1 month'
      where id = plan_row.id;
      task_id := null;
    end if;
  end loop;

  queued_count := 0;
  return jsonb_build_object(
    'ok', true,
    'queued', queued_count,
    'blocked_waiting_for_providers', blocked_count,
    'ran_at', now()
  );
end;
$function$;


revoke all on function public.queue_due_website_maintenance() from public, anon, authenticated;
grant execute on function public.queue_due_website_maintenance() to service_role;
