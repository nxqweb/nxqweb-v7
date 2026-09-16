-- Internal website maintenance execution layer.
-- Converts maintenance checks NXQ can safely perform itself from blocked placeholders
-- into a real, retryable worker queue. Does not perform destructive site changes.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.website_maintenance_alerts (
  id uuid primary key default gen_random_uuid(),
  maintenance_task_id uuid references public.website_maintenance_tasks(id) on delete set null,
  maintenance_plan_id uuid references public.website_maintenance_plans(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  severity text not null default 'warning' check (severity in ('info','warning','high','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  alert_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  unique(maintenance_task_id, alert_type)
);

alter table public.website_maintenance_alerts enable row level security;
revoke all on table public.website_maintenance_alerts from public, anon;
grant select, insert, update, delete on public.website_maintenance_alerts to authenticated;
grant select, insert, update, delete on public.website_maintenance_alerts to service_role;

create policy owner_manage_website_maintenance_alerts
on public.website_maintenance_alerts for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

-- These check types are intentionally non-destructive and can run using NXQ's own worker.
create or replace function public.activate_internal_maintenance_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_type in (
    'uptime_check','ssl_check','form_test','broken_link_scan',
    'security_scan','seo_check','backup_check','monthly_report'
  ) then
    new.status := 'queued';
    new.provider_connected := true;
    new.requires_external_worker := true;
    new.last_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists activate_internal_maintenance_task on public.website_maintenance_tasks;
create trigger activate_internal_maintenance_task
before insert on public.website_maintenance_tasks
for each row execute function public.activate_internal_maintenance_task();

-- Unblock already-created placeholders for checks the internal worker supports.
update public.website_maintenance_tasks
set status = 'queued',
    provider_connected = true,
    last_error = null,
    scheduled_for = least(scheduled_for, now()),
    updated_at = now()
where status = 'blocked'
  and task_type in (
    'uptime_check','ssl_check','form_test','broken_link_scan',
    'security_scan','seo_check','backup_check','monthly_report'
  );

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
  for update skip locked
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
    jsonb_build_object('task_id', task_row.id, 'task_type', task_row.task_type, 'worker_name', worker_name, 'attempt', task_row.attempts)
  );

  return to_jsonb(task_row);
end;
$$;

create or replace function public.complete_website_maintenance_task(
  target_task_id uuid,
  worker_name text,
  target_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.website_maintenance_tasks%rowtype;
begin
  select * into task_row
  from public.website_maintenance_tasks
  where id = target_task_id
  for update;

  if not found then raise exception 'Maintenance task not found.'; end if;
  if task_row.status <> 'running' then raise exception 'Maintenance task is not running.'; end if;
  if coalesce(task_row.result->>'worker_name', '') <> worker_name then
    raise exception 'Worker does not own this maintenance task.';
  end if;

  update public.website_maintenance_tasks
  set status = 'completed',
      result = coalesce(task_row.result, '{}'::jsonb) || coalesce(target_result, '{}'::jsonb),
      completed_at = now(),
      last_error = null,
      updated_at = now()
  where id = target_task_id
  returning * into task_row;

  update public.website_maintenance_plans
  set last_maintenance_at = now(),
      latest_error = null,
      updated_at = now()
  where id = task_row.maintenance_plan_id;

  update public.website_maintenance_alerts
  set status = 'resolved', resolved_at = now()
  where maintenance_task_id = task_row.id and status in ('open','acknowledged');

  insert into public.automation_audit_log (client_id, project_id, event_type, details)
  values (
    task_row.client_id,
    task_row.project_id,
    'website_maintenance_task_completed',
    jsonb_build_object('task_id', task_row.id, 'task_type', task_row.task_type, 'worker_name', worker_name)
  );

  return to_jsonb(task_row);
end;
$$;

create or replace function public.fail_website_maintenance_task(
  target_task_id uuid,
  worker_name text,
  target_error text,
  target_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.website_maintenance_tasks%rowtype;
  exhausted boolean;
  delay_minutes integer;
begin
  select * into task_row
  from public.website_maintenance_tasks
  where id = target_task_id
  for update;

  if not found then raise exception 'Maintenance task not found.'; end if;
  if task_row.status <> 'running' then raise exception 'Maintenance task is not running.'; end if;
  if coalesce(task_row.result->>'worker_name', '') <> worker_name then
    raise exception 'Worker does not own this maintenance task.';
  end if;

  exhausted := task_row.attempts >= task_row.max_attempts;
  delay_minutes := least(60, greatest(2, (power(2, least(task_row.attempts, 5))::integer)));

  update public.website_maintenance_tasks
  set status = case when exhausted then 'blocked' else 'failed' end,
      scheduled_for = case when exhausted then scheduled_for else now() + make_interval(mins => delay_minutes) end,
      last_error = left(coalesce(target_error, 'Unknown maintenance failure'), 2000),
      result = coalesce(task_row.result, '{}'::jsonb) || coalesce(target_details, '{}'::jsonb) || jsonb_build_object(
        'failed_at', now(),
        'retry_exhausted', exhausted,
        'next_retry_minutes', case when exhausted then null else delay_minutes end
      ),
      updated_at = now()
  where id = target_task_id
  returning * into task_row;

  update public.website_maintenance_plans
  set latest_error = task_row.last_error,
      status = case when exhausted then 'error' else status end,
      updated_at = now()
  where id = task_row.maintenance_plan_id;

  if exhausted then
    insert into public.website_maintenance_alerts (
      maintenance_task_id, maintenance_plan_id, client_id, project_id,
      severity, alert_type, summary, details
    ) values (
      task_row.id, task_row.maintenance_plan_id, task_row.client_id, task_row.project_id,
      case when task_row.task_type in ('uptime_check','ssl_check') then 'high' else 'warning' end,
      'maintenance_retry_exhausted',
      'NXQ could not complete ' || task_row.task_type || ' after automatic retries.',
      jsonb_build_object('last_error', task_row.last_error, 'attempts', task_row.attempts, 'task_type', task_row.task_type)
    ) on conflict (maintenance_task_id, alert_type) do update
      set status = 'open',
          severity = excluded.severity,
          summary = excluded.summary,
          details = excluded.details,
          created_at = now(),
          acknowledged_at = null,
          resolved_at = null;
  end if;

  insert into public.automation_audit_log (client_id, project_id, event_type, details)
  values (
    task_row.client_id,
    task_row.project_id,
    case when exhausted then 'website_maintenance_task_escalated' else 'website_maintenance_task_retry_scheduled' end,
    jsonb_build_object(
      'task_id', task_row.id,
      'task_type', task_row.task_type,
      'worker_name', worker_name,
      'attempts', task_row.attempts,
      'max_attempts', task_row.max_attempts,
      'error', task_row.last_error
    )
  );

  return to_jsonb(task_row);
end;
$$;

revoke all on function public.claim_next_website_maintenance_task(text) from public, anon, authenticated;
revoke all on function public.complete_website_maintenance_task(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_website_maintenance_task(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_website_maintenance_task(text) to service_role;
grant execute on function public.complete_website_maintenance_task(uuid, text, jsonb) to service_role;
grant execute on function public.fail_website_maintenance_task(uuid, text, text, jsonb) to service_role;

create or replace function public.dispatch_internal_website_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  worker_url text;
  worker_token text;
  due_count integer := 0;
  sent integer := 0;
  request_id bigint;
begin
  select count(*) into due_count
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
    and not coalesce(controls.automation_paused, false);

  if due_count = 0 then
    return jsonb_build_object('ok', true, 'due_tasks', 0, 'dispatched', 0);
  end if;

  select decrypted_secret into worker_url
  from vault.decrypted_secrets
  where name = 'nxq_maintenance_edge_url'
  order by created_at desc limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc limit 1;

  if nullif(btrim(worker_url), '') is null or nullif(btrim(worker_token), '') is null then
    return jsonb_build_object('ok', false, 'configured', false, 'reason', 'maintenance_worker_vault_config_missing', 'due_tasks', due_count);
  end if;

  for sent in 1..least(due_count, 10) loop
    select net.http_post(
      url := worker_url,
      headers := jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',worker_token),
      body := jsonb_build_object('source','nxq_maintenance_cron','requested_at',now())
    ) into request_id;

    insert into public.automation_audit_log (event_type, actor_type, details)
    values ('website_maintenance_dispatch_requested','backend',jsonb_build_object('request_id',request_id,'due_tasks',due_count));
  end loop;

  return jsonb_build_object('ok', true, 'configured', true, 'due_tasks', due_count, 'dispatched', least(due_count, 10), 'ran_at', now());
end;
$$;

revoke all on function public.dispatch_internal_website_maintenance() from public, anon, authenticated;
grant execute on function public.dispatch_internal_website_maintenance() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-internal-maintenance-dispatch-every-minute') then
    perform cron.unschedule('nxq-internal-maintenance-dispatch-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'nxq-internal-maintenance-dispatch-every-minute',
  '* * * * *',
  $$select public.dispatch_internal_website_maintenance();$$
);

comment on function public.dispatch_internal_website_maintenance() is
  'Automatically wakes the internal non-destructive website maintenance worker for due checks. Exhausted retries become owner exceptions.';
