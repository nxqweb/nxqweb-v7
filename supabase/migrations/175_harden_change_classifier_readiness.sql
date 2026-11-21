-- Wave 16: classifier readiness must prove adapter configuration and single routing authority.
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
  adapter_configured boolean:=false;
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
  adapter_configured:=coalesce((heartbeat_metadata->>'adapter_configured')::boolean,false);
  single_router_proven:=heartbeat_metadata->>'routing_authority'='database_trigger';
  ready_now:=cron_ready and worker_url_ready and token_ready and heartbeat_ready and adapter_configured and single_router_proven;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'dispatcher_cron_ready',cron_ready,
        'worker_url_ready',worker_url_ready,
        'worker_token_ready',token_ready,
        'recent_healthy_worker_heartbeat',heartbeat_ready,
        'adapter_configured',adapter_configured,
        'single_routing_authority_proven',single_router_proven,
        'latest_worker_heartbeat',latest_heartbeat,
        'heartbeat_status',heartbeat_status,
        'worker_metadata',heartbeat_metadata
      ),
      last_checked_at=now(),
      checked_by='nxq-change-classifier-readiness-v2',
      updated_at=now()
  where check_key='change_classifier_ready';

  return jsonb_build_object(
    'ok',true,
    'ready',ready_now,
    'dispatcher_cron_ready',cron_ready,
    'worker_url_ready',worker_url_ready,
    'worker_token_ready',token_ready,
    'recent_healthy_worker_heartbeat',heartbeat_ready,
    'adapter_configured',adapter_configured,
    'single_routing_authority_proven',single_router_proven,
    'latest_worker_heartbeat',latest_heartbeat
  );
end;
$$;

revoke all on function public.evaluate_change_classifier_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_change_classifier_readiness() to service_role;

comment on function public.evaluate_change_classifier_readiness() is 'Classifier readiness v2 requires explicit worker proof that the protected adapter loaded and database triggers remain the single Edge-routing authority.';
