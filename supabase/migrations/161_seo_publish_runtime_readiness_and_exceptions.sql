-- Wave 10: runtime evidence + owner exception visibility for autonomous Business SEO publishing.

insert into public.launch_readiness_checks(check_key,category,title,required)
values ('business_seo_publish_lane_ready','seo','Business SEO maintenance publish lane runtime healthy',true)
on conflict(check_key) do nothing;

create or replace function public.evaluate_business_seo_publish_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,vault
as $$
declare
  ledger_ready boolean:=false;
  cron_ready boolean:=false;
  secrets_ready boolean:=false;
  heartbeat_ready boolean:=false;
  latest_heartbeat timestamptz;
  ready_now boolean:=false;
begin
  ledger_ready := to_regclass('public.project_seo_refresh_runs') is not null;

  select exists(
    select 1 from cron.job
    where active and jobname='nxq-business-seo-artifacts-every-minute'
  ) into cron_ready;

  select
    exists(select 1 from vault.decrypted_secrets where name='nxq_business_seo_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
  into secrets_ready;

  select max(heartbeat_at) into latest_heartbeat
  from public.automation_worker_heartbeats
  where worker_key='build-business-seo-artifacts'
    and execution_target='edge'
    and status='healthy';

  heartbeat_ready := latest_heartbeat is not null and latest_heartbeat >= now()-interval '15 minutes';
  ready_now := ledger_ready and cron_ready and secrets_ready and heartbeat_ready;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'ledger_ready',ledger_ready,
        'dispatcher_cron_ready',cron_ready,
        'vault_secrets_ready',secrets_ready,
        'recent_worker_heartbeat',heartbeat_ready,
        'latest_worker_heartbeat',latest_heartbeat,
        'worker_key','build-business-seo-artifacts',
        'max_heartbeat_age_minutes',15
      ),
      last_checked_at=now(),
      checked_by='nxq-seo-publish-readiness-evaluator',
      updated_at=now()
  where check_key='business_seo_publish_lane_ready';

  return jsonb_build_object(
    'ok',true,
    'ready',ready_now,
    'ledger_ready',ledger_ready,
    'dispatcher_cron_ready',cron_ready,
    'vault_secrets_ready',secrets_ready,
    'recent_worker_heartbeat',heartbeat_ready,
    'latest_worker_heartbeat',latest_heartbeat,
    'evaluated_at',now()
  );
end;
$$;

revoke all on function public.evaluate_business_seo_publish_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_business_seo_publish_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-seo-publish-readiness-every-five-minutes') then
    perform cron.unschedule('nxq-seo-publish-readiness-every-five-minutes');
  end if;
end $$;
select cron.schedule(
  'nxq-seo-publish-readiness-every-five-minutes',
  '*/5 * * * *',
  $$select public.evaluate_business_seo_publish_readiness();$$
);

create or replace function public.owner_exception_center()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  healthy_clients integer:=0;
  retrying_jobs integer:=0;
  owner_attention integer:=0;
  open_maintenance_alerts integer:=0;
  seo_publish_exceptions integer:=0;
  exception_items jsonb:='[]'::jsonb;
begin
  if not exists(select 1 from public.owner_users where owner_users.auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;

  select count(*) into retrying_jobs
  from public.automation_jobs j
  where j.status in ('queued','failed') and j.attempts>0 and j.attempts<j.max_attempts;

  select count(*) into open_maintenance_alerts
  from public.website_maintenance_alerts a
  where a.status in ('open','acknowledged');

  select count(*) into seo_publish_exceptions
  from public.project_seo_refresh_runs r
  where r.status in ('blocked','failed');

  select count(*) into owner_attention
  from (
    select j.id::text as id from public.automation_jobs j
      where (j.status='failed' and j.attempts>=j.max_attempts) or j.status='blocked'
    union all
    select a.id::text from public.website_maintenance_alerts a
      where a.status in ('open','acknowledged') and a.severity in ('high','critical')
    union all
    select r.id::text from public.project_seo_refresh_runs r
      where r.status in ('blocked','failed')
  ) attention;

  select count(*) into healthy_clients
  from public.clients c
  where c.status::text in ('approved','active')
    and not exists(select 1 from public.website_maintenance_alerts a where a.client_id=c.id and a.status in ('open','acknowledged'))
    and not exists(select 1 from public.automation_jobs j where j.client_id=c.id and ((j.status='failed' and j.attempts>=j.max_attempts) or j.status='blocked'))
    and not exists(select 1 from public.project_seo_refresh_runs r where r.client_id=c.id and r.status in ('blocked','failed'));

  select coalesce(jsonb_agg(item order by sort_at desc),'[]'::jsonb)
  into exception_items
  from (
    select a.created_at as sort_at,
      jsonb_build_object(
        'source','maintenance','id',a.id,'client_id',a.client_id,'project_id',a.project_id,
        'business_name',c.business_name,'severity',a.severity,'status',a.status,
        'title',a.summary,'summary',coalesce(a.details->>'last_error',a.summary),
        'type',a.alert_type,'created_at',a.created_at,'details',a.details
      ) as item
    from public.website_maintenance_alerts a
    join public.clients c on c.id=a.client_id
    where a.status in ('open','acknowledged')

    union all

    select coalesce(j.updated_at,j.created_at) as sort_at,
      jsonb_build_object(
        'source','automation','id',j.id,'client_id',j.client_id,'project_id',j.project_id,
        'business_name',c.business_name,
        'severity',case when j.status='blocked' then 'warning' else 'high' end,
        'status',j.status,
        'title',case when j.status='blocked' then 'Automation is blocked' else 'Automation retries exhausted' end,
        'summary',coalesce(j.last_error,'Automation needs owner attention.'),
        'type',j.job_type,'execution_target',j.execution_target,'attempts',j.attempts,
        'max_attempts',j.max_attempts,'created_at',j.created_at
      ) as item
    from public.automation_jobs j
    join public.clients c on c.id=j.client_id
    where (j.status='failed' and j.attempts>=j.max_attempts) or j.status='blocked'

    union all

    select coalesce(r.updated_at,r.created_at) as sort_at,
      jsonb_build_object(
        'source','seo_publish','id',r.id,'client_id',r.client_id,'project_id',r.project_id,
        'business_name',c.business_name,
        'severity',case when r.status='blocked' then 'warning' else 'high' end,
        'status',r.status,
        'title',case when r.status='blocked' then 'SEO publishing safely stopped' else 'SEO publishing failed' end,
        'summary',coalesce(r.last_error,'The autonomous SEO publish lane needs owner attention.'),
        'type','business_seo_publish','execution_target','edge','created_at',r.created_at,
        'details',jsonb_build_object(
          'source_branch',r.source_branch,
          'base_main_sha',r.base_main_sha,
          'source_head_sha',r.source_head_sha,
          'preview_url',r.preview_url,
          'production_url',r.production_url
        )
      ) as item
    from public.project_seo_refresh_runs r
    join public.clients c on c.id=r.client_id
    where r.status in ('blocked','failed')
  ) x;

  return jsonb_build_object(
    'healthy_clients',healthy_clients,
    'auto_retrying',retrying_jobs,
    'needs_owner_attention',owner_attention,
    'open_maintenance_alerts',open_maintenance_alerts,
    'seo_publish_exceptions',seo_publish_exceptions,
    'exceptions',exception_items,
    'generated_at',now()
  );
end;
$$;

revoke all on function public.owner_exception_center() from public,anon;
grant execute on function public.owner_exception_center() to authenticated,service_role;

comment on function public.evaluate_business_seo_publish_readiness() is 'Required runtime readiness evidence for the guarded autonomous Business SEO maintenance publishing lane.';
comment on function public.owner_exception_center() is 'Owner-only exception read model including maintenance, exhausted automation, and blocked/failed SEO publish runs.';
