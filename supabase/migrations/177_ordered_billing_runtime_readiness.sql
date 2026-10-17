-- Wave 17: online billing becomes a required readiness gate only when explicitly enabled.
update public.nxq_provider_connections
set capabilities=array[
      'normalized_payment_events','idempotent_event_ingest','ordered_event_apply',
      'server_mapped_customers','payment_restore','past_due_start'
    ],
    required_secret_names=array['NXQ_BILLING_ADAPTER_TOKEN'],
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'ingest_function','ingest-billing-provider-event',
      'auto_freeze',false,
      'auto_unfreeze_on_verified_payment',true,
      'online_billing_enabled',coalesce((config->>'online_billing_enabled')::boolean,false),
      'customer_resolution','provider_customer_link',
      'event_ordering','provider_occurred_at'
    ),
    updated_at=now()
where provider_key='billing_adapter' and provider_category='payments';

create or replace function public.evaluate_billing_provider_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  connection_row public.nxq_provider_connections%rowtype;
  online_enabled boolean:=false;
  provider_healthy boolean:=false;
  heartbeat_ready boolean:=false;
  customer_mapping_ready boolean:=false;
  latest_heartbeat timestamptz;
  heartbeat_metadata jsonb:='{}'::jsonb;
  active_links integer:=0;
  ready_now boolean:=false;
begin
  select * into connection_row
  from public.nxq_provider_connections
  where provider_category='payments'
    and coalesce((config->>'online_billing_enabled')::boolean,false)=true
    and status<>'disabled'
  order by case when status='healthy' then 0 else 1 end,last_checked_at desc nulls last
  limit 1;

  online_enabled:=connection_row.id is not null;
  if not online_enabled then
    update public.launch_readiness_checks
    set required=false,
        status='not_applicable',
        evidence=jsonb_build_object(
          'online_billing_enabled',false,
          'manual_billing_supported',true,
          'reason','Online billing remains intentionally disabled; manual billing mode is supported.'
        ),
        last_checked_at=now(),
        checked_by='nxq-billing-readiness-v2',
        updated_at=now()
    where check_key='billing_provider_hook_ready';
    return jsonb_build_object('ok',true,'ready',true,'not_applicable',true,'online_billing_enabled',false);
  end if;

  provider_healthy:=connection_row.status='healthy';
  select heartbeat_at,metadata
  into latest_heartbeat,heartbeat_metadata
  from public.automation_worker_heartbeats
  where worker_key='ingest-billing-provider-event' and status='healthy'
  order by heartbeat_at desc
  limit 1;
  heartbeat_ready:=latest_heartbeat is not null
    and latest_heartbeat>=now()-interval '15 minutes'
    and coalesce((heartbeat_metadata->>'server_mapped_customer')::boolean,false)
    and coalesce((heartbeat_metadata->>'ordered_event_apply')::boolean,false);

  select count(*) into active_links
  from public.billing_provider_customer_links
  where provider_key=connection_row.provider_key and status='active';
  customer_mapping_ready:=active_links>0;
  ready_now:=provider_healthy and heartbeat_ready and customer_mapping_ready;

  update public.launch_readiness_checks
  set required=true,
      status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'online_billing_enabled',true,
        'provider_key',connection_row.provider_key,
        'provider_status',connection_row.status,
        'provider_healthy',provider_healthy,
        'recent_hardened_ingest_heartbeat',heartbeat_ready,
        'active_customer_links',active_links,
        'customer_mapping_ready',customer_mapping_ready,
        'latest_worker_heartbeat',latest_heartbeat,
        'auto_freeze',false,
        'auto_unfreeze_on_verified_payment',true
      ),
      last_checked_at=now(),
      checked_by='nxq-billing-readiness-v2',
      updated_at=now()
  where check_key='billing_provider_hook_ready';

  return jsonb_build_object(
    'ok',true,'ready',ready_now,'not_applicable',false,
    'online_billing_enabled',true,'provider_healthy',provider_healthy,
    'recent_hardened_ingest_heartbeat',heartbeat_ready,
    'active_customer_links',active_links
  );
end;
$$;

revoke all on function public.evaluate_billing_provider_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_billing_provider_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-billing-readiness-every-five-minutes') then
    perform cron.unschedule('nxq-billing-readiness-every-five-minutes');
  end if;
end $$;
select cron.schedule('nxq-billing-readiness-every-five-minutes','*/5 * * * *',$$select public.evaluate_billing_provider_readiness();$$);

comment on function public.evaluate_billing_provider_readiness() is 'Online billing is optional until explicitly enabled. Once enabled, launch readiness requires healthy provider state, hardened ingest evidence, and active server-side customer mappings.';
