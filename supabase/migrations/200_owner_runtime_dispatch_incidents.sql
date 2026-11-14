-- Small owner-only read model for internal worker-dispatch transport incidents.
-- Kept separate from owner_exception_center so the runtime watchdog can ship
-- independently without rewriting the larger exception-center contract.

create or replace function public.owner_runtime_dispatch_incidents()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  incident_items jsonb := '[]'::jsonb;
  open_count integer := 0;
begin
  if not exists (
    select 1
    from public.owner_users ou
    where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  select count(*)
  into open_count
  from public.automation_escalations e
  where e.escalation_type = 'internal_edge_dispatch_network_unreachable'
    and e.status in ('open','acknowledged');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'client_id', e.client_id,
        'project_id', e.project_id,
        'automation_job_id', e.automation_job_id,
        'business_name', c.business_name,
        'severity', e.severity,
        'status', e.status,
        'title', e.title,
        'summary', e.summary,
        'details', e.details,
        'created_at', e.created_at,
        'resolved_at', e.resolved_at
      ) order by e.created_at desc
    ),
    '[]'::jsonb
  )
  into incident_items
  from public.automation_escalations e
  left join public.clients c on c.id = e.client_id
  where e.escalation_type = 'internal_edge_dispatch_network_unreachable'
    and e.status in ('open','acknowledged');

  return jsonb_build_object(
    'open_count', open_count,
    'incidents', incident_items,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.owner_runtime_dispatch_incidents() from public, anon;
grant execute on function public.owner_runtime_dispatch_incidents() to authenticated, service_role;

comment on function public.owner_runtime_dispatch_incidents() is
  'Owner-only read model for internal pg_net-to-Edge dispatch transport incidents raised by the runtime watchdog.';
