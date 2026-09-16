-- Weekly non-destructive backup/restore drill dispatcher.
-- URL and worker token remain in Vault.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do $$
begin
  if exists(select 1 from cron.job where jobname='nxq-weekly-backup-restore-drill') then
    perform cron.unschedule('nxq-weekly-backup-restore-drill');
  end if;
end $$;

select cron.schedule(
  'nxq-weekly-backup-restore-drill',
  '17 3 * * 0',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='nxq_backup_drill_edge_url' limit 1),
    headers := jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='nxq_automation_worker_token' limit 1)),
    body := jsonb_build_object('source','nxq_weekly_backup_restore_drill','requested_at',now()),
    timeout_milliseconds := 20000
  );
  $cron$
);
