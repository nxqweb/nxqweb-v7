-- Autonomous domain reconciliation foundation.
-- NXQ can assign/verify a domain against Netlify automatically. DNS mutation itself is
-- provider-adapter work: if no registrar adapter is connected, the client gets an
-- action-required state and NXQ keeps rechecking instead of fabricating success.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.client_domains
  add column if not exists automation_state text not null default 'requested',
  add column if not exists automation_enabled boolean not null default true,
  add column if not exists provider_adapter text,
  add column if not exists provider_connection_ref text,
  add column if not exists dns_status text not null default 'unknown',
  add column if not exists ssl_status text not null default 'unknown',
  add column if not exists last_checked_at timestamptz,
  add column if not exists next_check_at timestamptz not null default now(),
  add column if not exists automation_error text,
  add column if not exists action_required_message text;

create index if not exists client_domains_automation_due_idx
  on public.client_domains(automation_enabled, automation_state, next_check_at);

create or replace function public.queue_due_domain_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  domain_row record;
  project_uuid uuid;
  queued_count integer := 0;
  approval_ok boolean;
begin
  for domain_row in
    select d.id, d.client_id, d.domain_name, d.next_check_at
    from public.client_domains d
    join public.clients c on c.id = d.client_id
    left join public.client_automation_controls controls on controls.client_id = d.client_id
    where d.automation_enabled = true
      and d.automation_state <> 'connected'
      and d.next_check_at <= now()
      and c.status::text in ('approved','active')
      and coalesce(controls.automation_enabled, true)
      and not coalesce(controls.automation_paused, false)
    order by d.next_check_at asc
    limit 50
  loop
    select p.id into project_uuid
    from public.projects p
    where p.client_id = domain_row.client_id
    order by p.created_at desc
    limit 1;

    if project_uuid is null then
      update public.client_domains
      set automation_state = 'waiting_for_project',
          automation_error = 'NXQ is waiting for the website project before connecting this domain.',
          next_check_at = now() + interval '15 minutes'
      where id = domain_row.id;
      continue;
    end if;

    select exists (
      select 1 from public.owner_approval_requests a
      where a.client_id = domain_row.client_id
        and a.request_type = 'website_setup_review'
        and a.status = 'accepted'
    ) into approval_ok;

    if not approval_ok then
      update public.client_domains
      set automation_state = 'waiting_for_approval',
          automation_error = 'Accepted website setup approval is required before domain automation can run.',
          next_check_at = now() + interval '30 minutes'
      where id = domain_row.id;
      continue;
    end if;

    perform public.enqueue_automation_job(
      domain_row.client_id,
      project_uuid,
      'domain_reconcile',
      'domain:' || domain_row.id::text || ':reconcile:' || to_char(domain_row.next_check_at, 'YYYYMMDDHH24MI'),
      jsonb_build_object(
        'execution_target', 'edge',
        'requires_external_worker', true,
        'domain_id', domain_row.id,
        'domain_name', domain_row.domain_name,
        'source', 'domain_reconciliation_scheduler'
      ),
      now(),
      35
    );

    update public.client_domains
    set automation_state = case when automation_state = 'requested' then 'queued' else automation_state end,
        next_check_at = now() + interval '15 minutes'
    where id = domain_row.id;

    queued_count := queued_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'queued', queued_count, 'ran_at', now());
end;
$$;

revoke all on function public.queue_due_domain_reconciliation() from public, anon, authenticated;
grant execute on function public.queue_due_domain_reconciliation() to service_role;

create or replace function public.dispatch_domain_reconciliation()
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
  from public.automation_jobs j
  where j.execution_target = 'edge'
    and j.job_type = 'domain_reconcile'
    and j.status in ('queued','failed')
    and j.run_after <= now()
    and j.attempts < j.max_attempts;

  if due_count = 0 then
    return jsonb_build_object('ok', true, 'due_jobs', 0, 'dispatched', false);
  end if;

  select decrypted_secret into worker_url
  from vault.decrypted_secrets
  where name = 'nxq_domain_edge_url'
  order by created_at desc limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc limit 1;

  if nullif(btrim(worker_url), '') is null or nullif(btrim(worker_token), '') is null then
    return jsonb_build_object('ok', false, 'configured', false, 'reason', 'domain_worker_vault_config_missing', 'due_jobs', due_count);
  end if;

  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',worker_token),
    body := jsonb_build_object('source','nxq_domain_cron','requested_at',now())
  ) into request_id;

  insert into public.automation_audit_log (event_type, actor_type, details)
  values ('domain_reconciliation_dispatch_requested','backend',jsonb_build_object('request_id',request_id,'due_jobs',due_count));

  return jsonb_build_object('ok', true, 'configured', true, 'due_jobs', due_count, 'dispatched', true, 'request_id', request_id);
end;
$$;

revoke all on function public.dispatch_domain_reconciliation() from public, anon, authenticated;
grant execute on function public.dispatch_domain_reconciliation() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-domain-reconcile-queue-every-5-minutes') then
    perform cron.unschedule('nxq-domain-reconcile-queue-every-5-minutes');
  end if;
  if exists (select 1 from cron.job where jobname = 'nxq-domain-reconcile-dispatch-every-minute') then
    perform cron.unschedule('nxq-domain-reconcile-dispatch-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'nxq-domain-reconcile-queue-every-5-minutes',
  '*/5 * * * *',
  $$select public.queue_due_domain_reconciliation();$$
);

select cron.schedule(
  'nxq-domain-reconcile-dispatch-every-minute',
  '* * * * *',
  $$select public.dispatch_domain_reconciliation();$$
);

comment on column public.client_domains.automation_state is
  'NXQ domain automation state. Registrar mutation remains provider-adapter work; verification can continue automatically.';