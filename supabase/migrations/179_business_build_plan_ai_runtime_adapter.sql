-- Wave 19: connect the protected Business build-plan contract to a real,
-- configurable structured-output model runtime. Runtime stays unknown until
-- both the adapter and the authoritative build-plan worker prove a real call.

update public.nxq_provider_connections
set adapter_version='v2-structured-runtime',
    capabilities=array[
      'structured_business_strategy','plain_text_copy','allowlisted_theme_selection',
      'request_fingerprint_echo','strict_json_schema','provider_refusal_detection'
    ],
    required_secret_names=array[
      'NXQ_BUILD_PLAN_AI_ADAPTER_URL','NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN',
      'NXQ_AI_MODEL_PROVIDER_URL','NXQ_AI_MODEL_PROVIDER_TOKEN',
      'NXQ_AI_MODEL_PROVIDER_MODEL','NXQ_AI_MODEL_PROVIDER_PROTOCOL'
    ],
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'runtime_function','generate-business-build-plan',
      'runtime_version','v1-structured-runtime',
      'supported_protocols',jsonb_build_array('openai_responses','openai_chat_completions'),
      'stores_provider_response',false,
      'contact_details_allowed',false,
      'provider_call_required_for_readiness',true
    ),
    status=case when status='healthy' then 'configured' else status end,
    updated_at=now()
where provider_key='business_build_plan_ai' and scope_type='global' and scope_id is null;

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
  build_worker_ready boolean:=false;
  build_schema_proven boolean:=false;
  deterministic_merge_proven boolean:=false;
  successful_enrichment_proven boolean:=false;
  adapter_heartbeat_ready boolean:=false;
  provider_call_proven boolean:=false;
  adapter_schema_proven boolean:=false;
  adapter_task_proven boolean:=false;
  provider_protocol_proven boolean:=false;
  build_heartbeat_at timestamptz;
  build_heartbeat_status text;
  build_metadata jsonb:='{}'::jsonb;
  adapter_heartbeat_at timestamptz;
  adapter_heartbeat_status text;
  adapter_metadata jsonb:='{}'::jsonb;
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
  into build_heartbeat_at,build_heartbeat_status,build_metadata
  from public.automation_worker_heartbeats
  where worker_key='prepare-build-plan'
  order by heartbeat_at desc
  limit 1;

  select heartbeat_at,status,metadata
  into adapter_heartbeat_at,adapter_heartbeat_status,adapter_metadata
  from public.automation_worker_heartbeats
  where worker_key='generate-business-build-plan'
  order by heartbeat_at desc
  limit 1;

  build_worker_ready:=build_heartbeat_at is not null
    and build_heartbeat_at>=now()-interval '15 minutes'
    and build_heartbeat_status='healthy'
    and coalesce((build_metadata->>'adapter_configured')::boolean,false);
  build_schema_proven:=build_metadata->>'adapter_schema_version'='nxq-business-build-plan-v1';
  deterministic_merge_proven:=coalesce((build_metadata->>'deterministic_safety_merge')::boolean,false);

  begin
    latest_success:=nullif(build_metadata->>'last_success_at','')::timestamptz;
  exception when others then
    latest_success:=null;
  end;
  successful_enrichment_proven:=latest_success is not null
    and latest_success>=now()-interval '30 days'
    and length(coalesce(build_metadata->>'last_input_fingerprint',''))=64;

  adapter_heartbeat_ready:=adapter_heartbeat_at is not null
    and adapter_heartbeat_at>=now()-interval '15 minutes'
    and adapter_heartbeat_status='healthy';
  provider_call_proven:=coalesce((adapter_metadata->>'provider_call_proven')::boolean,false)
    and length(coalesce(adapter_metadata->>'last_request_fingerprint',''))=64
    and nullif(adapter_metadata->>'last_success_at','') is not null;
  adapter_schema_proven:=adapter_metadata->>'schema_version'='nxq-business-build-plan-v1';
  adapter_task_proven:=adapter_metadata->>'task_supported'='enrich_business_build_plan_v1';
  provider_protocol_proven:=adapter_metadata->>'provider_protocol' in ('openai_responses','openai_chat_completions');

  ready_now:=dispatcher_ready
    and worker_url_ready
    and worker_token_ready
    and build_worker_ready
    and build_schema_proven
    and deterministic_merge_proven
    and successful_enrichment_proven
    and adapter_heartbeat_ready
    and provider_call_proven
    and adapter_schema_proven
    and adapter_task_proven
    and provider_protocol_proven;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'dispatcher_cron_ready',dispatcher_ready,
        'worker_url_ready',worker_url_ready,
        'worker_token_ready',worker_token_ready,
        'build_worker_ready',build_worker_ready,
        'build_schema_proven',build_schema_proven,
        'deterministic_safety_merge_proven',deterministic_merge_proven,
        'successful_enrichment_proven',successful_enrichment_proven,
        'adapter_heartbeat_ready',adapter_heartbeat_ready,
        'provider_call_proven',provider_call_proven,
        'adapter_schema_proven',adapter_schema_proven,
        'adapter_task_proven',adapter_task_proven,
        'provider_protocol_proven',provider_protocol_proven,
        'latest_build_worker_heartbeat',build_heartbeat_at,
        'latest_adapter_heartbeat',adapter_heartbeat_at,
        'latest_successful_enrichment',latest_success,
        'build_worker_metadata',build_metadata,
        'adapter_metadata',adapter_metadata
      ),
      last_checked_at=now(),
      checked_by='nxq-business-build-plan-ai-readiness-v2',
      updated_at=now()
  where check_key='business_build_plan_ai_ready';

  return jsonb_build_object(
    'ok',true,
    'ready',ready_now,
    'dispatcher_cron_ready',dispatcher_ready,
    'build_worker_ready',build_worker_ready,
    'successful_enrichment_proven',successful_enrichment_proven,
    'adapter_heartbeat_ready',adapter_heartbeat_ready,
    'provider_call_proven',provider_call_proven,
    'provider_protocol_proven',provider_protocol_proven,
    'latest_successful_enrichment',latest_success
  );
end;
$$;

revoke all on function public.evaluate_business_build_plan_ai_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_business_build_plan_ai_readiness() to service_role;

comment on function public.evaluate_business_build_plan_ai_readiness() is
  'Wave 19 readiness requires real structured-output provider evidence from generate-business-build-plan plus the downstream deterministic NXQ safety merge.';
