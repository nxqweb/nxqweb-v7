-- Wave 14: autonomous AI change classifier dispatcher, readiness, and exception visibility.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

insert into public.launch_readiness_checks(check_key,category,title,required)
values ('change_classifier_ready','automation','Website change classifier runtime healthy',true)
on conflict(check_key) do nothing;

create or replace function public.dispatch_change_classifier_if_due()
returns jsonb
language plpgsql
security definer
set search_path=public,net,vault
as $$
declare
  worker_url text;
  worker_token text;
  request_id bigint;
begin
  if not exists(
    select 1 from public.automation_jobs
    where status in ('queued','failed')
      and execution_target='ai'
      and job_type='classify_website_change_request'
      and run_after<=now()
      and attempts<max_attempts
  ) then
    return jsonb_build_object('ok',true,'dispatched',false,'reason','no_due_jobs');
  end if;

  select decrypted_secret into worker_url from vault.decrypted_secrets where name='nxq_change_classifier_edge_url' limit 1;
  select decrypted_secret into worker_token from vault.decrypted_secrets where name='nxq_automation_worker_token' limit 1;
  if nullif(btrim(worker_url),'') is null or nullif(btrim(worker_token),'') is null then
    return jsonb_build_object('ok',false,'dispatched',false,'reason','missing_vault_configuration');
  end if;

  select net.http_post(
    url:=worker_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',worker_token),
    body:='{}'::jsonb,
    timeout_milliseconds:=20000
  ) into request_id;
  return jsonb_build_object('ok',true,'dispatched',true,'request_id',request_id);
end;
$$;
revoke all on function public.dispatch_change_classifier_if_due() from public,anon,authenticated;
grant execute on function public.dispatch_change_classifier_if_due() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-change-classifier-every-minute') then
    perform cron.unschedule('nxq-change-classifier-every-minute');
  end if;
end $$;
select cron.schedule('nxq-change-classifier-every-minute','* * * * *',$$select public.dispatch_change_classifier_if_due();$$);

create or replace function public.evaluate_change_classifier_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,vault
as $$
declare
  cron_ready boolean:=false;
  worker_url_ready boolean:=false;
  adapter_url_ready boolean:=false;
  token_ready boolean:=false;
  heartbeat_ready boolean:=false;
  latest_heartbeat timestamptz;
  ready_now boolean:=false;
begin
  select exists(select 1 from cron.job where active and jobname='nxq-change-classifier-every-minute') into cron_ready;
  select exists(select 1 from vault.decrypted_secrets where name='nxq_change_classifier_edge_url' and nullif(btrim(decrypted_secret),'') is not null) into worker_url_ready;
  -- The classifier adapter itself is an Edge-function environment secret, so runtime readiness
  -- also requires recent healthy worker presence as proof that its protected configuration loaded.
  select exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null) into token_ready;
  select max(heartbeat_at) into latest_heartbeat
  from public.automation_worker_heartbeats
  where worker_key='classify-business-change-request' and status='healthy';
  heartbeat_ready:=latest_heartbeat is not null and latest_heartbeat>=now()-interval '15 minutes';
  adapter_url_ready:=heartbeat_ready;
  ready_now:=cron_ready and worker_url_ready and token_ready and adapter_url_ready and heartbeat_ready;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object('dispatcher_cron_ready',cron_ready,'worker_url_ready',worker_url_ready,'worker_token_ready',token_ready,'classifier_adapter_proven_by_heartbeat',adapter_url_ready,'recent_worker_heartbeat',heartbeat_ready,'latest_worker_heartbeat',latest_heartbeat),
      last_checked_at=now(),checked_by='nxq-change-classifier-readiness',updated_at=now()
  where check_key='change_classifier_ready';
  return jsonb_build_object('ok',true,'ready',ready_now,'latest_worker_heartbeat',latest_heartbeat);
end;
$$;
revoke all on function public.evaluate_change_classifier_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_change_classifier_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-change-classifier-readiness-every-five-minutes') then
    perform cron.unschedule('nxq-change-classifier-readiness-every-five-minutes');
  end if;
end $$;
select cron.schedule('nxq-change-classifier-readiness-every-five-minutes','*/5 * * * *',$$select public.evaluate_change_classifier_readiness();$$);

comment on function public.dispatch_change_classifier_if_due() is 'Vault-backed automatic wake-up for ambiguous Business website change classification.';
comment on function public.evaluate_change_classifier_readiness() is 'Runtime evidence for the AI-assisted change classifier lane; missing evidence remains unknown.';