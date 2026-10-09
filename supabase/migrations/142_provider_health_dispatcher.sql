-- Automatic provider-health dispatcher. Secrets remain in Vault/Edge secret storage.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.dispatch_provider_health_checks()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  worker_url text;
  worker_token text;
  due_count integer := 0;
  request_id bigint;
begin
  select count(*) into due_count
  from public.nxq_provider_connections
  where status in ('configured','healthy','degraded','error')
    and (last_checked_at is null or last_checked_at < now() - interval '5 minutes');

  if due_count = 0 then
    return jsonb_build_object('ok', true, 'due_connections', 0, 'dispatched', false);
  end if;

  select decrypted_secret into worker_url
  from vault.decrypted_secrets
  where name = 'nxq_provider_health_edge_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc
  limit 1;

  if nullif(btrim(worker_url), '') is null or nullif(btrim(worker_token), '') is null then
    return jsonb_build_object(
      'ok', false,
      'configured', false,
      'reason', 'provider_health_worker_vault_config_missing',
      'due_connections', due_count
    );
  end if;

  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nxq-worker-token', worker_token
    ),
    body := jsonb_build_object(
      'source', 'nxq_provider_health_cron',
      'requested_at', now(),
      'max_connections', least(due_count, 25)
    )
  ) into request_id;

  insert into public.automation_audit_log (event_type, actor_type, details)
  values (
    'provider_health_dispatch_requested',
    'backend',
    jsonb_build_object('request_id', request_id, 'due_connections', due_count)
  );

  return jsonb_build_object(
    'ok', true,
    'configured', true,
    'due_connections', due_count,
    'dispatched', true,
    'request_id', request_id,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.dispatch_provider_health_checks() from public, anon, authenticated;
grant execute on function public.dispatch_provider_health_checks() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-provider-health-every-five-minutes') then
    perform cron.unschedule('nxq-provider-health-every-five-minutes');
  end if;
end;
$$;

select cron.schedule(
  'nxq-provider-health-every-five-minutes',
  '*/5 * * * *',
  $$select public.dispatch_provider_health_checks();$$
);

comment on function public.dispatch_provider_health_checks() is
  'Wakes the provider-health Edge worker only for stale provider connections. Missing adapter configuration never fabricates healthy status.';
