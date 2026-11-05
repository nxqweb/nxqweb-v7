-- Bridge the autonomous Business production path into the existing maintenance system.
-- A verified published project_deployment_configs record is sufficient to bootstrap monitoring;
-- legacy production_launch_requests remain supported as a fallback source.

create or replace function public.bootstrap_live_website_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row record;
  profile_id uuid;
  created_count integer := 0;
begin
  for project_row in
    select
      p.id as project_id,
      p.client_id,
      coalesce(
        case when pdc.last_deployment_status = 'published' then pdc.production_url else null end,
        legacy.monitored_url
      ) as monitored_url
    from public.projects p
    join public.clients c on c.id = p.client_id
    left join public.project_deployment_configs pdc on pdc.project_id = p.id
    left join lateral (
      select coalesce(pd.published_url, plc.production_url) as monitored_url
      from public.production_launch_requests plc
      left join public.project_deployments pd on pd.id = plc.deployment_record_id
      where plc.project_id = p.id and plc.status = 'published'
      order by plc.updated_at desc
      limit 1
    ) legacy on true
    left join public.client_automation_controls controls on controls.client_id = c.id
    where p.stage::text in ('live','maintenance')
      and c.status::text in ('approved','active')
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
      and not exists (
        select 1 from public.website_maintenance_plans mp where mp.project_id = p.id
      )
  loop
    insert into public.website_security_profiles (
      client_id, project_id, monitoring_status, website_health, monitored_url
    ) values (
      project_row.client_id,
      project_row.project_id,
      case when project_row.monitored_url is null then 'setup_pending' else 'active' end,
      case when project_row.monitored_url is null then 'not_connected' else 'unknown' end,
      project_row.monitored_url
    )
    on conflict (client_id, project_id) do update
      set monitored_url = coalesce(excluded.monitored_url, public.website_security_profiles.monitored_url),
          monitoring_status = case when excluded.monitored_url is null then public.website_security_profiles.monitoring_status else 'active' end,
          updated_at = now()
    returning id into profile_id;

    insert into public.website_maintenance_plans (
      client_id, project_id, security_profile_id, status, monitored_url
    ) values (
      project_row.client_id,
      project_row.project_id,
      profile_id,
      case when project_row.monitored_url is null then 'setup_pending' else 'active' end,
      project_row.monitored_url
    )
    on conflict (project_id) do update
      set monitored_url = coalesce(excluded.monitored_url, public.website_maintenance_plans.monitored_url),
          status = case when excluded.monitored_url is null then public.website_maintenance_plans.status else 'active' end,
          updated_at = now();

    insert into public.automation_audit_log (client_id, project_id, event_type, details)
    values (
      project_row.client_id,
      project_row.project_id,
      'website_maintenance_plan_created',
      jsonb_build_object(
        'monitored_url', project_row.monitored_url,
        'source', case when project_row.monitored_url is null then 'pending' else 'verified_project_deployment_config' end,
        'provider_connected', false
      )
    );

    created_count := created_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'created_plans', created_count, 'ran_at', now());
end;
$$;

revoke all on function public.bootstrap_live_website_maintenance() from public, anon, authenticated;
grant execute on function public.bootstrap_live_website_maintenance() to service_role;
