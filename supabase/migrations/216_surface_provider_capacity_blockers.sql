-- Surface long-lived external provider capacity pauses separately from NXQ failures.
-- Jobs remain queued/deferred and resume automatically when provider capacity returns.

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
    and j.attempts < j.max_attempts
    and coalesce(j.last_error, '') not like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%'
    and coalesce(j.last_error, '') not like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%';

  select count(*) into open_maintenance_alerts
  from public.website_maintenance_alerts a
  where a.status in ('open','acknowledged');

  select count(*) into owner_attention
  from (
    select j.id
    from public.automation_jobs j
    where (j.status = 'failed' and j.attempts >= j.max_attempts)
       or j.status = 'blocked'
       or coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%'
       or coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%'
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
        and (
          (j.status = 'failed' and j.attempts >= j.max_attempts)
          or j.status = 'blocked'
          or coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%'
          or coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%'
        )
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
        'severity', case
          when coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%' then 'warning'
          when coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%' then 'warning'
          when j.status = 'blocked' then 'warning'
          else 'high'
        end,
        'status', case
          when coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%' then 'provider_blocked'
          when coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%' then 'provider_blocked'
          else j.status
        end,
        'title', case
          when coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%' then 'External provider billing is blocking automation'
          when coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%' then 'External provider capacity is blocking automation'
          when j.status = 'blocked' then 'Automation is blocked'
          else 'Automation retries exhausted'
        end,
        'summary', coalesce(j.last_error, 'Automation needs owner attention.'),
        'type', j.job_type,
        'execution_target', j.execution_target,
        'attempts', j.attempts,
        'max_attempts', j.max_attempts,
        'retry_at', j.run_after,
        'created_at', j.created_at
      ) as item
    from public.automation_jobs j
    join public.clients c on c.id = j.client_id
    where (j.status = 'failed' and j.attempts >= j.max_attempts)
       or j.status = 'blocked'
       or coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_BILLING_BLOCKER:%'
       or coalesce(j.last_error, '') like 'EXTERNAL_PROVIDER_CAPACITY_BLOCKER:%'
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

comment on function public.owner_exception_center() is
  'Owner-only operational read model including safely deferred external provider billing and capacity blockers.';
