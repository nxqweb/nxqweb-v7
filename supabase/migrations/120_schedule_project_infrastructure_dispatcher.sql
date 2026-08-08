-- Automatically wake the project infrastructure Edge worker when due jobs exist.
-- Uses pg_cron + pg_net + Vault. Secret values are never stored in this migration.
-- Required one-time Vault entries before enabling runtime execution:
--   nxq_automation_edge_url      -> full provision-project-infrastructure function URL
--   nxq_automation_worker_token  -> same protected token configured on the Edge Function

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_project_infrastructure_worker()
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
    and j.job_type = 'provision_project_infrastructure'
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
  where name = 'nxq_automation_edge_url'
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

  -- Dispatch a small bounded batch. Each Edge invocation atomically claims one job.
  for dispatch_count in 1..least(due_count, 5) loop
    select net.http_post(
      url := edge_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-nxq-worker-token', worker_token
      ),
      body := jsonb_build_object(
        'source', 'nxq_pg_cron',
        'requested_at', now()
      )
    ) into request_id;

    insert into public.automation_audit_log (event_type, actor_type, details)
    values (
      'project_infrastructure_dispatch_requested',
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

revoke all on function public.dispatch_project_infrastructure_worker() from public, anon, authenticated;
grant execute on function public.dispatch_project_infrastructure_worker() to service_role;

-- Replace only the named NXQ dispatcher schedule.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-project-infrastructure-dispatch-every-minute') then
    perform cron.unschedule('nxq-project-infrastructure-dispatch-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'nxq-project-infrastructure-dispatch-every-minute',
  '* * * * *',
  $$select public.dispatch_project_infrastructure_worker();$$
);

comment on function public.dispatch_project_infrastructure_worker() is
  'Wakes the trusted project infrastructure Edge worker only when due provisioning jobs exist; normal clients require no post-approval owner action.';
