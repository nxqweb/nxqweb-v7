-- Unify change classification with the same protected, provider-neutral model
-- runtime used by Business build-plan generation. Historical migrations remain
-- immutable; this migration replaces the obsolete two-secret adapter contract.

update public.nxq_provider_connections
set required_secret_names=array[
      'NXQ_AI_MODEL_PROVIDER_URL',
      'NXQ_AI_MODEL_PROVIDER_TOKEN',
      'NXQ_AI_MODEL_PROVIDER_MODEL',
      'NXQ_AI_MODEL_PROVIDER_PROTOCOL'
    ],
    adapter_version='v3',
    capabilities=array['structured_change_classification','strict_json_schema','safe_patch_allowlist'],
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'health_adapter_kind','model_provider',
      'shared_model_provider_contract',true,
      'structured_outputs_required',true,
      'production_write_allowed',false
    ),
    status=case when status='disabled' then status else 'not_configured' end,
    last_checked_at=null,
    last_success_at=null,
    last_error=case when status='disabled' then last_error else 'Unified AI model-provider configuration must be revalidated.' end,
    updated_at=now()
where provider_key='change_classifier_ai'
  and scope_type='global'
  and scope_id is null;

create or replace function public.evaluate_change_classifier_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,vault
as $$
declare
  cron_ready boolean:=false;
  worker_url_ready boolean:=false;
  token_ready boolean:=false;
  heartbeat_ready boolean:=false;
  provider_configured boolean:=false;
  provider_call_proven boolean:=false;
  single_router_proven boolean:=false;
  latest_heartbeat timestamptz;
  heartbeat_metadata jsonb:='{}'::jsonb;
  heartbeat_status text;
  ready_now boolean:=false;
begin
  select exists(select 1 from cron.job where active and jobname='nxq-change-classifier-every-minute') into cron_ready;
  select exists(select 1 from vault.decrypted_secrets where name='nxq_change_classifier_edge_url' and nullif(btrim(decrypted_secret),'') is not null) into worker_url_ready;
  select exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null) into token_ready;

  select heartbeat_at,metadata,status
  into latest_heartbeat,heartbeat_metadata,heartbeat_status
  from public.automation_worker_heartbeats
  where worker_key='classify-business-change-request'
  order by heartbeat_at desc
  limit 1;

  heartbeat_ready:=latest_heartbeat is not null
    and latest_heartbeat>=now()-interval '15 minutes'
    and heartbeat_status='healthy';
  provider_configured:=coalesce((heartbeat_metadata->>'provider_configured')::boolean,false);
  select exists(
    select 1
    from public.nxq_provider_connections
    where provider_key='change_classifier_ai'
      and scope_type='global'
      and scope_id is null
      and status='healthy'
      and last_success_at is not null
  ) into provider_call_proven;
  single_router_proven:=heartbeat_metadata->>'routing_authority'='database_trigger';
  ready_now:=cron_ready and worker_url_ready and token_ready and heartbeat_ready and provider_configured and provider_call_proven and single_router_proven;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'dispatcher_cron_ready',cron_ready,
        'worker_url_ready',worker_url_ready,
        'worker_token_ready',token_ready,
        'recent_healthy_worker_heartbeat',heartbeat_ready,
        'provider_configured',provider_configured,
        'provider_call_proven',provider_call_proven,
        'single_routing_authority_proven',single_router_proven,
        'latest_worker_heartbeat',latest_heartbeat,
        'heartbeat_status',heartbeat_status,
        'worker_metadata',heartbeat_metadata
      ),
      last_checked_at=now(),
      checked_by='nxq-change-classifier-readiness-v3',
      updated_at=now()
  where check_key='change_classifier_ready';

  return jsonb_build_object(
    'ok',true,
    'ready',ready_now,
    'dispatcher_cron_ready',cron_ready,
    'worker_url_ready',worker_url_ready,
    'worker_token_ready',token_ready,
    'recent_healthy_worker_heartbeat',heartbeat_ready,
    'provider_configured',provider_configured,
    'provider_call_proven',provider_call_proven,
    'single_routing_authority_proven',single_router_proven,
    'latest_worker_heartbeat',latest_heartbeat
  );
end;
$$;

revoke all on function public.evaluate_change_classifier_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_change_classifier_readiness() to service_role;

insert into public.automation_audit_log(event_type,actor_type,details)
values('change_classifier_provider_contract_unified','system',jsonb_build_object(
  'provider_key','change_classifier_ai',
  'required_secret_names',array['NXQ_AI_MODEL_PROVIDER_URL','NXQ_AI_MODEL_PROVIDER_TOKEN','NXQ_AI_MODEL_PROVIDER_MODEL','NXQ_AI_MODEL_PROVIDER_PROTOCOL'],
  'secret_values_logged',false,
  'production_changed',false
));

comment on function public.evaluate_change_classifier_readiness() is
  'Classifier readiness v3 requires a recent successful unified model-provider call and database-trigger routing authority.';
