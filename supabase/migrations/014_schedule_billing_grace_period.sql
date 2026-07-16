-- Schedule the NXQ billing grace-period review once per day.
-- This job moves eligible clients from past_due to freeze_review.
-- It never freezes clients automatically.

create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'nxq-billing-grace-period-daily'
  ) then
    perform cron.unschedule('nxq-billing-grace-period-daily');
  end if;
end;
$$;

select cron.schedule(
  'nxq-billing-grace-period-daily',
  '0 9 * * *',
  $$select public.advance_billing_grace_period();$$
);