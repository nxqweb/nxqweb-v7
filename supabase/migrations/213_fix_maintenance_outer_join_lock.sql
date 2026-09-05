-- Fix maintenance claim locking against nullable LEFT JOIN relations.
-- PostgreSQL does not allow a bare FOR UPDATE to lock the nullable side of an outer join.
-- Lock only the maintenance task row; joined plan/control rows are eligibility reads only.

create or replace function public.claim_next_website_maintenance_task(worker_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.website_maintenance_tasks%rowtype;
begin
  if nullif(btrim(worker_name), '') is null then
    raise exception 'Worker name is required.';
  end if;

  select t.* into task_row
  from public.website_maintenance_tasks t
  join public.website_maintenance_plans p on p.id = t.maintenance_plan_id
  left join public.client_automation_controls controls on controls.client_id = t.client_id
  where t.status in ('queued','failed')
    and t.scheduled_for <= now()
    and t.attempts < t.max_attempts
    and t.provider_connected = true
    and t.task_type in (
      'uptime_check','ssl_check','form_test','broken_link_scan',
      'security_scan','seo_check','backup_check','monthly_report'
    )
    and p.status = 'active'
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false)
  order by t.priority asc, t.scheduled_for asc, t.created_at asc
  for update of t skip locked
  limit 1;

  if not found then return null; end if;

  update public.website_maintenance_tasks
  set status = 'running',
      started_at = now(),
      attempts = attempts + 1,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'worker_name', worker_name,
        'claimed_at', now()
      ),
      last_error = null,
      updated_at = now()
  where id = task_row.id
  returning * into task_row;

  insert into public.automation_audit_log (client_id, project_id, event_type, details)
  values (
    task_row.client_id,
    task_row.project_id,
    'website_maintenance_task_claimed',
    jsonb_build_object(
      'task_id', task_row.id,
      'task_type', task_row.task_type,
      'worker_name', worker_name,
      'attempt', task_row.attempts
    )
  );

  return to_jsonb(task_row);
end;
$$;

revoke all on function public.claim_next_website_maintenance_task(text) from public, anon, authenticated;
grant execute on function public.claim_next_website_maintenance_task(text) to service_role;

comment on function public.claim_next_website_maintenance_task(text) is
  'Claims one eligible maintenance task while locking only website_maintenance_tasks. Joined plan/control rows remain read-only eligibility inputs so nullable outer joins cannot cause FOR UPDATE failures.';
