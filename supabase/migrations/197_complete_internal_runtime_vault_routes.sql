-- Complete NXQ internal Edge routing from the already-configured, known-good Supabase base URL.
-- No token is read into source control, returned, rotated, or logged.

create extension if not exists supabase_vault with schema vault;

do $$
declare
  current_infra_url text;
  function_base_url text;
  route record;
  existing_id uuid;
  configured_names text[] := '{}'::text[];
begin
  select decrypted_secret into current_infra_url
  from vault.decrypted_secrets
  where name = 'nxq_automation_edge_url'
    and nullif(btrim(decrypted_secret), '') is not null
  order by created_at desc
  limit 1;

  if current_infra_url is null then
    raise exception 'nxq_automation_edge_url must be configured before completing runtime Vault routes.';
  end if;

  function_base_url := regexp_replace(
    rtrim(btrim(current_infra_url), '/'),
    '/provision-project-infrastructure$',
    ''
  );

  if function_base_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1$' then
    raise exception 'Existing NXQ automation route does not resolve to a valid hosted Supabase Functions base URL.';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'nxq_automation_worker_token'
      and nullif(btrim(decrypted_secret), '') is not null
  ) then
    raise exception 'nxq_automation_worker_token must already be configured.';
  end if;

  for route in
    select * from (values
      ('nxq_automation_edge_url','provision-project-infrastructure'),
      ('nxq_backup_drill_edge_url','run-backup-restore-drill'),
      ('nxq_build_plan_edge_url','prepare-build-plan'),
      ('nxq_business_build_edge_url','build-business-website'),
      ('nxq_business_production_edge_url','promote-business-production'),
      ('nxq_business_seo_edge_url','build-business-seo-artifacts'),
      ('nxq_change_classifier_edge_url','classify-business-change-request'),
      ('nxq_domain_edge_url','reconcile-domain'),
      ('nxq_file_scan_edge_url','scan-client-file'),
      ('nxq_maintenance_edge_url','run-website-maintenance'),
      ('nxq_notification_dispatch_url','dispatch-notifications'),
      ('nxq_privacy_processor_edge_url','process-data-subject-request'),
      ('nxq_provider_health_edge_url','check-provider-health')
    ) as routes(secret_name, function_name)
  loop
    existing_id := null;
    select id into existing_id
    from vault.decrypted_secrets
    where name = route.secret_name
    order by created_at desc
    limit 1;

    if existing_id is null then
      perform vault.create_secret(
        function_base_url || '/' || route.function_name,
        route.secret_name,
        'NXQ internal Edge route for ' || route.function_name
      );
    else
      perform vault.update_secret(
        existing_id,
        function_base_url || '/' || route.function_name,
        route.secret_name,
        'NXQ internal Edge route for ' || route.function_name
      );
    end if;

    configured_names := array_append(configured_names, route.secret_name);
  end loop;

  insert into public.automation_audit_log(event_type, actor_type, details)
  values(
    'runtime_vault_routes_completed',
    'backend',
    jsonb_build_object(
      'configured_secret_names', configured_names,
      'route_count', cardinality(configured_names),
      'secret_values_logged', false,
      'worker_token_changed', false
    )
  );
end;
$$;
