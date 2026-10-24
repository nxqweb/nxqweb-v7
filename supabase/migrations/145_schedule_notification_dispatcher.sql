-- Automatic notification dispatcher wake-up.
-- Uses Vault for the Edge Function URL and dedicated worker token.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-dispatch-notifications') then
    perform cron.unschedule('nxq-dispatch-notifications');
  end if;
end $$;

select cron.schedule(
  'nxq-dispatch-notifications',
  '* * * * *',
  $cron$
  select case
    when exists (
      select 1
      from public.notification_deliveries
      where status in ('queued','failed')
        and run_after <= now()
    ) then net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'nxq_notification_dispatch_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-nxq-worker-token',(select decrypted_secret from vault.decrypted_secrets where name = 'nxq_automation_worker_token' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 12000
    )
    else null
  end;
  $cron$
);

comment on table public.notification_deliveries is
  'Provider-neutral notification queue. The nxq-dispatch-notifications cron wakes delivery only when due work exists.';
