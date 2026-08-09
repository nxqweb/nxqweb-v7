-- Wave 31: make staging deployment complete, seed the provider registry, and
-- configure internal Vault routes without exposing protected values to a browser.

create extension if not exists supabase_vault with schema vault;

insert into public.nxq_provider_connections(
  provider_key,provider_category,scope_type,status,adapter_version,capabilities,required_secret_names,config
)
select seed.provider_key,seed.provider_category,'global','not_configured','v1',seed.capabilities,seed.required_secret_names,seed.config
from (values
  ('github','source_control',array['private_repository_create','branch_read','exact_commit_verify'],array['GITHUB_APP_ID','GITHUB_APP_INSTALLATION_ID','GITHUB_APP_PRIVATE_KEY'],jsonb_build_object('health_adapter_kind','github_app','production_write_automatic',false)),
  ('netlify','hosting',array['private_repository_site','branch_preview','exact_deploy_verify'],array['NETLIFY_ACCESS_TOKEN','NETLIFY_GITHUB_INSTALLATION_ID'],jsonb_build_object('health_adapter_kind','netlify','production_publish_guarded',true)),
  ('malware_scan','malware_scan',array['private_file_scan','sha256_evidence','quarantine_release'],array['NXQ_MALWARE_SCAN_ADAPTER_URL','NXQ_MALWARE_SCAN_ADAPTER_TOKEN'],jsonb_build_object('health_adapter_kind','malware_scan','clean_result_required',true)),
  ('notification_adapter','email',array['email_delivery','retry_evidence','provider_message_id'],array['NXQ_NOTIFICATION_ADAPTER_URL','NXQ_NOTIFICATION_ADAPTER_TOKEN'],jsonb_build_object('health_adapter_kind','notification','qa_external_delivery_blocked',true)),
  ('provider_health_adapter','monitoring',array['provider_health','latency_evidence','auth_failure_classification'],array['NXQ_PROVIDER_HEALTH_ADAPTER_URL','NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN'],jsonb_build_object('health_adapter_kind','provider_health','secret_values_forwarded',false)),
  ('change_classifier_ai','other',array['structured_change_classification','safe_patch_allowlist'],array['NXQ_AI_CLASSIFIER_URL','NXQ_AI_CLASSIFIER_TOKEN'],jsonb_build_object('health_adapter_kind','change_classifier','production_write_allowed',false))
) as seed(provider_key,provider_category,capabilities,required_secret_names,config)
where not exists(
  select 1 from public.nxq_provider_connections existing
  where existing.provider_key=seed.provider_key and existing.scope_type='global' and existing.scope_id is null
);

create or replace function public.upsert_nxq_runtime_vault_secret(
  target_name text,
  target_value text,
  target_description text default 'NXQ protected runtime routing'
)
returns uuid
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  existing_id uuid;
  returned_id uuid;
  updated_any boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if target_name !~ '^nxq_[a-z0-9_]{3,80}$' then raise exception 'Unsupported NXQ Vault secret name.'; end if;
  if nullif(btrim(target_value),'') is null or length(target_value)>4000 then raise exception 'Vault secret value is empty or too large.'; end if;

  for existing_id in
    select id from vault.decrypted_secrets where name=target_name
  loop
    perform vault.update_secret(existing_id,target_value,target_name,target_description);
    returned_id:=existing_id;
    updated_any:=true;
  end loop;

  if not updated_any then
    select vault.create_secret(target_value,target_name,target_description) into returned_id;
  end if;
  return returned_id;
end;
$$;

create or replace function public.bootstrap_nxq_runtime_vault(
  target_function_base_url text,
  target_worker_token text,
  target_configured_provider_keys text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  route record;
  configured_names text[]:=array['nxq_automation_worker_token'];
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  target_function_base_url:=rtrim(btrim(target_function_base_url),'/');
  if target_function_base_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1$' then
    raise exception 'Runtime base URL must be a hosted Supabase Functions URL.';
  end if;
  if length(target_worker_token)<32 or length(target_worker_token)>512 or target_worker_token ~ '[[:space:]]' then
    raise exception 'Automation worker token does not meet the protected runtime contract.';
  end if;

  perform public.upsert_nxq_runtime_vault_secret('nxq_automation_worker_token',target_worker_token,'NXQ shared internal worker authentication');

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
    ) as routes(secret_name,function_name)
  loop
    perform public.upsert_nxq_runtime_vault_secret(route.secret_name,target_function_base_url||'/'||route.function_name,'NXQ internal Edge route for '||route.function_name);
    configured_names:=array_append(configured_names,route.secret_name);
  end loop;

  update public.nxq_provider_connections
  set status=case when status='disabled' then status when status='healthy' then status else 'configured' end,
      last_checked_at=case when status='healthy' then last_checked_at else null end,
      last_error=case when status='disabled' then last_error else null end,
      updated_at=now()
  where scope_type='global' and scope_id is null and provider_key=any(coalesce(target_configured_provider_keys,'{}'::text[]));

  insert into public.automation_audit_log(event_type,actor_type,details)
  values('runtime_vault_bootstrapped','owner',jsonb_build_object(
    'configured_secret_names',configured_names,
    'configured_provider_keys',coalesce(target_configured_provider_keys,'{}'::text[]),
    'secret_values_logged',false,
    'production_changed',false
  ));

  return jsonb_build_object(
    'ok',true,
    'configured_secret_names',configured_names,
    'configured_provider_keys',coalesce(target_configured_provider_keys,'{}'::text[]),
    'secret_values_returned',false,
    'production_changed',false
  );
end;
$$;

revoke all on function public.upsert_nxq_runtime_vault_secret(text,text,text) from public,anon,authenticated;
revoke all on function public.bootstrap_nxq_runtime_vault(text,text,text[]) from public,anon,authenticated;
grant execute on function public.upsert_nxq_runtime_vault_secret(text,text,text) to service_role;
grant execute on function public.bootstrap_nxq_runtime_vault(text,text,text[]) to service_role;

create or replace function public.evaluate_extended_launch_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,vault
as $$
declare
  notification_ok boolean:=false;
  privacy_ok boolean:=false;
  file_security_ok boolean:=false;
  domain_ok boolean:=false;
  provider_health_ok boolean:=false;
  recovery_ok boolean:=false;
begin
  select exists(select 1 from cron.job where active and jobname='nxq-dispatch-notifications')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_notification_dispatch_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from public.automation_worker_heartbeats where worker_key='dispatch-notifications' and status='healthy' and heartbeat_at>now()-interval '10 minutes' and coalesce((metadata->>'adapter_configured')::boolean,false))
    and exists(select 1 from public.nxq_provider_connections where provider_key='notification_adapter' and scope_type='global' and status='healthy') into notification_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-process-data-subject-requests')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_privacy_processor_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null) into privacy_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-file-security-scans-every-two-minutes')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_file_scan_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from public.nxq_provider_connections where provider_key='malware_scan' and scope_type='global' and status='healthy') into file_security_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-domain-reconcile-queue-every-5-minutes')
    and exists(select 1 from cron.job where active and jobname='nxq-domain-reconcile-dispatch-every-minute')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_domain_edge_url' and nullif(btrim(decrypted_secret),'') is not null) into domain_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-provider-health-every-five-minutes')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_provider_health_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from public.automation_worker_heartbeats where worker_key='check-provider-health' and status='healthy' and heartbeat_at>now()-interval '10 minutes' and coalesce((metadata->>'adapter_configured')::boolean,false)) into provider_health_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-weekly-backup-restore-drill')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_backup_drill_edge_url' and nullif(btrim(decrypted_secret),'') is not null) into recovery_ok;

  update public.launch_readiness_checks set
    status=case check_key
      when 'notification_pipeline_ready' then case when notification_ok then 'ready' else 'unknown' end
      when 'privacy_pipeline_ready' then case when privacy_ok then 'ready' else 'unknown' end
      when 'file_security_pipeline_ready' then case when file_security_ok then 'ready' else 'unknown' end
      when 'domain_reconciliation_ready' then case when domain_ok then 'ready' else 'unknown' end
      when 'provider_health_pipeline_ready' then case when provider_health_ok then 'ready' else 'unknown' end
      when 'recovery_drill_scheduled' then case when recovery_ok then 'ready' else 'unknown' end
      else status end,
    evidence=case check_key
      when 'notification_pipeline_ready' then jsonb_build_object('configured',notification_ok,'adapter_heartbeat_required',true,'provider_health_required',true)
      when 'privacy_pipeline_ready' then jsonb_build_object('configured',privacy_ok)
      when 'file_security_pipeline_ready' then jsonb_build_object('configured',file_security_ok,'requires_healthy_malware_scan_provider',true)
      when 'domain_reconciliation_ready' then jsonb_build_object('configured',domain_ok)
      when 'provider_health_pipeline_ready' then jsonb_build_object('configured',provider_health_ok,'adapter_heartbeat_required',true)
      when 'recovery_drill_scheduled' then jsonb_build_object('configured',recovery_ok)
      else evidence end,
    last_checked_at=now(),checked_by='nxq-wave31-runtime-readiness',updated_at=now()
  where check_key in ('notification_pipeline_ready','privacy_pipeline_ready','file_security_pipeline_ready','domain_reconciliation_ready','provider_health_pipeline_ready','recovery_drill_scheduled');

  return jsonb_build_object('ok',true,'notification_pipeline_ready',notification_ok,'privacy_pipeline_ready',privacy_ok,'file_security_pipeline_ready',file_security_ok,'domain_reconciliation_ready',domain_ok,'provider_health_pipeline_ready',provider_health_ok,'recovery_drill_scheduled',recovery_ok,'evaluated_at',now());
end;
$$;

revoke all on function public.evaluate_extended_launch_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_extended_launch_readiness() to service_role;

comment on function public.bootstrap_nxq_runtime_vault(text,text,text[]) is 'Service-only staging bootstrap. Derives internal Edge URLs, upserts the protected worker token, and returns names/evidence only—never secret values.';
