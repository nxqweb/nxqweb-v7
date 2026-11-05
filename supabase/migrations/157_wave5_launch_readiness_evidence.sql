-- Readiness evidence for wave-five autonomous services.

insert into public.launch_readiness_checks(check_key,category,title,required)
values
 ('business_seo_pipeline_ready','seo','Business SEO artifact worker runtime configured',true),
 ('notification_digest_ready','notifications','Notification digest scheduler configured',true)
on conflict(check_key) do nothing;

create or replace function public.evaluate_wave5_launch_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,vault
as $$
declare seo_ok boolean:=false; digest_ok boolean:=false;
begin
  select exists(select 1 from cron.job where active and jobname='nxq-business-seo-artifacts-every-minute')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_business_seo_edge_url')
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token') into seo_ok;

  select exists(select 1 from cron.job where active and jobname='nxq-prepare-notification-digests')
    and exists(select 1 from cron.job where active and jobname='nxq-dispatch-notifications') into digest_ok;

  update public.launch_readiness_checks set
    status=case check_key
      when 'business_seo_pipeline_ready' then case when seo_ok then 'ready' else 'unknown' end
      when 'notification_digest_ready' then case when digest_ok then 'ready' else 'unknown' end
      else status end,
    evidence=case check_key
      when 'business_seo_pipeline_ready' then jsonb_build_object('configured',seo_ok,'vault_worker_url','nxq_business_seo_edge_url')
      when 'notification_digest_ready' then jsonb_build_object('configured',digest_ok,'digest_cron','nxq-prepare-notification-digests','delivery_cron','nxq-dispatch-notifications')
      else evidence end,
    last_checked_at=now(),checked_by='nxq-wave5-readiness-evaluator',updated_at=now()
  where check_key in ('business_seo_pipeline_ready','notification_digest_ready');

  return jsonb_build_object('ok',true,'business_seo_pipeline_ready',seo_ok,'notification_digest_ready',digest_ok,'evaluated_at',now());
end;
$$;

revoke all on function public.evaluate_wave5_launch_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_wave5_launch_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-wave5-launch-readiness-every-five-minutes') then perform cron.unschedule('nxq-wave5-launch-readiness-every-five-minutes'); end if;
end $$;
select cron.schedule('nxq-wave5-launch-readiness-every-five-minutes','*/5 * * * *',$$select public.evaluate_wave5_launch_readiness();$$);
