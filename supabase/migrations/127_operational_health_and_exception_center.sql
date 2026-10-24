-- Operational read models for the autonomous NXQ owner/client experience.
-- Read-only RPCs only: no provider calls, no production publishing, no job mutation.

create or replace function public.owner_exception_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  healthy_clients integer := 0;
  retrying_jobs integer := 0;
  owner_attention integer := 0;
  open_maintenance_alerts integer := 0;
  exception_items jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  select count(*) into retrying_jobs
  from public.automation_jobs j
  where j.status in ('queued','failed')
    and j.attempts > 0
    and j.attempts < j.max_attempts;

  select count(*) into open_maintenance_alerts
  from public.website_maintenance_alerts a
  where a.status in ('open','acknowledged');

  select count(*) into owner_attention
  from (
    select j.id
    from public.automation_jobs j
    where (j.status = 'failed' and j.attempts >= j.max_attempts)
       or j.status = 'blocked'
    union all
    select a.id
    from public.website_maintenance_alerts a
    where a.status in ('open','acknowledged')
      and a.severity in ('high','critical')
  ) attention;

  select count(*) into healthy_clients
  from public.clients c
  where c.status::text in ('approved','active')
    and not exists (
      select 1 from public.website_maintenance_alerts a
      where a.client_id = c.id and a.status in ('open','acknowledged')
    )
    and not exists (
      select 1 from public.automation_jobs j
      where j.client_id = c.id
        and ((j.status = 'failed' and j.attempts >= j.max_attempts) or j.status = 'blocked')
    );

  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
  into exception_items
  from (
    select
      a.created_at as sort_at,
      jsonb_build_object(
        'source', 'maintenance',
        'id', a.id,
        'client_id', a.client_id,
        'project_id', a.project_id,
        'business_name', c.business_name,
        'severity', a.severity,
        'status', a.status,
        'title', a.summary,
        'summary', coalesce(a.details->>'last_error', a.summary),
        'type', a.alert_type,
        'created_at', a.created_at,
        'details', a.details
      ) as item
    from public.website_maintenance_alerts a
    join public.clients c on c.id = a.client_id
    where a.status in ('open','acknowledged')

    union all

    select
      coalesce(j.updated_at, j.created_at) as sort_at,
      jsonb_build_object(
        'source', 'automation',
        'id', j.id,
        'client_id', j.client_id,
        'project_id', j.project_id,
        'business_name', c.business_name,
        'severity', case when j.status = 'blocked' then 'warning' else 'high' end,
        'status', j.status,
        'title', case
          when j.status = 'blocked' then 'Automation is blocked'
          else 'Automation retries exhausted'
        end,
        'summary', coalesce(j.last_error, 'Automation needs owner attention.'),
        'type', j.job_type,
        'execution_target', j.execution_target,
        'attempts', j.attempts,
        'max_attempts', j.max_attempts,
        'created_at', j.created_at
      ) as item
    from public.automation_jobs j
    join public.clients c on c.id = j.client_id
    where (j.status = 'failed' and j.attempts >= j.max_attempts)
       or j.status = 'blocked'
  ) x;

  return jsonb_build_object(
    'healthy_clients', healthy_clients,
    'auto_retrying', retrying_jobs,
    'needs_owner_attention', owner_attention,
    'open_maintenance_alerts', open_maintenance_alerts,
    'exceptions', exception_items,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.owner_exception_center() from public, anon;
grant execute on function public.owner_exception_center() to authenticated, service_role;

create or replace function public.current_client_operational_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  account_row public.nxq_accounts%rowtype;
  project_row public.projects%rowtype;
  deployment_row public.project_deployment_configs%rowtype;
  plan_row public.website_maintenance_plans%rowtype;
  open_alert_count integer := 0;
  high_alert_count integer := 0;
  recent_checks jsonb := '[]'::jsonb;
  product_memberships jsonb := '[]'::jsonb;
  health_label text := 'setting_up';
begin
  select * into client_row
  from public.clients
  where auth_user_id = auth.uid()
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Client account not found.';
  end if;

  if client_row.nxq_account_id is not null then
    select * into account_row from public.nxq_accounts where id = client_row.nxq_account_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'product_slug', p.product_slug,
      'product_name', p.product_name,
      'membership_status', m.membership_status,
      'product_role', m.product_role
    ) order by p.product_name), '[]'::jsonb)
    into product_memberships
    from public.nxq_product_memberships m
    join public.nxq_products p on p.id = m.product_id
    where m.nxq_account_id = client_row.nxq_account_id;
  end if;

  select * into project_row
  from public.projects
  where client_id = client_row.id
  order by created_at desc
  limit 1;

  if project_row.id is not null then
    select * into deployment_row
    from public.project_deployment_configs
    where project_id = project_row.id
    limit 1;

    select * into plan_row
    from public.website_maintenance_plans
    where project_id = project_row.id
    limit 1;

    select count(*), count(*) filter (where severity in ('high','critical'))
    into open_alert_count, high_alert_count
    from public.website_maintenance_alerts
    where project_id = project_row.id and status in ('open','acknowledged');

    select coalesce(jsonb_agg(check_row order by checked_at desc), '[]'::jsonb)
    into recent_checks
    from (
      select jsonb_build_object(
        'task_type', t.task_type,
        'status', t.status,
        'checked_at', coalesce(t.completed_at, t.updated_at, t.created_at),
        'result', t.result,
        'last_error', t.last_error
      ) as check_row,
      coalesce(t.completed_at, t.updated_at, t.created_at) as checked_at
      from public.website_maintenance_tasks t
      where t.project_id = project_row.id
      order by coalesce(t.completed_at, t.updated_at, t.created_at) desc
      limit 8
    ) q;
  end if;

  health_label := case
    when high_alert_count > 0 then 'needs_attention'
    when open_alert_count > 0 then 'watching'
    when plan_row.status = 'error' then 'needs_attention'
    when deployment_row.last_deployment_status = 'published' and plan_row.status = 'active' then 'healthy'
    when deployment_row.last_deployment_status = 'published' then 'live_monitoring_setup'
    when project_row.stage::text in ('live','maintenance') then 'live_monitoring_setup'
    else 'setting_up'
  end;

  return jsonb_build_object(
    'client_id', client_row.id,
    'client_code', client_row.client_code,
    'business_name', client_row.business_name,
    'client_status', client_row.status,
    'nxq_id', account_row.nxq_id,
    'nxq_account_status', account_row.account_status,
    'assurance_level', coalesce(account_row.assurance_level, 0),
    'email_verified', coalesce(account_row.primary_email_verified, false),
    'phone_verified', coalesce(account_row.primary_phone_verified, false),
    'product_memberships', product_memberships,
    'project_id', project_row.id,
    'project_stage', project_row.stage,
    'website_status', project_row.website_status,
    'production_url', deployment_row.production_url,
    'deployment_status', deployment_row.last_deployment_status,
    'maintenance_status', plan_row.status,
    'last_maintenance_at', plan_row.last_maintenance_at,
    'latest_maintenance_error', plan_row.latest_error,
    'open_alerts', open_alert_count,
    'high_alerts', high_alert_count,
    'health', health_label,
    'recent_checks', recent_checks,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.current_client_operational_health() from public, anon;
grant execute on function public.current_client_operational_health() to authenticated, service_role;

comment on function public.owner_exception_center() is
  'Owner-only operational read model: healthy clients, automatic retries, and exceptions that truly need attention.';
comment on function public.current_client_operational_health() is
  'Current client read model for NXQ ID, website deployment health, maintenance state, and recent checks.';