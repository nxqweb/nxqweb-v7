-- Wave 18: prove the Business build-plan lane performs protected AI enrichment.
-- The AI adapter may propose copy and an allowlisted visual theme only. NXQ's
-- deterministic worker remains authoritative for approvals, identity, tiers,
-- pages, services, quality requirements, infrastructure, and production safety.

create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

insert into public.nxq_provider_connections(
  provider_key,provider_category,scope_type,status,adapter_version,
  capabilities,required_secret_names,config
)
select
  'business_build_plan_ai','other','global','not_configured','v1',
  array['structured_business_strategy','plain_text_copy','allowlisted_theme_selection','request_fingerprint_echo'],
  array['NXQ_BUILD_PLAN_AI_ADAPTER_URL','NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN'],
  jsonb_build_object(
    'worker','prepare-build-plan',
    'schema_version','nxq-business-build-plan-v1',
    'provider_neutral',true,
    'deterministic_safety_merge',true,
    'may_publish',false,
    'may_change_tiers',false,
    'may_change_infrastructure',false
  )
where not exists(
  select 1 from public.nxq_provider_connections
  where provider_key='business_build_plan_ai' and scope_type='global' and scope_id is null
);

update public.nxq_provider_connections
set capabilities=array['structured_business_strategy','plain_text_copy','allowlisted_theme_selection','request_fingerprint_echo'],
    required_secret_names=array['NXQ_BUILD_PLAN_AI_ADAPTER_URL','NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN'],
    config=jsonb_build_object(
      'worker','prepare-build-plan',
      'schema_version','nxq-business-build-plan-v1',
      'provider_neutral',true,
      'deterministic_safety_merge',true,
      'may_publish',false,
      'may_change_tiers',false,
      'may_change_infrastructure',false
    ),
    updated_at=now()
where provider_key='business_build_plan_ai' and scope_type='global' and scope_id is null;

insert into public.launch_readiness_checks(check_key,category,title,required,status,evidence)
values(
  'business_build_plan_ai_ready',
  'build',
  'Business AI build-plan enrichment runtime proven',
  true,
  'unknown',
  jsonb_build_object('reason','Waiting for a recent validated adapter-backed build plan.')
)
on conflict(check_key) do update set required=true,title=excluded.title,category=excluded.category;

create or replace function public.evaluate_business_build_plan_ai_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,vault
as $$
declare
  dispatcher_ready boolean:=false;
  worker_url_ready boolean:=false;
  worker_token_ready boolean:=false;
  heartbeat_ready boolean:=false;
  adapter_configured boolean:=false;
  schema_proven boolean:=false;
  deterministic_merge_proven boolean:=false;
  successful_enrichment_proven boolean:=false;
  latest_heartbeat timestamptz;
  heartbeat_status text;
  heartbeat_metadata jsonb:='{}'::jsonb;
  latest_success timestamptz;
  ready_now boolean:=false;
begin
  select exists(
    select 1 from cron.job
    where active and jobname='nxq-build-plan-dispatch-every-minute'
  ) into dispatcher_ready;

  select exists(
    select 1 from vault.decrypted_secrets
    where name='nxq_build_plan_edge_url' and nullif(btrim(decrypted_secret),'') is not null
  ) into worker_url_ready;

  select exists(
    select 1 from vault.decrypted_secrets
    where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null
  ) into worker_token_ready;

  select heartbeat_at,status,metadata
  into latest_heartbeat,heartbeat_status,heartbeat_metadata
  from public.automation_worker_heartbeats
  where worker_key='prepare-build-plan'
  order by heartbeat_at desc
  limit 1;

  heartbeat_ready:=latest_heartbeat is not null
    and latest_heartbeat>=now()-interval '15 minutes'
    and heartbeat_status='healthy';
  adapter_configured:=coalesce((heartbeat_metadata->>'adapter_configured')::boolean,false);
  schema_proven:=heartbeat_metadata->>'adapter_schema_version'='nxq-business-build-plan-v1';
  deterministic_merge_proven:=coalesce((heartbeat_metadata->>'deterministic_safety_merge')::boolean,false);

  begin
    latest_success:=nullif(heartbeat_metadata->>'last_success_at','')::timestamptz;
  exception when others then
    latest_success:=null;
  end;
  successful_enrichment_proven:=latest_success is not null
    and latest_success>=now()-interval '30 days'
    and length(coalesce(heartbeat_metadata->>'last_input_fingerprint',''))=64;

  ready_now:=dispatcher_ready
    and worker_url_ready
    and worker_token_ready
    and heartbeat_ready
    and adapter_configured
    and schema_proven
    and deterministic_merge_proven
    and successful_enrichment_proven;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'dispatcher_cron_ready',dispatcher_ready,
        'worker_url_ready',worker_url_ready,
        'worker_token_ready',worker_token_ready,
        'recent_healthy_worker_heartbeat',heartbeat_ready,
        'adapter_configured',adapter_configured,
        'adapter_schema_proven',schema_proven,
        'deterministic_safety_merge_proven',deterministic_merge_proven,
        'successful_enrichment_proven',successful_enrichment_proven,
        'latest_worker_heartbeat',latest_heartbeat,
        'latest_successful_enrichment',latest_success,
        'heartbeat_status',heartbeat_status,
        'worker_metadata',heartbeat_metadata
      ),
      last_checked_at=now(),
      checked_by='nxq-business-build-plan-ai-readiness-v1',
      updated_at=now()
  where check_key='business_build_plan_ai_ready';

  return jsonb_build_object(
    'ok',true,
    'ready',ready_now,
    'dispatcher_cron_ready',dispatcher_ready,
    'worker_url_ready',worker_url_ready,
    'worker_token_ready',worker_token_ready,
    'recent_healthy_worker_heartbeat',heartbeat_ready,
    'adapter_configured',adapter_configured,
    'adapter_schema_proven',schema_proven,
    'deterministic_safety_merge_proven',deterministic_merge_proven,
    'successful_enrichment_proven',successful_enrichment_proven,
    'latest_successful_enrichment',latest_success
  );
end;
$$;

revoke all on function public.evaluate_business_build_plan_ai_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_business_build_plan_ai_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-business-build-plan-ai-readiness-every-five-minutes') then
    perform cron.unschedule('nxq-business-build-plan-ai-readiness-every-five-minutes');
  end if;
end $$;

select cron.schedule(
  'nxq-business-build-plan-ai-readiness-every-five-minutes',
  '*/5 * * * *',
  $$select public.evaluate_business_build_plan_ai_readiness();$$
);

comment on function public.evaluate_business_build_plan_ai_readiness() is
  'Launch readiness requires a recent healthy prepare-build-plan heartbeat plus evidence of a validated provider-neutral AI enrichment merged through deterministic NXQ rules.';
