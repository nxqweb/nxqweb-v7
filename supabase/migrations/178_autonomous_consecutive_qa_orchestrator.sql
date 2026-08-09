-- Wave 18: orchestrate real disposable QA clients and require ten consecutive strict passes.

alter table public.qa_lifecycle_runs
  add column if not exists deadline_at timestamptz,
  add column if not exists monitor_version text not null default 'business-autonomy-v1';

create unique index if not exists qa_one_active_run_per_client_idx
on public.qa_lifecycle_runs(client_id)
where status='running' and client_id is not null;

create or replace function public.owner_register_disposable_qa_client(
  target_client_id uuid,
  target_test_kind text,
  target_sequence_group text default 'business-launch-v1'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  run_id uuid;
  next_sequence integer;
  sequence_name text:=left(regexp_replace(coalesce(target_sequence_group,''),'[^a-zA-Z0-9._-]','','g'),80);
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  if target_test_kind not in ('business_e2e','deny_path') then
    raise exception 'Only business_e2e and deny_path are supported by the autonomous QA monitor.';
  end if;
  if nullif(sequence_name,'') is null then raise exception 'QA sequence group is required.'; end if;

  select * into client_row from public.clients where id=target_client_id for update;
  if not found then raise exception 'QA client not found.'; end if;
  if client_row.business_name is null or client_row.business_name !~* '^NXQ[[:space:]]+QA' then
    raise exception 'Disposable QA clients must use a business name beginning with NXQ QA.';
  end if;
  if exists(select 1 from public.qa_lifecycle_runs where client_id=target_client_id and status='running') then
    raise exception 'This QA client already has an active lifecycle run.';
  end if;

  select coalesce(max(sequence_number),0)+1 into next_sequence
  from public.qa_lifecycle_runs
  where sequence_group=sequence_name and test_kind=target_test_kind;

  insert into public.qa_lifecycle_runs(
    client_id,test_kind,status,disposable,sequence_group,sequence_number,evidence,deadline_at,monitor_version
  ) values (
    target_client_id,target_test_kind,'running',true,sequence_name,next_sequence,
    jsonb_build_object(
      'registered_by_owner',true,
      'real_signup_and_intake_required',true,
      'owner_approval_or_denial_required',true,
      'qa_auto_approval_used',false,
      'manual_rescue_used',false,
      'cross_client_data_detected',false,
      'monitor_version','business-autonomy-v1'
    ),
    now()+interval '6 hours',
    'business-autonomy-v1'
  ) returning id into run_id;

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(target_client_id,'disposable_qa_run_registered','owner',jsonb_build_object(
    'qa_run_id',run_id,'test_kind',target_test_kind,'sequence_group',sequence_name,'sequence_number',next_sequence,
    'auto_approval',false,'external_cleanup_automatic',false
  ));

  return jsonb_build_object('ok',true,'qa_run_id',run_id,'test_kind',target_test_kind,'sequence_group',sequence_name,'sequence_number',next_sequence,'deadline_at',now()+interval '6 hours');
end;
$$;
revoke all on function public.owner_register_disposable_qa_client(uuid,text,text) from public,anon;
grant execute on function public.owner_register_disposable_qa_client(uuid,text,text) to authenticated;

create or replace function public.refresh_active_qa_lifecycle_runs()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  run_row public.qa_lifecycle_runs%rowtype;
  client_status text;
  project_uuid uuid;
  deployment_row public.project_deployment_configs%rowtype;
  automation_run_id uuid;
  automation_run_status text;
  preview_verified boolean:=false;
  production_commit_verified boolean:=false;
  maintenance_started boolean:=false;
  manual_rescue_used boolean:=false;
  cross_client_data_detected boolean:=false;
  terminal_failure boolean:=false;
  evaluated integer:=0;
  monitored integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;

  for run_row in
    select * from public.qa_lifecycle_runs
    where status='running' and disposable=true and test_kind in ('business_e2e','deny_path')
    order by started_at asc
    for update skip locked
  loop
    monitored:=monitored+1;
    select status::text into client_status from public.clients where id=run_row.client_id;

    if run_row.test_kind='deny_path' then
      if client_status='denied' then
        perform public.evaluate_qa_lifecycle_run(run_row.id);
        evaluated:=evaluated+1;
      elsif run_row.deadline_at is not null and run_row.deadline_at<now() then
        update public.qa_lifecycle_runs set status='failed',failure_reason='DENY QA timed out before the client reached denied state.',completed_at=now() where id=run_row.id;
        evaluated:=evaluated+1;
      end if;
      continue;
    end if;

    select id into project_uuid from public.projects where client_id=run_row.client_id order by created_at desc limit 1;
    if project_uuid is not null and run_row.project_id is distinct from project_uuid then
      update public.qa_lifecycle_runs set project_id=project_uuid where id=run_row.id;
    end if;

    preview_verified:=false;
    production_commit_verified:=false;
    maintenance_started:=false;
    manual_rescue_used:=false;
    cross_client_data_detected:=false;
    terminal_failure:=false;
    automation_run_id:=null;
    automation_run_status:=null;
    deployment_row:=null;

    if project_uuid is not null then
      select * into deployment_row from public.project_deployment_configs where project_id=project_uuid;
      select id,status::text into automation_run_id,automation_run_status
      from public.website_automation_runs
      where project_id=project_uuid and client_id=run_row.client_id
      order by created_at desc limit 1;

      if automation_run_id is not null then
        select exists(
          select 1 from public.website_automation_steps
          where run_id=automation_run_id and step_key='client_review' and status='completed'
            and output->>'preview_url' like 'https://%'
        ) into preview_verified;
      end if;

      production_commit_verified:=deployment_row.project_id is not null
        and deployment_row.client_id=run_row.client_id
        and deployment_row.last_deployment_status='published'
        and nullif(deployment_row.last_deployed_commit,'') is not null
        and deployment_row.production_url like 'https://%';

      select exists(
        select 1 from public.website_maintenance_plans
        where project_id=project_uuid and client_id=run_row.client_id and status='active'
      ) into maintenance_started;

      select exists(
        select 1 from public.automation_audit_log
        where client_id=run_row.client_id and project_id=project_uuid
          and created_at>=run_row.started_at
          and actor_type='owner'
          and event_type in ('owner_exception_retry_requested','owner_manual_override','owner_automation_resumed')
      ) into manual_rescue_used;

      cross_client_data_detected:=exists(
        select 1 from public.projects p where p.id=project_uuid and p.client_id<>run_row.client_id
      ) or exists(
        select 1 from public.project_deployment_configs d where d.project_id=project_uuid and d.client_id<>run_row.client_id
      );

      terminal_failure:=coalesce(automation_run_status,'') in ('failed','blocked','cancelled')
        or exists(
          select 1 from public.automation_jobs
          where client_id=run_row.client_id and project_id=project_uuid
            and ((status='failed' and attempts>=max_attempts) or status='blocked')
        );
    end if;

    update public.qa_lifecycle_runs
    set project_id=coalesce(project_uuid,project_id),
        evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
          'monitor_version','business-autonomy-v1',
          'automation_run_id',automation_run_id,
          'automation_run_status',automation_run_status,
          'preview_verified',preview_verified,
          'production_commit_verified',production_commit_verified,
          'maintenance_started',maintenance_started,
          'manual_rescue_used',manual_rescue_used,
          'cross_client_data_detected',cross_client_data_detected,
          'last_monitored_at',now()
        )
    where id=run_row.id;

    if production_commit_verified and preview_verified and maintenance_started then
      perform public.evaluate_qa_lifecycle_run(run_row.id);
      evaluated:=evaluated+1;
    elsif terminal_failure then
      perform public.evaluate_qa_lifecycle_run(run_row.id);
      evaluated:=evaluated+1;
    elsif run_row.deadline_at is not null and run_row.deadline_at<now() then
      update public.qa_lifecycle_runs
      set status='failed',failure_reason='Business E2E QA timed out before verified production and maintenance.',completed_at=now()
      where id=run_row.id;
      evaluated:=evaluated+1;
    end if;
  end loop;

  perform public.evaluate_strict_ten_run_readiness();
  return jsonb_build_object('ok',true,'monitored',monitored,'evaluated',evaluated,'refreshed_at',now());
end;
$$;
revoke all on function public.refresh_active_qa_lifecycle_runs() from public,anon,authenticated;
grant execute on function public.refresh_active_qa_lifecycle_runs() to service_role;

create or replace function public.count_strict_clean_business_runs()
returns integer
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  latest_group text;
  first_nonpass integer;
  consecutive_count integer:=0;
begin
  select sequence_group into latest_group
  from public.qa_lifecycle_runs
  where test_kind='business_e2e' and disposable=true and sequence_group is not null
  order by created_at desc limit 1;
  if latest_group is null then return 0; end if;

  select max(sequence_number) into first_nonpass
  from public.qa_lifecycle_runs
  where test_kind='business_e2e' and disposable=true and sequence_group=latest_group
    and not (
      status='passed'
      and monitor_version='business-autonomy-v1'
      and coalesce((evidence->'strict_evaluation'->>'production_verified')::boolean,false)=true
      and coalesce((evidence->'strict_evaluation'->>'repo_unique')::boolean,false)=true
      and coalesce((evidence->'strict_evaluation'->>'netlify_site_unique')::boolean,false)=true
      and coalesce((evidence->'strict_evaluation'->>'no_exhausted_or_blocked_jobs')::boolean,false)=true
      and coalesce((evidence->'strict_evaluation'->>'manual_rescue_used')::boolean,true)=false
      and coalesce((evidence->'strict_evaluation'->>'cross_client_data_detected')::boolean,true)=false
    );

  select count(*)::integer into consecutive_count
  from public.qa_lifecycle_runs
  where test_kind='business_e2e' and disposable=true and sequence_group=latest_group
    and sequence_number>coalesce(first_nonpass,0)
    and status='passed'
    and monitor_version='business-autonomy-v1'
    and coalesce((evidence->'strict_evaluation'->>'production_verified')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'repo_unique')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'netlify_site_unique')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'no_exhausted_or_blocked_jobs')::boolean,false)=true
    and coalesce((evidence->'strict_evaluation'->>'manual_rescue_used')::boolean,true)=false
    and coalesce((evidence->'strict_evaluation'->>'cross_client_data_detected')::boolean,true)=false;
  return consecutive_count;
end;
$$;
revoke all on function public.count_strict_clean_business_runs() from public,anon,authenticated;
grant execute on function public.count_strict_clean_business_runs() to service_role;

-- Reuse the strict readiness evaluator, now backed by consecutive latest-sequence evidence.
do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-active-qa-monitor-every-minute') then
    perform cron.unschedule('nxq-active-qa-monitor-every-minute');
  end if;
end $$;
select cron.schedule('nxq-active-qa-monitor-every-minute','* * * * *',$$select public.refresh_active_qa_lifecycle_runs();$$);

comment on function public.owner_register_disposable_qa_client(uuid,text,text) is 'Owner registers a real NXQ QA signup for evidence monitoring. It never auto-approves, auto-denies, or deletes external infrastructure.';
comment on function public.refresh_active_qa_lifecycle_runs() is 'Automatically monitors real disposable Business and DENY runs, gathers evidence, and invokes strict evaluation.';
comment on function public.count_strict_clean_business_runs() is 'Counts only consecutive strict passes in the latest Business QA sequence; the first failure resets the consecutive count.';
