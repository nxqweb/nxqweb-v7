-- Automatically wake the NXQ Business website build/preview worker.
-- Secret values remain in Vault and are not stored in source control.
-- Required one-time Vault entry:
--   nxq_business_build_edge_url -> full build-business-website Edge Function URL
-- Reuses nxq_automation_worker_token from the shared automation layer.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.dispatch_business_website_worker()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  edge_url text;
  worker_token text;
  due_count integer := 0;
  dispatch_count integer := 0;
  request_id bigint;
begin
  select count(*) into due_count
  from public.automation_jobs j
  left join public.client_automation_controls controls on controls.client_id = j.client_id
  where j.execution_target = 'edge'
    and j.job_type in ('website_prepare_safe_branch','website_check_preview')
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
  where name = 'nxq_business_build_edge_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc
  limit 1;

  if nullif(trim(edge_url), '') is null or nullif(trim(worker_token), '') is null then
    return jsonb_build_object('ok', false, 'configured', false, 'due_jobs', due_count, 'dispatched', 0, 'reason', 'vault_dispatch_secrets_missing');
  end if;

  for dispatch_count in 1..least(due_count, 5) loop
    select net.http_post(
      url := edge_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-nxq-worker-token', worker_token),
      body := jsonb_build_object('source', 'nxq_pg_cron', 'requested_at', now())
    ) into request_id;

    insert into public.automation_audit_log (event_type, actor_type, details)
    values (
      'business_website_dispatch_requested',
      'backend',
      jsonb_build_object('request_id', request_id, 'due_jobs', due_count)
    );
  end loop;

  return jsonb_build_object('ok', true, 'configured', true, 'due_jobs', due_count, 'dispatched', least(due_count, 5), 'ran_at', now());
end;
$$;

revoke all on function public.dispatch_business_website_worker() from public, anon, authenticated;
grant execute on function public.dispatch_business_website_worker() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-business-website-dispatch-every-minute') then
    perform cron.unschedule('nxq-business-website-dispatch-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'nxq-business-website-dispatch-every-minute',
  '* * * * *',
  $$select public.dispatch_business_website_worker();$$
);

comment on function public.dispatch_business_website_worker() is
  'Automatically advances approved Business website generation and preview checks without a normal post-approval owner action.';
