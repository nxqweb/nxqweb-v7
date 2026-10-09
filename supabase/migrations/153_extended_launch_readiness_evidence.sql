-- Extended evidence-driven launch readiness for newly staged autonomous services.
-- Missing runtime/Vault/provider evidence stays unknown rather than becoming fake-ready.

insert into public.launch_readiness_checks(check_key,category,title,required)
values
 ('notification_pipeline_ready','automation','Notification dispatcher runtime configured',true),
 ('privacy_pipeline_ready','privacy','Privacy request processor runtime configured',true),
 ('file_security_pipeline_ready','security','Client file scanner runtime configured',true),
 ('domain_reconciliation_ready','domains','Domain reconciliation runtime configured',true),
 ('provider_health_pipeline_ready','providers','Provider health monitor runtime configured',true),
 ('recovery_drill_scheduled','recovery','Weekly non-destructive recovery drill configured',true)
on conflict(check_key) do nothing;

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
    and exists(select 1 from vault.decrypted_secrets where name='nxq_notification_dispatch_url')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token') into notification_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-process-data-subject-requests')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_privacy_processor_edge_url')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token') into privacy_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-file-security-scans-every-two-minutes')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_file_scan_edge_url')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token')
    and exists(select 1 from public.nxq_provider_connections where provider_category='malware_scan' and status='healthy') into file_security_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-domain-reconcile-queue-every-5-minutes')
    and exists(select 1 from cron.job where active and jobname='nxq-domain-reconcile-dispatch-every-minute')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_domain_edge_url') into domain_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-provider-health-every-five-minutes')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_provider_health_edge_url') into provider_health_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-weekly-backup-restore-drill')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_backup_drill_edge_url') into recovery_ok;

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
      when 'notification_pipeline_ready' then jsonb_build_object('configured',notification_ok)
      when 'privacy_pipeline_ready' then jsonb_build_object('configured',privacy_ok)
      when 'file_security_pipeline_ready' then jsonb_build_object('configured',file_security_ok,'requires_healthy_malware_scan_provider',true)
      when 'domain_reconciliation_ready' then jsonb_build_object('configured',domain_ok)
      when 'provider_health_pipeline_ready' then jsonb_build_object('configured',provider_health_ok)
      when 'recovery_drill_scheduled' then jsonb_build_object('configured',recovery_ok,'non_destructive',true)
      else evidence end,
    last_checked_at=now(),checked_by='nxq-extended-readiness-evaluator',updated_at=now()
  where check_key in ('notification_pipeline_ready','privacy_pipeline_ready','file_security_pipeline_ready','domain_reconciliation_ready','provider_health_pipeline_ready','recovery_drill_scheduled');

  return jsonb_build_object('ok',true,'notification_pipeline_ready',notification_ok,'privacy_pipeline_ready',privacy_ok,'file_security_pipeline_ready',file_security_ok,'domain_reconciliation_ready',domain_ok,'provider_health_pipeline_ready',provider_health_ok,'recovery_drill_scheduled',recovery_ok,'evaluated_at',now());
end;
$$;

revoke all on function public.evaluate_extended_launch_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_extended_launch_readiness() to service_role;

do $$ begin if exists(select 1 from cron.job where jobname='nxq-extended-launch-readiness-every-five-minutes') then perform cron.unschedule('nxq-extended-launch-readiness-every-five-minutes'); end if; end $$;
select cron.schedule('nxq-extended-launch-readiness-every-five-minutes','*/5 * * * *',$$select public.evaluate_extended_launch_readiness();$$);
