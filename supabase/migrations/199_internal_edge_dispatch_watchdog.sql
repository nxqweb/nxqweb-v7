-- Detect pg_net transport failures that can strand queued Edge/AI automation.

create or replace function public.monitor_internal_edge_dispatch_network()
returns jsonb
language plpgsql
security definer
set search_path = public, net
as $$
declare
  latest_response record;
  stale_job public.automation_jobs%rowtype;
  existing_incident uuid;
  unhealthy boolean := false;
begin
  select id, status_code, error_msg, created
  into latest_response
  from net._http_response
  order by created desc
  limit 1;

  unhealthy := latest_response.id is not null
    and latest_response.created >= now() - interval '4 minutes'
    and latest_response.status_code is null
    and nullif(btrim(coalesce(latest_response.error_msg, '')), '') is not null;

  select j.*
  into stale_job
  from public.automation_jobs j
  left join public.client_automation_controls controls on controls.client_id = j.client_id
  where j.execution_target in ('edge','ai')
    and j.status in ('queued','failed')
    and j.run_after <= now() - interval '3 minutes'
    and j.attempts < j.max_attempts
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false)
  order by j.priority, j.run_after, j.created_at
  limit 1;

  select id into existing_incident
  from public.automation_escalations
  where escalation_type = 'internal_edge_dispatch_network_unreachable'
    and status in ('open','acknowledged')
  order by created_at desc
  limit 1;

  if unhealthy and stale_job.id is not null and existing_incident is null then
    insert into public.automation_escalations (
      client_id, project_id, automation_job_id, escalation_type, severity,
      title, summary, status, details
    ) values (
      stale_job.client_id,
      stale_job.project_id,
      stale_job.id,
      'internal_edge_dispatch_network_unreachable',
      'high',
      'NXQ internal worker dispatch network is unreachable',
      'Internal HTTP dispatch is unreachable while automation work is queued. Jobs remain safely queued without consuming retry attempts.',
      'open',
      jsonb_build_object(
        'response_id', latest_response.id,
        'network_error', latest_response.error_msg,
        'blocked_job_type', stale_job.job_type,
        'execution_target', stale_job.execution_target,
        'attempts_preserved', stale_job.attempts,
        'detected_at', now()
      )
    );
  elsif not unhealthy and existing_incident is not null
        and latest_response.id is not null
        and latest_response.created >= now() - interval '4 minutes'
        and latest_response.status_code between 200 and 499 then
    update public.automation_escalations
    set status = 'resolved', resolved_at = now(),
        details = coalesce(details, '{}'::jsonb) || jsonb_build_object('network_recovered_at', now())
    where id = existing_incident;
  end if;

  return jsonb_build_object(
    'ok', true,
    'network_unhealthy', unhealthy,
    'latest_response_id', latest_response.id,
    'latest_error', latest_response.error_msg,
    'stale_external_job_id', stale_job.id,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.monitor_internal_edge_dispatch_network() from public, anon, authenticated;
grant execute on function public.monitor_internal_edge_dispatch_network() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-internal-edge-network-watchdog-every-two-minutes') then
    perform cron.unschedule('nxq-internal-edge-network-watchdog-every-two-minutes');
  end if;
end;
$$;

select cron.schedule(
  'nxq-internal-edge-network-watchdog-every-two-minutes',
  '*/2 * * * *',
  $$select public.monitor_internal_edge_dispatch_network();$$
);
