-- Correlate internal dispatch transport health to exact NXQ pg_net request IDs.
-- Migration 199 used the newest global net._http_response row, which could belong to an
-- unrelated pg_net caller. This replacement derives the newest launch-critical NXQ
-- dispatch request from automation_audit_log and inspects only that exact request ID.

create or replace function public.monitor_internal_edge_dispatch_network()
returns jsonb
language plpgsql
security definer
set search_path = public, net
as $$
declare
  dispatch_audit record;
  response_row record;
  request_id bigint;
  request_age interval;
  network_unhealthy boolean := false;
  transport_reached boolean := false;
  failure_reason text;
  stale_job record;
  existing_incident record;
begin
  select
    a.id,
    a.event_type,
    a.details,
    a.created_at
  into dispatch_audit
  from public.automation_audit_log a
  where a.event_type in (
    'project_infrastructure_dispatch_requested',
    'build_plan_dispatch_requested',
    'business_website_dispatch_requested',
    'business_production_dispatch_requested'
  )
    and coalesce(a.details ->> 'request_id', '') ~ '^[0-9]+$'
  order by a.created_at desc, a.id desc
  limit 1;

  if dispatch_audit.id is not null then
    request_id := (dispatch_audit.details ->> 'request_id')::bigint;
    request_age := now() - dispatch_audit.created_at;

    select r.id, r.status_code, r.error_msg, r.created
    into response_row
    from net._http_response r
    where r.id = request_id
    limit 1;

    if response_row.id is null then
      if request_age > interval '45 seconds' then
        network_unhealthy := true;
        failure_reason := 'NXQ pg_net request has no response after 45 seconds.';
      end if;
    elsif response_row.status_code between 200 and 499 then
      transport_reached := true;
    elsif response_row.status_code is null and nullif(trim(coalesce(response_row.error_msg, '')), '') is not null then
      network_unhealthy := true;
      failure_reason := response_row.error_msg;
    elsif response_row.status_code >= 500 then
      -- HTTP 5xx proves DNS/TLS/HTTP transport reached the Edge endpoint. It is an
      -- application/provider failure, not an internal dispatch-network outage.
      transport_reached := true;
    else
      network_unhealthy := true;
      failure_reason := coalesce(response_row.error_msg, 'NXQ pg_net transport did not produce a usable response.');
    end if;
  end if;

  select
    j.id,
    j.client_id,
    j.project_id,
    j.job_type,
    j.execution_target,
    j.attempts,
    j.max_attempts,
    j.run_after,
    j.created_at
  into stale_job
  from public.automation_jobs j
  left join public.client_automation_controls controls on controls.client_id = j.client_id
  where j.execution_target in ('edge','ai')
    and j.status in ('queued','failed')
    and j.run_after <= now() - interval '3 minutes'
    and j.attempts < j.max_attempts
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false)
  order by j.run_after asc, j.created_at asc
  limit 1;

  select e.* into existing_incident
  from public.automation_escalations e
  where e.escalation_type = 'internal_edge_dispatch_network_unreachable'
    and e.status in ('open','acknowledged')
  order by e.created_at desc
  limit 1;

  if network_unhealthy and stale_job.id is not null and existing_incident.id is null then
    insert into public.automation_escalations (
      client_id,
      project_id,
      automation_job_id,
      escalation_type,
      severity,
      title,
      summary,
      details
    ) values (
      stale_job.client_id,
      stale_job.project_id,
      stale_job.id,
      'internal_edge_dispatch_network_unreachable',
      'high',
      'Internal Edge dispatch network is unreachable',
      'An exact NXQ pg_net dispatch request failed transport while external work remained queued. Jobs stay safely queued without consuming worker retry attempts.',
      jsonb_build_object(
        'dispatch_audit_id', dispatch_audit.id,
        'dispatch_event_type', dispatch_audit.event_type,
        'request_id', request_id,
        'request_created_at', dispatch_audit.created_at,
        'response_status_code', response_row.status_code,
        'response_error', failure_reason,
        'automation_job_id', stale_job.id,
        'job_type', stale_job.job_type,
        'execution_target', stale_job.execution_target,
        'attempts', stale_job.attempts,
        'max_attempts', stale_job.max_attempts,
        'detected_at', now(),
        'correlation', 'exact_nxq_pg_net_request_id'
      )
    );
  elsif transport_reached and existing_incident.id is not null then
    update public.automation_escalations
    set status = 'resolved',
        resolved_at = now(),
        details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
          'resolved_by_request_id', request_id,
          'resolved_by_dispatch_event_type', dispatch_audit.event_type,
          'resolved_status_code', response_row.status_code,
          'resolved_at', now(),
          'correlation', 'exact_nxq_pg_net_request_id'
        )
    where id = existing_incident.id;
  end if;

  return jsonb_build_object(
    'ok', not network_unhealthy,
    'nxq_dispatch_observed', dispatch_audit.id is not null,
    'request_id', request_id,
    'dispatch_event_type', dispatch_audit.event_type,
    'response_status_code', response_row.status_code,
    'response_error', failure_reason,
    'transport_reached', transport_reached,
    'network_unhealthy', network_unhealthy,
    'stale_external_job', stale_job.id is not null,
    'correlation', 'exact_nxq_pg_net_request_id',
    'checked_at', now()
  );
end;
$$;

revoke all on function public.monitor_internal_edge_dispatch_network() from public, anon, authenticated;
grant execute on function public.monitor_internal_edge_dispatch_network() to service_role;

comment on function public.monitor_internal_edge_dispatch_network() is
  'Monitors database-to-Edge transport using the exact pg_net request ID logged by NXQ launch-critical dispatchers; unrelated pg_net responses cannot open or resolve this incident.';
