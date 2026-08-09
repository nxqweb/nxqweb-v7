-- Wave 19: owner-only QA lifecycle read model for the strict disposable-run orchestrator.
create or replace function public.owner_qa_lifecycle_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  strict_streak integer:=0;
  active_count integer:=0;
  passed_count integer:=0;
  failed_count integer:=0;
  latest_group text;
  runs jsonb:='[]'::jsonb;
  candidates jsonb:='[]'::jsonb;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;

  strict_streak:=public.count_strict_clean_business_runs();
  select sequence_group into latest_group
  from public.qa_lifecycle_runs
  where test_kind='business_e2e' and disposable=true and sequence_group is not null
  order by created_at desc limit 1;

  select count(*) into active_count from public.qa_lifecycle_runs where status='running';
  select count(*) into passed_count from public.qa_lifecycle_runs where status='passed';
  select count(*) into failed_count from public.qa_lifecycle_runs where status='failed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',bounded.id,
    'run_code',bounded.run_code,
    'client_id',bounded.client_id,
    'business_name',bounded.business_name,
    'project_id',bounded.project_id,
    'test_kind',bounded.test_kind,
    'status',bounded.status,
    'disposable',bounded.disposable,
    'sequence_group',bounded.sequence_group,
    'sequence_number',bounded.sequence_number,
    'monitor_version',bounded.monitor_version,
    'evidence',bounded.evidence,
    'failure_reason',bounded.failure_reason,
    'started_at',bounded.started_at,
    'deadline_at',bounded.deadline_at,
    'completed_at',bounded.completed_at
  ) order by bounded.created_at desc),'[]'::jsonb)
  into runs
  from (
    select r.*,c.business_name
    from public.qa_lifecycle_runs r
    left join public.clients c on c.id=r.client_id
    where r.disposable=true
    order by r.created_at desc
    limit 100
  ) bounded;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,
    'business_name',c.business_name,
    'status',c.status,
    'created_at',c.created_at,
    'has_active_run',exists(select 1 from public.qa_lifecycle_runs r where r.client_id=c.id and r.status='running')
  ) order by c.created_at desc),'[]'::jsonb)
  into candidates
  from public.clients c
  where c.business_name ~* '^NXQ[[:space:]]+QA';

  return jsonb_build_object(
    'strict_consecutive_business_runs',strict_streak,
    'required_consecutive_runs',10,
    'latest_sequence_group',latest_group,
    'active_runs',active_count,
    'passed_runs',passed_count,
    'failed_runs',failed_count,
    'runs',runs,
    'candidate_clients',candidates,
    'generated_at',now(),
    'auto_approval_available',false,
    'manual_mark_passed_available',false,
    'automatic_external_cleanup',false
  );
end;
$$;

revoke all on function public.owner_qa_lifecycle_summary() from public,anon;
grant execute on function public.owner_qa_lifecycle_summary() to authenticated;

comment on function public.owner_qa_lifecycle_summary() is 'Owner-only strict QA read model. It exposes a bounded evidence history and registration candidates but never auto-approves or lets the browser mark a run passed.';
