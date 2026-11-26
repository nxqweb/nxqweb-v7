-- Keep live SEO worker health strict while allowing the staging-only evidence
-- suite's explicit zero-Netlify readiness probe to remain valid until its
-- server-authoritative evidence record expires.

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
  live_heartbeat_ready boolean:=false;
  staging_probe_ready boolean:=false;
  heartbeat_ready boolean:=false;
  latest_live_heartbeat timestamptz;
  probe_evidence public.staging_readiness_evidence_runs%rowtype;
  ready_now boolean:=false;
begin
  ledger_ready:=to_regclass('public.project_seo_refresh_runs') is not null;

  select exists(
    select 1 from cron.job
    where active and jobname='nxq-business-seo-artifacts-every-minute'
  ) into cron_ready;

  select
    exists(select 1 from vault.decrypted_secrets where name='nxq_business_seo_edge_url' and nullif(btrim(decrypted_secret),'') is not null)
    and exists(select 1 from vault.decrypted_secrets where name='nxq_automation_worker_token' and nullif(btrim(decrypted_secret),'') is not null)
  into secrets_ready;

  select max(heartbeat_at) into latest_live_heartbeat
  from public.automation_worker_heartbeats
  where worker_key='build-business-seo-artifacts'
    and execution_target='edge'
    and status='healthy'
    and coalesce(metadata->>'mode','runtime')<>'readiness_probe';

  live_heartbeat_ready:=latest_live_heartbeat is not null
    and latest_live_heartbeat>=now()-interval '15 minutes';

  select * into probe_evidence
  from public.staging_readiness_evidence_runs
  where check_key='workers_deployed'
    and suite_version='zero-netlify-readiness-v2'
    and failed_count=0
    and expires_at>now()
    and coalesce(details->>'environment','')='staging'
    and coalesce(details->>'production_changed','true')='false'
    and coalesce(details->>'netlify_calls','-1')='0'
    and coalesce(details#>>'{checks,seo_publish_lane,worker_reachable}','false')='true'
    and coalesce(details#>>'{checks,seo_publish_lane,job_claimed}','true')='false'
    and coalesce(details#>>'{checks,seo_publish_lane,github_calls}','-1')='0'
    and coalesce(details#>>'{checks,seo_publish_lane,netlify_calls}','-1')='0'
    and coalesce(details#>>'{checks,seo_publish_lane,production_changed}','true')='false'
  order by executed_at desc
  limit 1;
  staging_probe_ready:=found;

  heartbeat_ready:=live_heartbeat_ready or staging_probe_ready;
  ready_now:=ledger_ready and cron_ready and secrets_ready and heartbeat_ready;

  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'ledger_ready',ledger_ready,
        'dispatcher_cron_ready',cron_ready,
        'vault_secrets_ready',secrets_ready,
        'recent_live_worker_heartbeat',live_heartbeat_ready,
        'latest_live_worker_heartbeat',latest_live_heartbeat,
        'live_heartbeat_max_age_minutes',15,
        'bounded_staging_probe_ready',staging_probe_ready,
        'staging_probe_run_id',case when staging_probe_ready then probe_evidence.id else null end,
        'staging_probe_evidence_digest',case when staging_probe_ready then probe_evidence.evidence_digest else null end,
        'staging_probe_expires_at',case when staging_probe_ready then probe_evidence.expires_at else null end,
        'staging_probe_netlify_calls',case when staging_probe_ready then 0 else null end,
        'staging_probe_production_changed',case when staging_probe_ready then false else null end,
        'worker_key','build-business-seo-artifacts',
        'server_authoritative',true
      ),
      last_checked_at=now(),
      checked_by='nxq-seo-publish-readiness-evaluator-v2',
      updated_at=now()
  where check_key='business_seo_publish_lane_ready';

  return jsonb_build_object(
    'ok',true,
    'ready',ready_now,
    'ledger_ready',ledger_ready,
    'dispatcher_cron_ready',cron_ready,
    'vault_secrets_ready',secrets_ready,
    'recent_live_worker_heartbeat',live_heartbeat_ready,
    'latest_live_worker_heartbeat',latest_live_heartbeat,
    'bounded_staging_probe_ready',staging_probe_ready,
    'staging_probe_expires_at',case when staging_probe_ready then probe_evidence.expires_at else null end,
    'netlify_calls',0,
    'production_changed',false,
    'evaluated_at',now()
  );
end;
$$;

revoke all on function public.evaluate_business_seo_publish_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_business_seo_publish_readiness() to service_role;

comment on function public.evaluate_business_seo_publish_readiness() is
  'SEO publish readiness v2 keeps live heartbeats strict and accepts only unexpired, explicit staging zero-Netlify probe evidence.';
