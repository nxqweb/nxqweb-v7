-- Wave 15: strict evidence evaluator for disposable autonomous lifecycle QA.
create or replace function public.evaluate_qa_lifecycle_run(target_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  run_row public.qa_lifecycle_runs%rowtype;
  client_row public.clients%rowtype;
  project_row public.projects%rowtype;
  deployment_row public.project_deployment_configs%rowtype;
  checks jsonb:='{}'::jsonb;
  passed boolean:=false;
  duplicate_repo_count integer:=0;
  duplicate_site_count integer:=0;
  unresolved_exceptions integer:=0;
  downstream_projects integer:=0;
  downstream_deployments integer:=0;
  active_jobs integer:=0;
begin
  if auth.role()<>'service_role' and not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;
  select * into run_row from public.qa_lifecycle_runs where id=target_run_id for update;
  if not found then raise exception 'QA run not found.'; end if;
  if not run_row.disposable then raise exception 'Strict launch QA evaluator only accepts disposable runs.'; end if;

  if run_row.client_id is not null then select * into client_row from public.clients where id=run_row.client_id; end if;
  if run_row.project_id is not null then select * into project_row from public.projects where id=run_row.project_id; end if;
  if run_row.project_id is not null then select * into deployment_row from public.project_deployment_configs where project_id=run_row.project_id; end if;

  if run_row.test_kind='business_e2e' then
    if client_row.id is null or project_row.id is null or deployment_row.project_id is null then
      checks:=jsonb_build_object('client_exists',client_row.id is not null,'project_exists',project_row.id is not null,'deployment_exists',deployment_row.project_id is not null);
      passed:=false;
    else
      select count(*) into duplicate_repo_count from public.project_deployment_configs d where d.project_id<>project_row.id and d.github_owner=deployment_row.github_owner and d.github_repo=deployment_row.github_repo and nullif(d.github_repo,'') is not null;
      select count(*) into duplicate_site_count from public.project_deployment_configs d where d.project_id<>project_row.id and d.netlify_site_id=deployment_row.netlify_site_id and nullif(d.netlify_site_id,'') is not null;
      select count(*) into unresolved_exceptions from public.automation_jobs j where j.client_id=client_row.id and ((j.status='failed' and j.attempts>=j.max_attempts) or j.status='blocked');
      checks:=jsonb_build_object(
        'client_approved_or_active',client_row.status::text in ('approved','active'),
        'project_belongs_to_client',project_row.client_id=client_row.id,
        'deployment_project_matches',deployment_row.project_id=project_row.id,
        'private_repo_recorded',nullif(deployment_row.github_owner,'') is not null and nullif(deployment_row.github_repo,'') is not null,
        'netlify_site_recorded',nullif(deployment_row.netlify_site_id,'') is not null,
        'production_verified',deployment_row.last_deployment_status='published' and nullif(deployment_row.last_deployed_commit,'') is not null and deployment_row.production_url like 'https://%',
        'repo_unique',duplicate_repo_count=0,
        'netlify_site_unique',duplicate_site_count=0,
        'no_exhausted_or_blocked_jobs',unresolved_exceptions=0,
        'preview_verified',coalesce((run_row.evidence->>'preview_verified')::boolean,false),
        'production_commit_verified',coalesce((run_row.evidence->>'production_commit_verified')::boolean,false),
        'maintenance_started',coalesce((run_row.evidence->>'maintenance_started')::boolean,false),
        'manual_rescue_used',coalesce((run_row.evidence->>'manual_rescue_used')::boolean,false),
        'cross_client_data_detected',coalesce((run_row.evidence->>'cross_client_data_detected')::boolean,false)
      );
      passed:=(checks->>'client_approved_or_active')::boolean and (checks->>'project_belongs_to_client')::boolean and (checks->>'deployment_project_matches')::boolean and (checks->>'private_repo_recorded')::boolean and (checks->>'netlify_site_recorded')::boolean and (checks->>'production_verified')::boolean and (checks->>'repo_unique')::boolean and (checks->>'netlify_site_unique')::boolean and (checks->>'no_exhausted_or_blocked_jobs')::boolean and (checks->>'preview_verified')::boolean and (checks->>'production_commit_verified')::boolean and (checks->>'maintenance_started')::boolean and not (checks->>'manual_rescue_used')::boolean and not (checks->>'cross_client_data_detected')::boolean;
    end if;
  elsif run_row.test_kind='deny_path' then
    if client_row.id is null then
      checks:=jsonb_build_object('client_exists',false);passed:=false;
    else
      select count(*) into downstream_projects from public.projects p where p.client_id=client_row.id;
      select count(*) into downstream_deployments from public.project_deployment_configs d join public.projects p on p.id=d.project_id where p.client_id=client_row.id;
      select count(*) into active_jobs from public.automation_jobs j where j.client_id=client_row.id and j.status in ('queued','running','failed','blocked');
      checks:=jsonb_build_object('client_denied',client_row.status::text='denied','no_project_created',downstream_projects=0,'no_deployment_created',downstream_deployments=0,'no_active_downstream_jobs',active_jobs=0);
      passed:=(checks->>'client_denied')::boolean and (checks->>'no_project_created')::boolean and (checks->>'no_deployment_created')::boolean and (checks->>'no_active_downstream_jobs')::boolean;
    end if;
  else
    raise exception 'Strict evaluator currently supports business_e2e and deny_path runs.';
  end if;

  update public.qa_lifecycle_runs
  set status=case when passed then 'passed' else 'failed' end,
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('strict_evaluation',checks,'strict_evaluated_at',now()),
      failure_reason=case when passed then null else 'Strict autonomous lifecycle evidence did not pass every required invariant.' end,
      completed_at=now()
  where id=run_row.id;
  return jsonb_build_object('ok',passed,'run_id',run_row.id,'test_kind',run_row.test_kind,'checks',checks);
end;
$$;
revoke all on function public.evaluate_qa_lifecycle_run(uuid) from public,anon;
grant execute on function public.evaluate_qa_lifecycle_run(uuid) to authenticated,service_role;

create or replace function public.count_strict_clean_business_runs()
returns integer language sql stable security definer set search_path=public as $$
  select count(*)::integer from public.qa_lifecycle_runs
  where test_kind='business_e2e' and disposable=true and status='passed'
    and coalesce((evidence->'strict_evaluation'->>'production_verified')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'repo_unique')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'netlify_site_unique')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'no_exhausted_or_blocked_jobs')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'manual_rescue_used')::boolean,true)=false
    and coalesce((evidence->'strict_evaluation'->>'cross_client_data_detected')::boolean,true)=false;
$$;
revoke all on function public.count_strict_clean_business_runs() from public,anon,authenticated;
grant execute on function public.count_strict_clean_business_runs() to service_role;

comment on function public.evaluate_qa_lifecycle_run(uuid) is 'Strictly evaluates disposable Business E2E or DENY QA from database/provider evidence; callers cannot simply mark the run passed.';