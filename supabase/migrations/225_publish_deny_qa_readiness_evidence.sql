-- Publish strict disposable DENY-path evidence into the launch-readiness gate.
-- The v2 monitor remains the authority: this trigger only mirrors a terminal,
-- database-derived result and marks the gate stale while a new run is active.

create or replace function public.refresh_deny_flow_readiness_after_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  strict_checks jsonb:=coalesce(new.evidence->'strict_evaluation','{}'::jsonb);
  strict_pass boolean:=false;
begin
  if not new.disposable
     or new.test_kind<>'deny_path'
     or new.target_outcome<>'deny'
     or new.monitor_version<>'disposable-business-v2' then
    return new;
  end if;

  strict_pass:=new.status='passed'
    and strict_checks->>'evidence_source'='derived_database_evidence_v2'
    and coalesce((strict_checks->>'qa_only_client')::boolean,false)
    and coalesce((strict_checks->>'run_client_bound')::boolean,false)
    and coalesce((strict_checks->>'denial_approval_bound')::boolean,false)
    and coalesce((strict_checks->>'client_denied')::boolean,false)
    and coalesce((strict_checks->>'no_project_created')::boolean,false)
    and coalesce((strict_checks->>'no_deployment_created')::boolean,false)
    and coalesce((strict_checks->>'no_active_downstream_jobs')::boolean,false)
    and coalesce((strict_checks->>'billing_artifacts_zero')::boolean,false)
    and coalesce((strict_checks->>'external_notifications_zero')::boolean,false);

  update public.launch_readiness_checks
  set status=case when strict_pass then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'qa_run_id',new.id,
        'qa_run_code',new.run_code,
        'monitor_version',new.monitor_version,
        'database_derived',true,
        'strict_pass',strict_pass,
        'checks',strict_checks
      ),
      last_checked_at=now(),
      checked_by='nxq-disposable-deny-readiness-v2',
      updated_at=now()
  where check_key='deny_flow_passed';

  return new;
end;
$$;

revoke all on function public.refresh_deny_flow_readiness_after_run()
from public,anon,authenticated,service_role;

drop trigger if exists refresh_deny_flow_readiness_after_run
on public.qa_lifecycle_runs;
create trigger refresh_deny_flow_readiness_after_run
after insert or update of status,evidence on public.qa_lifecycle_runs
for each row execute function public.refresh_deny_flow_readiness_after_run();

-- Fire the trusted trigger for the latest monitored DENY run so an already
-- completed hard-stop test becomes visible immediately after migration.
update public.qa_lifecycle_runs
set evidence=evidence
where id=(
  select id
  from public.qa_lifecycle_runs
  where disposable=true
    and test_kind='deny_path'
    and target_outcome='deny'
    and monitor_version='disposable-business-v2'
  order by started_at desc
  limit 1
);

comment on function public.refresh_deny_flow_readiness_after_run() is
  'Mirrors strict v2 database-derived DENY-path QA evidence into the deny_flow_passed launch-readiness gate.';
