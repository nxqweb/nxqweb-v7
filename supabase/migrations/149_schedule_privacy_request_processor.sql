-- Automatic privacy request processor dispatcher.
-- Edge URL + worker token stay in Vault.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do $$
begin
  if exists (select 1 from cron.job where jobname='nxq-process-data-subject-requests') then
    perform cron.unschedule('nxq-process-data-subject-requests');
  end if;
end $$;

select cron.schedule(
  'nxq-process-data-subject-requests',
  '* * * * *',
  $cron$
  select case when exists(
    select 1 from public.automation_jobs
    where status in ('queued','failed')
      and job_type='process_data_subject_request'
      and execution_target='edge'
      and run_after<=now()
  ) then net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='nxq_privacy_processor_edge_url' limit 1),
    headers := jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='nxq_automation_worker_token' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 12000
  ) else null end;
  $cron$
);
