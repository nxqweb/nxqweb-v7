-- Automatically continue a successfully built Business website from preview to guarded production.
-- The accepted website_setup_review decision is the single normal owner approval authority.
-- Production still requires saved quality gates, a safe source branch, a fast-forward-only Git promotion,
-- and verification of the exact Netlify production commit.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.queue_business_production_after_preview()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  family_slug text;
  queued_job_id uuid;
begin
  if new.status <> 'preview_ready'
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  if new.source_branch = 'main' then
    raise exception 'Production promotion cannot originate from main.';
  end if;

  if not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.status::text in ('approved','active')
  ) then
    return new;
  end if;

  if not exists (
    select 1 from public.owner_approval_requests a
    where a.client_id = new.client_id
      and a.request_type = 'website_setup_review'
      and a.status = 'accepted'
  ) then
    return new;
  end if;

  select pf.slug into family_slug
  from public.projects p
  left join public.product_families pf on pf.id = p.product_family_id
  where p.id = new.project_id;

  family_slug := coalesce(family_slug, 'business');
  if family_slug <> 'business' then
    return new;
  end if;

  if not exists (
    select 1 from public.website_automation_steps s
    where s.run_id = new.id and s.step_key = 'run_quality_checks' and s.status = 'completed'
  ) then
    return new;
  end if;

  queued_job_id := public.enqueue_automation_job(
    new.client_id,
    new.project_id,
    'website_promote_production',
    'website-run:' || new.id::text || ':promote-production:v1',
    jsonb_build_object(
      'execution_target', 'edge',
      'website_automation_run_id', new.id,
      'source_branch', new.source_branch,
      'requires_external_worker', true,
      'single_owner_approval_source', 'website_setup_review'
    ),
    now(),
    50
  );

  insert into public.automation_audit_log (client_id, project_id, automation_job_id, event_type, details)
  values (
    new.client_id,
    new.project_id,
    queued_job_id,
    'business_production_promotion_queued',
    jsonb_build_object('run_id', new.id, 'source_branch', new.source_branch, 'approval_reused', true)
  );

  return new;
end;
$$;

drop trigger if exists queue_business_production_after_preview on public.website_automation_runs;
create trigger queue_business_production_after_preview
after insert or update of status on public.website_automation_runs
for each row execute function public.queue_business_production_after_preview();

create or replace function public.dispatch_business_production_worker()
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
    and j.job_type in ('website_promote_production','website_check_production')
    and j.status in ('queued','failed')
    and j.run_after <= now()
    and j.attempts < j.max_attempts
    and coalesce(controls.automation_enabled, true)
    and not coalesce(controls.automation_paused, false);

  if due_count = 0 then
    return jsonb_build_object('ok', true, 'due_jobs', 0, 'dispatched', 0);
  end if;

  select decrypted_secret into edge_url
  from vault.decrypted_secrets
  where name = 'nxq_business_production_edge_url'
  order by created_at desc limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc limit 1;

  if nullif(trim(edge_url), '') is null or nullif(trim(worker_token), '') is null then
    return jsonb_build_object('ok', false, 'configured', false, 'due_jobs', due_count, 'reason', 'vault_dispatch_secrets_missing');
  end if;

  for dispatch_count in 1..least(due_count, 5) loop
    select net.http_post(
      url := edge_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-nxq-worker-token', worker_token),
      body := jsonb_build_object('source', 'nxq_pg_cron', 'requested_at', now())
    ) into request_id;

    insert into public.automation_audit_log (event_type, actor_type, details)
    values ('business_production_dispatch_requested', 'backend', jsonb_build_object('request_id', request_id, 'due_jobs', due_count));
  end loop;

  return jsonb_build_object('ok', true, 'configured', true, 'due_jobs', due_count, 'dispatched', least(due_count, 5));
end;
$$;

revoke all on function public.queue_business_production_after_preview() from public, anon, authenticated;
revoke all on function public.dispatch_business_production_worker() from public, anon, authenticated;
grant execute on function public.dispatch_business_production_worker() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-business-production-dispatch-every-minute') then
    perform cron.unschedule('nxq-business-production-dispatch-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'nxq-business-production-dispatch-every-minute',
  '* * * * *',
  $$select public.dispatch_business_production_worker();$$
);
