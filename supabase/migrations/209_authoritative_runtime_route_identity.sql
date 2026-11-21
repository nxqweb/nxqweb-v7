-- Authoritative internal Edge route identity.
-- The current Edge runtime supplies its own SUPABASE_URL-derived function base to this
-- service-role-only RPC. Route repair then derives every internal URL from that trusted
-- base instead of trusting one of the routes being repaired.

create extension if not exists supabase_vault with schema vault;

create or replace function public.set_nxq_authoritative_function_base_url(
  target_function_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  base_url text := regexp_replace(trim(coalesce(target_function_base_url, '')), '/+$', '');
  existing_id uuid;
  route record;
  expected_url text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if base_url = ''
     or base_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1$' then
    raise exception 'Authoritative function base URL is invalid.';
  end if;

  select id into existing_id
  from vault.secrets
  where name = 'nxq_runtime_function_base_url'
  order by created_at desc
  limit 1;

  if existing_id is null then
    perform vault.create_secret(base_url, 'nxq_runtime_function_base_url', 'Authoritative current-project Supabase Edge function base URL.');
  else
    perform vault.update_secret(existing_id, base_url, 'nxq_runtime_function_base_url', 'Authoritative current-project Supabase Edge function base URL.');
  end if;

  for route in
    select * from (values
      ('nxq_automation_edge_url', 'provision-project-infrastructure'),
      ('nxq_backup_drill_edge_url', 'run-backup-restore-drill'),
      ('nxq_build_plan_edge_url', 'prepare-build-plan'),
      ('nxq_business_build_edge_url', 'build-business-website'),
      ('nxq_business_production_edge_url', 'promote-business-production'),
      ('nxq_business_seo_edge_url', 'build-business-seo-artifacts'),
      ('nxq_change_classifier_edge_url', 'classify-business-change-request'),
      ('nxq_domain_edge_url', 'reconcile-domain'),
      ('nxq_file_scan_edge_url', 'scan-client-file'),
      ('nxq_maintenance_edge_url', 'run-website-maintenance'),
      ('nxq_notification_dispatch_url', 'dispatch-notifications'),
      ('nxq_privacy_processor_edge_url', 'process-data-subject-request'),
      ('nxq_provider_health_edge_url', 'check-provider-health')
    ) as routes(secret_name, function_name)
  loop
    expected_url := base_url || '/' || route.function_name;
    existing_id := null;
    select id into existing_id
    from vault.secrets
    where name = route.secret_name
    order by created_at desc
    limit 1;

    if existing_id is null then
      perform vault.create_secret(expected_url, route.secret_name, 'NXQ internal Edge route derived from authoritative runtime base.');
    else
      perform vault.update_secret(existing_id, expected_url, route.secret_name, 'NXQ internal Edge route derived from authoritative runtime base.');
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'authoritative_base_recorded', true,
    'routes_repaired', 13,
    'secret_values_returned', false,
    'updated_at', now()
  );
end;
$$;

create or replace function public.nxq_runtime_route_identity_status()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  base_url text;
  route record;
  actual_url text;
  expected_url text;
  mismatches jsonb := '[]'::jsonb;
  checked integer := 0;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'Trusted backend access required.';
  end if;

  select decrypted_secret into base_url
  from vault.decrypted_secrets
  where name = 'nxq_runtime_function_base_url'
  order by created_at desc
  limit 1;

  if nullif(trim(base_url), '') is null then
    return jsonb_build_object(
      'ok', false,
      'authoritative_base_configured', false,
      'route_count_checked', 0,
      'mismatch_count', 13,
      'secret_values_returned', false
    );
  end if;

  for route in
    select * from (values
      ('nxq_automation_edge_url', 'provision-project-infrastructure'),
      ('nxq_backup_drill_edge_url', 'run-backup-restore-drill'),
      ('nxq_build_plan_edge_url', 'prepare-build-plan'),
      ('nxq_business_build_edge_url', 'build-business-website'),
      ('nxq_business_production_edge_url', 'promote-business-production'),
      ('nxq_business_seo_edge_url', 'build-business-seo-artifacts'),
      ('nxq_change_classifier_edge_url', 'classify-business-change-request'),
      ('nxq_domain_edge_url', 'reconcile-domain'),
      ('nxq_file_scan_edge_url', 'scan-client-file'),
      ('nxq_maintenance_edge_url', 'run-website-maintenance'),
      ('nxq_notification_dispatch_url', 'dispatch-notifications'),
      ('nxq_privacy_processor_edge_url', 'process-data-subject-request'),
      ('nxq_provider_health_edge_url', 'check-provider-health')
    ) as routes(secret_name, function_name)
  loop
    checked := checked + 1;
    expected_url := base_url || '/' || route.function_name;
    select decrypted_secret into actual_url
    from vault.decrypted_secrets
    where name = route.secret_name
    order by created_at desc
    limit 1;

    if actual_url is distinct from expected_url then
      mismatches := mismatches || jsonb_build_array(route.secret_name);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(mismatches) = 0,
    'authoritative_base_configured', true,
    'route_count_checked', checked,
    'mismatch_count', jsonb_array_length(mismatches),
    'mismatched_secret_names', mismatches,
    'secret_values_returned', false,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.set_nxq_authoritative_function_base_url(text) from public, anon, authenticated;
revoke all on function public.nxq_runtime_route_identity_status() from public, anon, authenticated;
grant execute on function public.set_nxq_authoritative_function_base_url(text) to service_role;
grant execute on function public.nxq_runtime_route_identity_status() to service_role;

comment on function public.set_nxq_authoritative_function_base_url(text) is
  'Records the current Edge runtime function base and derives all internal Vault routes from it; never returns secret values.';
