-- Automatically wake the deterministic build-plan worker when due AI-lane jobs exist.
-- Secret values are stored only in Supabase Vault, never in source control.
-- Required one-time Vault entry:
--   nxq_build_plan_edge_url -> full prepare-build-plan function URL
-- Reuses nxq_automation_worker_token from the infrastructure dispatcher.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.dispatch_build_plan_worker()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  edge_url text;
  worker_token text;
  due_count integer := 0;
  request_id bigint;
  dispatch_index integer;
begin
  select count(*) into due_count
  from public.automation_jobs j
  left join public.client_automation_controls controls on controls.client_id = j.client_id
  where j.execution_target = 'ai'
    and j.job_type = 'prepare_build_plan'
    and j.status in ('queued','failed')
    and j.run_after <= now()
    and j.attempts < j.max_attempts
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false);

  if due_count = 0 then
    return jsonb_build_object('ok', true, 'due_jobs', 0, 'dispatched', 0, 'reason', 'no_due_jobs');
  end if;

  select decrypted_secret into edge_url
  from vault.decrypted_secrets
  where name = 'nxq_build_plan_edge_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc
  limit 1;

  if nullif(trim(edge_url), '') is null or nullif(trim(worker_token), '') is null then
    return jsonb_build_object(
      'ok', false,
      'configured', false,
      'due_jobs', due_count,
      'dispatched', 0,
      'reason', 'vault_dispatch_secrets_missing'
    );
  end if;

  for dispatch_index in 1..least(due_count, 5) loop
    select net.http_post(
      url := edge_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-nxq-worker-token', worker_token
      ),
      body := jsonb_build_object('source', 'nxq_pg_cron', 'requested_at', now())
    ) into request_id;

    insert into public.automation_audit_log (event_type, actor_type, details)
    values (
      'build_plan_dispatch_requested',
      'backend',
      jsonb_build_object('request_id', request_id, 'due_jobs', due_count)
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'configured', true,
    'due_jobs', due_count,
    'dispatched', least(due_count, 5),
    'ran_at', now()
  );
end;
$$;

revoke all on function public.dispatch_build_plan_worker() from public, anon, authenticated;
grant execute on function public.dispatch_build_plan_worker() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-build-plan-dispatch-every-minute') then
    perform cron.unschedule('nxq-build-plan-dispatch-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'nxq-build-plan-dispatch-every-minute',
  '* * * * *',
  $$select public.dispatch_build_plan_worker();$$
);

comment on function public.dispatch_build_plan_worker() is
  'Automatically wakes the deterministic build-plan worker after approval so normal onboarding requires no second owner action.';
