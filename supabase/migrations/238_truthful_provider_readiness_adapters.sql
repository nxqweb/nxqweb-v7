-- Provider readiness must come from recent successful activity, not from the
-- presence of a secret name. The provider-health scheduler skips activity-owned
-- connections so it cannot overwrite their worker-derived evidence.

update public.nxq_provider_connections
set required_secret_names=array[
      'NXQ_NOTIFICATION_ADAPTER_URL',
      'NXQ_NOTIFICATION_ADAPTER_TOKEN',
      'NXQ_RESEND_API_KEY',
      'NXQ_NOTIFICATION_FROM_EMAIL'
    ],
    adapter_version='nxq-resend-adapter-v1',
    capabilities=array['email_delivery','retry_evidence','provider_message_id','provider_idempotency'],
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'health_check_mode','activity_evidence',
      'provider','resend',
      'successful_delivery_required',true,
      'secret_values_logged',false
    ),
    status=case when status='disabled' then status else 'not_configured' end,
    last_checked_at=null,
    last_success_at=null,
    last_error=case when status='disabled' then last_error else 'Notification provider activity must be revalidated.' end,
    updated_at=now()
where provider_key='notification_adapter'
  and scope_type='global'
  and scope_id is null;

update public.nxq_provider_connections
set required_secret_names=array[
      'NXQ_MALWARE_SCAN_ADAPTER_URL',
      'NXQ_MALWARE_SCAN_ADAPTER_TOKEN',
      'NXQ_CLOUDMERSIVE_API_KEY'
    ],
    adapter_version='nxq-cloudmersive-adapter-v1',
    capabilities=array['private_file_scan','sha256_evidence','quarantine_release','provider_activity_evidence'],
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'health_check_mode','activity_evidence',
      'provider','cloudmersive',
      'clean_result_required',true,
      'secret_values_logged',false
    ),
    status=case when status='disabled' then status else 'not_configured' end,
    last_checked_at=null,
    last_success_at=null,
    last_error=case when status='disabled' then last_error else 'Malware provider activity must be revalidated.' end,
    updated_at=now()
where provider_key='malware_scan'
  and scope_type='global'
  and scope_id is null;

update public.nxq_provider_connections
set config=coalesce(config,'{}'::jsonb)||jsonb_build_object('health_check_mode','activity_evidence'),
    updated_at=now()
where provider_key in ('change_classifier_ai','business_build_plan_ai')
  and scope_type='global'
  and scope_id is null;

update public.nxq_provider_connections
set config=coalesce(config,'{}'::jsonb)||jsonb_build_object('health_check_mode','adapter_probe'),
    updated_at=now()
where provider_key in ('github','netlify','provider_health_adapter')
  and scope_type='global'
  and scope_id is null;

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
  notification_last_success timestamptz;
  malware_last_success timestamptz;
  clean_scan_last_success timestamptz;
begin
  select max(last_success_at) into notification_last_success
  from public.nxq_provider_connections
  where provider_key='notification_adapter'
    and scope_type='global'
    and scope_id is null
    and status='healthy';

  select exists(select 1 from cron.job where active and jobname='nxq-dispatch-notifications')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_notification_dispatch_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from public.automation_worker_heartbeats where worker_key='dispatch-notifications' and status='healthy' and heartbeat_at>now()-interval '10 minutes' and coalesce((metadata->>'adapter_configured')::boolean,false))
    and coalesce(notification_last_success>=now()-interval '30 days',false)
  into notification_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-process-data-subject-requests')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_privacy_processor_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
  into privacy_ok;

  select max(last_success_at) into malware_last_success
  from public.nxq_provider_connections
  where provider_key='malware_scan'
    and scope_type='global'
    and scope_id is null
    and status='healthy';

  select max(scanned_at) into clean_scan_last_success
  from public.client_file_security_scans
  where status='clean'
    and quarantine_status='released'
    and provider_reference like 'cloudmersive:%'
    and length(coalesce(content_sha256,''))=64;

  select exists(select 1 from cron.job where active and jobname='nxq-file-security-scans-every-two-minutes')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_file_scan_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
    and coalesce(malware_last_success>=now()-interval '30 days',false)
    and coalesce(clean_scan_last_success>=now()-interval '30 days',false)
  into file_security_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-domain-reconcile-queue-every-5-minutes')
    and exists(select 1 from cron.job where active and jobname='nxq-domain-reconcile-dispatch-every-minute')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_domain_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
  into domain_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-provider-health-every-five-minutes')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_provider_health_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from public.automation_worker_heartbeats where worker_key='check-provider-health' and status='healthy' and heartbeat_at>now()-interval '10 minutes' and coalesce((metadata->>'adapter_configured')::boolean,false))
  into provider_health_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-weekly-backup-restore-drill')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_backup_drill_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
  into recovery_ok;

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
      when 'notification_pipeline_ready' then jsonb_build_object(
        'configured',notification_ok,
        'adapter_heartbeat_required',true,
        'successful_delivery_required',true,
        'latest_provider_success',notification_last_success,
        'evidence_freshness_days',30
      )
      when 'privacy_pipeline_ready' then jsonb_build_object('configured',privacy_ok)
      when 'file_security_pipeline_ready' then jsonb_build_object(
        'configured',file_security_ok,
        'requires_healthy_malware_scan_provider',true,
        'clean_scan_required',true,
        'latest_provider_success',malware_last_success,
        'latest_clean_scan',clean_scan_last_success,
        'evidence_freshness_days',30
      )
      when 'domain_reconciliation_ready' then jsonb_build_object('configured',domain_ok)
      when 'provider_health_pipeline_ready' then jsonb_build_object('configured',provider_health_ok,'adapter_heartbeat_required',true)
      when 'recovery_drill_scheduled' then jsonb_build_object('configured',recovery_ok)
      else evidence end,
    last_checked_at=now(),
    checked_by='nxq-provider-readiness-v3',
    updated_at=now()
  where check_key in (
    'notification_pipeline_ready','privacy_pipeline_ready','file_security_pipeline_ready',
    'domain_reconciliation_ready','provider_health_pipeline_ready','recovery_drill_scheduled'
  );

  return jsonb_build_object(
    'ok',true,
    'notification_pipeline_ready',notification_ok,
    'privacy_pipeline_ready',privacy_ok,
    'file_security_pipeline_ready',file_security_ok,
    'domain_reconciliation_ready',domain_ok,
    'provider_health_pipeline_ready',provider_health_ok,
    'recovery_drill_scheduled',recovery_ok,
    'evaluated_at',now()
  );
end;
$$;

revoke all on function public.evaluate_extended_launch_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_extended_launch_readiness() to service_role;

insert into public.automation_audit_log(event_type,actor_type,details)
values('provider_readiness_contract_hardened','system',jsonb_build_object(
  'provider_activity_evidence_required',true,
  'notification_provider','resend',
  'malware_provider','cloudmersive',
  'secret_values_logged',false,
  'production_changed',false
));

comment on function public.evaluate_extended_launch_readiness() is
  'Provider readiness v3 requires recent real notification and clean malware-scan activity; secret presence alone cannot satisfy launch readiness.';
