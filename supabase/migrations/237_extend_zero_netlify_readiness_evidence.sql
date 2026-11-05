-- Extend the staging-only evidence gate to cover remote Edge Function coverage.
-- Evidence remains service-role-only, expires, and must explicitly prove that
-- production and Netlify were untouched.

alter table public.staging_readiness_evidence_runs
  drop constraint if exists staging_readiness_evidence_runs_check_key_check;

alter table public.staging_readiness_evidence_runs
  add constraint staging_readiness_evidence_runs_check_key_check
  check (check_key in (
    'business_template_ready', 'rls_isolation_passed', 'storage_isolation_passed',
    'domain_flow_passed', 'maintenance_passed', 'workers_deployed'
  ));

create or replace function public.record_staging_readiness_evidence(
  target_check_key text,
  target_suite_version text,
  target_passed_count integer,
  target_failed_count integer,
  target_evidence_digest text,
  target_details jsonb,
  target_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare run_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role staging runner access required.'; end if;
  if target_check_key not in (
    'business_template_ready','rls_isolation_passed','storage_isolation_passed',
    'domain_flow_passed','maintenance_passed','workers_deployed'
  ) then raise exception 'Unsupported staging readiness check.'; end if;
  if coalesce(target_suite_version,'') !~ '^[a-zA-Z0-9._-]{1,80}$' then raise exception 'Invalid suite version.'; end if;
  if coalesce(target_passed_count,0)<=0 or coalesce(target_failed_count,0)<>0 then
    raise exception 'Readiness evidence requires passing checks and zero failures.';
  end if;
  if coalesce(target_evidence_digest,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'A lowercase SHA-256 evidence digest is required.';
  end if;
  if coalesce(target_details->>'environment','')<>'staging'
     or coalesce((target_details->>'production_changed')::boolean,true)
     or coalesce((target_details->>'netlify_calls')::integer,-1)<>0 then
    raise exception 'Evidence must be staging-only and prove production and Netlify were untouched.';
  end if;
  if target_expires_at<=now() or target_expires_at>now()+interval '30 days' then
    raise exception 'Evidence expiry must be within the next 30 days.';
  end if;

  insert into public.staging_readiness_evidence_runs(
    check_key,suite_version,passed_count,failed_count,evidence_digest,details,executed_at,expires_at
  ) values(
    target_check_key,target_suite_version,target_passed_count,target_failed_count,
    target_evidence_digest,target_details,now(),target_expires_at
  )
  on conflict(check_key,evidence_digest) do update set
    suite_version=excluded.suite_version, passed_count=excluded.passed_count,
    failed_count=excluded.failed_count, details=excluded.details,
    executed_at=excluded.executed_at, expires_at=excluded.expires_at
  returning id into run_id;

  update public.launch_readiness_checks
  set status='ready',
      evidence=jsonb_build_object(
        'run_id',run_id,'suite_version',target_suite_version,
        'passed_count',target_passed_count,'failed_count',0,
        'evidence_digest',target_evidence_digest,'environment','staging',
        'production_changed',false,'netlify_calls',0,'expires_at',target_expires_at,
        'server_authoritative',true
      ),
      last_checked_at=now(),checked_by='nxq-staging-evidence-gate-v2',updated_at=now()
  where check_key=target_check_key;

  insert into public.automation_audit_log(event_type,actor_type,details)
  values('staging_readiness_evidence_recorded','automation',jsonb_build_object(
    'check_key',target_check_key,'run_id',run_id,'evidence_digest',target_evidence_digest,
    'production_changed',false,'netlify_calls',0,'secret_values_logged',false
  ));

  return jsonb_build_object('ok',true,'check_key',target_check_key,'run_id',run_id,'expires_at',target_expires_at);
end;
$$;

create or replace function public.evaluate_staging_readiness_evidence()
returns jsonb
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  evidence_key text;
  fresh_run public.staging_readiness_evidence_runs%rowtype;
  migrations_ok boolean:=false;
  vault_ok boolean:=false;
  configured_vault_count integer:=0;
  required_vault_names text[]:=array[
    'nxq_automation_worker_token','nxq_automation_edge_url','nxq_backup_drill_edge_url',
    'nxq_build_plan_edge_url','nxq_business_build_edge_url','nxq_business_production_edge_url',
    'nxq_business_seo_edge_url','nxq_change_classifier_edge_url','nxq_domain_edge_url',
    'nxq_file_scan_edge_url','nxq_maintenance_edge_url','nxq_notification_dispatch_url',
    'nxq_privacy_processor_edge_url','nxq_provider_health_edge_url'
  ];
begin
  migrations_ok:=to_regprocedure(
    'public.record_staging_readiness_evidence(text,text,integer,integer,text,jsonb,timestamp with time zone)'
  ) is not null;

  select count(distinct name) into configured_vault_count
  from vault.decrypted_secrets
  where name=any(required_vault_names) and nullif(btrim(decrypted_secret),'') is not null;
  vault_ok:=configured_vault_count=cardinality(required_vault_names);

  update public.launch_readiness_checks
  set status=case when migrations_ok then 'ready' else 'unknown' end,
      evidence=jsonb_build_object('latest_sentinel','237_extend_zero_netlify_readiness_evidence',
        'applied',migrations_ok,'server_authoritative',true),
      last_checked_at=now(),checked_by='nxq-foundation-readiness-v2',updated_at=now()
  where check_key='migrations_applied';

  update public.launch_readiness_checks
  set status=case when vault_ok then 'ready' else 'unknown' end,
      evidence=jsonb_build_object('configured_name_count',configured_vault_count,
        'required_name_count',cardinality(required_vault_names),'secret_values_returned',false,
        'configured',vault_ok),
      last_checked_at=now(),checked_by='nxq-foundation-readiness-v2',updated_at=now()
  where check_key='vault_configured';

  foreach evidence_key in array array[
    'business_template_ready','rls_isolation_passed','storage_isolation_passed',
    'domain_flow_passed','maintenance_passed','workers_deployed'
  ] loop
    select * into fresh_run from public.staging_readiness_evidence_runs
    where check_key=evidence_key and failed_count=0 and expires_at>now()
    order by executed_at desc limit 1;
    if found then
      update public.launch_readiness_checks
      set status='ready',
          evidence=evidence || jsonb_build_object(
            'run_id',fresh_run.id,'suite_version',fresh_run.suite_version,
            'passed_count',fresh_run.passed_count,'failed_count',0,
            'evidence_digest',fresh_run.evidence_digest,'environment','staging',
            'production_changed',false,'netlify_calls',0,'expires_at',fresh_run.expires_at,
            'server_authoritative',true
          ),
          last_checked_at=now(),checked_by='nxq-staging-evidence-gate-v2',updated_at=now()
      where check_key=evidence_key;
    else
      update public.launch_readiness_checks
      set status='unknown',evidence=jsonb_build_object('fresh_evidence',false,'expired_or_missing',true),
          last_checked_at=now(),checked_by='nxq-staging-evidence-expiry-v2',updated_at=now()
      where check_key=evidence_key;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'migrations_applied',migrations_ok,
    'vault_configured',vault_ok,'secret_values_returned',false,'evaluated_at',now());
end;
$$;

revoke all on function public.record_staging_readiness_evidence(text,text,integer,integer,text,jsonb,timestamptz)
from public,anon,authenticated;
revoke all on function public.evaluate_staging_readiness_evidence() from public,anon,authenticated;
grant execute on function public.record_staging_readiness_evidence(text,text,integer,integer,text,jsonb,timestamptz)
to service_role;
grant execute on function public.evaluate_staging_readiness_evidence() to service_role;

comment on function public.record_staging_readiness_evidence(text,text,integer,integer,text,jsonb,timestamptz) is
  'Service-only staging evidence gate v2. Requires fresh zero-failure evidence and proves zero Netlify calls.';
