-- Owner-started, automatically monitored disposable Business lifecycle QA.
--
-- This closes three launch-proof gaps without fabricating success:
--   1) only explicitly QA-only clients can count toward the ten-run gate;
--   2) the owner can create a safe pending APPROVE or DENY test from Launch Readiness;
--   3) completion evidence is derived from tenant-bound database/provider ledgers.
--
-- Starting a run creates database records only. GitHub/Netlify infrastructure is
-- created only if the owner later uses the normal website-setup APPROVE action.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

alter table public.clients
  add column if not exists qa_only boolean not null default false;

-- Preserve the previously known Commerce QA storefront as QA at the client layer too.
update public.clients c
set qa_only=true,
    monthly_price=0,
    billing_status='not_configured',
    billing_provider=null,
    billing_due_at=null,
    billing_overdue_since=null,
    billing_frozen_at=null,
    billing_updated_at=now(),
    updated_at=now()
from public.commerce_storefront_provisioning p
where p.client_id=c.id and p.qa_only=true;

comment on column public.clients.qa_only is
  'Permanent isolation marker for NXQ-owned disposable lifecycle clients. QA clients cannot enter billing or external customer-notification lanes.';

alter table public.qa_lifecycle_runs
  add column if not exists approval_id uuid references public.owner_approval_requests(id) on delete set null,
  add column if not exists target_outcome text check (target_outcome in ('approve','deny')),
  add column if not exists phase text not null default 'legacy_unmonitored',
  add column if not exists monitor_version text,
  add column if not exists deadline_at timestamptz,
  add column if not exists last_evaluated_at timestamptz;

create index if not exists qa_lifecycle_runs_active_monitor_idx
  on public.qa_lifecycle_runs(status, monitor_version, deadline_at)
  where status = 'running';

-- Owners may read QA evidence but cannot insert or edit pass/fail rows directly.
drop policy if exists owner_manage_qa_lifecycle_runs on public.qa_lifecycle_runs;
drop policy if exists owner_read_qa_lifecycle_runs on public.qa_lifecycle_runs;
create policy owner_read_qa_lifecycle_runs
on public.qa_lifecycle_runs for select to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

revoke all on table public.qa_lifecycle_runs from public,anon,authenticated;
grant select on table public.qa_lifecycle_runs to authenticated;
grant select,insert,update,delete on table public.qa_lifecycle_runs to service_role;

-- QA clients must remain outside every billing state and price path.
create or replace function public.enforce_qa_client_nonbillable()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.qa_only and (
    coalesce(new.monthly_price,0) <> 0
    or new.billing_status::text <> 'not_configured'
    or new.billing_provider is not null
    or new.billing_due_at is not null
    or new.billing_overdue_since is not null
    or new.billing_frozen_at is not null
  ) then
    raise exception 'QA-only clients are permanently non-billable.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_qa_client_nonbillable on public.clients;
create trigger enforce_qa_client_nonbillable
before insert or update on public.clients
for each row execute function public.enforce_qa_client_nonbillable();

-- Defense in depth: even a future billing worker cannot create financial artifacts
-- for a QA client without first failing this database-owned invariant.
create or replace function public.block_qa_billing_artifact()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.client_id is not null and exists(
    select 1 from public.clients c where c.id=new.client_id and c.qa_only=true
  ) then
    raise exception 'Billing artifacts are forbidden for QA-only clients.';
  end if;
  return new;
end;
$$;

drop trigger if exists block_qa_payment_records on public.payment_records;
create trigger block_qa_payment_records before insert or update on public.payment_records
for each row execute function public.block_qa_billing_artifact();
drop trigger if exists block_qa_billing_subscriptions on public.billing_subscriptions;
create trigger block_qa_billing_subscriptions before insert or update on public.billing_subscriptions
for each row execute function public.block_qa_billing_artifact();
drop trigger if exists block_qa_billing_payment_attempts on public.billing_payment_attempts;
create trigger block_qa_billing_payment_attempts before insert or update on public.billing_payment_attempts
for each row execute function public.block_qa_billing_artifact();
drop trigger if exists block_qa_billing_notification_events on public.billing_notification_events;
create trigger block_qa_billing_notification_events before insert or update on public.billing_notification_events
for each row execute function public.block_qa_billing_artifact();
drop trigger if exists block_qa_billing_provider_events on public.billing_provider_events;
create trigger block_qa_billing_provider_events before insert or update on public.billing_provider_events
for each row execute function public.block_qa_billing_artifact();

-- In-app records remain available for pipeline diagnostics, but no email, SMS,
-- push, or webhook delivery may target a disposable QA client.
create or replace function public.block_qa_external_notification()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.client_id is not null
     and new.channel <> 'in_app'
     and exists(select 1 from public.clients c where c.id=new.client_id and c.qa_only=true) then
    raise exception 'External notifications are forbidden for QA-only clients.';
  end if;
  return new;
end;
$$;

drop trigger if exists block_qa_external_notification on public.notification_deliveries;
create trigger block_qa_external_notification
before insert or update of client_id,channel on public.notification_deliveries
for each row execute function public.block_qa_external_notification();

revoke all on function public.enforce_qa_client_nonbillable() from public,anon,authenticated;
revoke all on function public.block_qa_billing_artifact() from public,anon,authenticated;
revoke all on function public.block_qa_external_notification() from public,anon,authenticated;

-- Create one pending, disposable Business QA decision. No infrastructure is made
-- here and neither AI nor service-role workers can choose APPROVE or DENY.
create or replace function public.start_disposable_business_qa_run(
  target_outcome text default 'approve',
  target_sequence_group text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  outcome_value text:=lower(btrim(coalesce(target_outcome,'')));
  group_value text;
  sequence_value integer;
  family_uuid uuid;
  tier_uuid uuid;
  client_uuid uuid:=gen_random_uuid();
  run_uuid uuid;
  approval_uuid uuid;
  run_code_value text;
  business_name_value text;
  email_value text;
  report_value text;
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;

  if outcome_value not in ('approve','deny') then
    raise exception 'QA target outcome must be approve or deny.';
  end if;

  group_value:=coalesce(nullif(btrim(target_sequence_group),''),'business-launch-'||to_char(current_date,'YYYYMMDD'));
  if group_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' then
    raise exception 'QA sequence group contains unsupported characters.';
  end if;

  -- Serialize starts so two browser clicks cannot create parallel disposable clients.
  perform pg_advisory_xact_lock(hashtextextended('nxq-disposable-business-qa-runner',0));
  if exists(
    select 1 from public.qa_lifecycle_runs
    where status='running' and monitor_version='disposable-business-v2'
  ) then
    raise exception 'A disposable Business QA run is already active.';
  end if;

  select pf.id,pft.id into family_uuid,tier_uuid
  from public.product_families pf
  join public.product_family_tiers pft on pft.product_family_id=pf.id
  where pf.slug='business' and pf.is_active=true
    and pft.tier_key='growth' and pft.is_active=true
  limit 1;
  if family_uuid is null or tier_uuid is null then
    raise exception 'Active Business Growth catalog records are required for disposable QA.';
  end if;

  select coalesce(max(sequence_number),0)+1 into sequence_value
  from public.qa_lifecycle_runs where sequence_group=group_value;

  insert into public.qa_lifecycle_runs(
    test_kind,status,disposable,sequence_group,sequence_number,target_outcome,
    phase,monitor_version,deadline_at,evidence
  ) values(
    case when outcome_value='approve' then 'business_e2e' else 'deny_path' end,
    'running',true,group_value,sequence_value,outcome_value,
    'awaiting_owner_decision','disposable-business-v2',now()+interval '2 hours',
    jsonb_build_object(
      'runner','owner_started_disposable_business_v2',
      'evidence_policy','database_derived_only',
      'infrastructure_created_at_start',false,
      'billing_allowed',false,
      'external_customer_notifications_allowed',false
    )
  ) returning id,run_code into run_uuid,run_code_value;

  business_name_value:='NXQ QA Disposable '||run_code_value;
  email_value:=lower(replace(run_code_value,'-',''))||'@example.invalid';

  insert into public.clients(
    id,business_name,contact_name,contact_email,contact_phone,business_type,
    service_area,status,monthly_price,notes,product_family_id,product_tier_id,
    client_code,qa_only
  ) values(
    client_uuid,business_name_value,'NXQ QA Operator',email_value,'+1 202-555-0100',
    'Tree Service','Dallas, Plano, and Frisco, Texas','needs_owner_review',0,
    'Disposable NXQ-owned lifecycle QA. Never bill or contact as a customer.',
    family_uuid,tier_uuid,'WEB-'||upper(substr(replace(client_uuid::text,'-',''),1,12)),true
  );

  insert into public.client_intakes(
    client_id,business_name,contact_name,contact_email,contact_phone,business_type,
    services,service_area,desired_style,goals,package_interest,extra_notes,
    ai_summary,ai_missing_info,product_family_slug,product_tier_key
  ) values(
    client_uuid,business_name_value,'NXQ QA Operator',email_value,'+1 202-555-0100',
    'Tree Service','Tree removal, emergency storm cleanup, tree trimming, and stump grinding',
    'Dallas, Plano, and Frisco, Texas','Premium, trustworthy, modern, and conversion-focused',
    'Generate a complete five-page service-business website with clear calls to action.',
    'Growth','Disposable QA intake. All identity and contact data are fictional reserved test values.',
    'Complete synthetic Business Growth intake for autonomous lifecycle validation.','[]'::jsonb,
    'business','growth'
  );

  report_value:=format($report$
NXQ WEB WEBSITE SETUP REPORT
Business name: %s
Industry: Tree Service
Locations: Dallas, Plano, and Frisco, Texas
Business email: %s
Business phone: +1 202-555-0100
Typed signature: NXQ QA Operator
Selected package: Growth - QA billing disabled
Style direction: Premium, trustworthy, modern, and conversion-focused

Services / products:
Tree removal
Emergency storm cleanup
Tree trimming
Stump grinding

Pages / sections needed:
Home
Services
About
Service Areas
Contact

Brand difference / positioning:
Fast response, safety-first crews, clear estimates, and professional cleanup.

Lead handling rules:
Use only reserved fictional QA contact data. Do not send external customer notifications.
$report$,business_name_value,email_value);

  insert into public.owner_approval_requests(
    client_id,request_type,title,summary,recommended_action,risk_level,status,options
  ) values(
    client_uuid,'website_setup_review',
    'Disposable QA '||upper(outcome_value)||' decision · '||run_code_value,
    case when outcome_value='approve'
      then 'APPROVE runs the real isolated Business lifecycle against fictional data. It may create one private GitHub repository and one Netlify QA site.'
      else 'DENY must hard-stop this fictional client with zero project, repository, Netlify site, billing, or external notification infrastructure.' end,
    report_value,'medium','pending',
    jsonb_build_object(
      'actions',jsonb_build_array('accept','deny'),
      'qa_run_id',run_uuid,
      'qa_run_code',run_code_value,
      'target_outcome',outcome_value,
      'disposable',true
    )
  ) returning id into approval_uuid;

  update public.qa_lifecycle_runs
  set client_id=client_uuid,approval_id=approval_uuid,
      evidence=evidence||jsonb_build_object(
        'client_id',client_uuid,
        'approval_id',approval_uuid,
        'fictional_email_domain','example.invalid',
        'reserved_phone_range','202-555-01xx'
      )
  where id=run_uuid;

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(client_uuid,'disposable_business_qa_started','owner',jsonb_build_object(
    'qa_run_id',run_uuid,'qa_run_code',run_code_value,'target_outcome',outcome_value,
    'sequence_group',group_value,'sequence_number',sequence_value,
    'infrastructure_created',false,'owner_decision_pending',true
  ));

  return jsonb_build_object(
    'ok',true,'run_id',run_uuid,'run_code',run_code_value,'client_id',client_uuid,
    'approval_id',approval_uuid,'target_outcome',outcome_value,'status','running',
    'phase','awaiting_owner_decision','sequence_group',group_value,
    'sequence_number',sequence_value,'infrastructure_created',false
  );
end;
$$;

revoke all on function public.start_disposable_business_qa_run(text,text)
from public,anon,authenticated,service_role;
grant execute on function public.start_disposable_business_qa_run(text,text)
to authenticated;

-- Strict evaluation derives every pass/fail input from authoritative linked rows.
-- Caller-supplied evidence booleans are ignored.
create or replace function public.evaluate_qa_lifecycle_run(target_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  run_row public.qa_lifecycle_runs%rowtype;
  client_row public.clients%rowtype;
  approval_row public.owner_approval_requests%rowtype;
  project_row public.projects%rowtype;
  deployment_row public.project_deployment_configs%rowtype;
  website_run_id uuid;
  website_run_status text;
  website_run_commit text;
  checks jsonb:='{}'::jsonb;
  passed boolean:=false;
  duplicate_repo_count integer:=0;
  duplicate_site_count integer:=0;
  unresolved_exceptions integer:=0;
  downstream_projects integer:=0;
  downstream_deployments integer:=0;
  active_jobs integer:=0;
  billing_artifacts integer:=0;
  external_notifications integer:=0;
  preview_verified boolean:=false;
  private_repo_verified boolean:=false;
  production_commit_verified boolean:=false;
  maintenance_started boolean:=false;
  manual_rescue_used boolean:=false;
  cross_client_data_detected boolean:=false;
begin
  select * into run_row from public.qa_lifecycle_runs where id=target_run_id for update;
  if not found then raise exception 'QA run not found.'; end if;
  if not run_row.disposable or run_row.monitor_version<>'disposable-business-v2' then
    raise exception 'Strict v2 evaluator accepts only monitored disposable Business runs.';
  end if;

  if run_row.client_id is not null then
    select * into client_row from public.clients where id=run_row.client_id;
  end if;
  if run_row.approval_id is not null then
    select * into approval_row from public.owner_approval_requests where id=run_row.approval_id;
  end if;
  if run_row.project_id is not null then
    select * into project_row from public.projects where id=run_row.project_id;
    select * into deployment_row from public.project_deployment_configs where project_id=run_row.project_id;
  end if;

  select
    (select count(*) from public.payment_records where client_id=run_row.client_id)+
    (select count(*) from public.billing_subscriptions where client_id=run_row.client_id)+
    (select count(*) from public.billing_payment_attempts where client_id=run_row.client_id)+
    (select count(*) from public.billing_notification_events where client_id=run_row.client_id)+
    (select count(*) from public.billing_provider_events where client_id=run_row.client_id)
  into billing_artifacts;
  select count(*) into external_notifications from public.notification_deliveries
  where client_id=run_row.client_id and channel<>'in_app';
  select exists(
    select 1 from public.automation_audit_log a
    where a.client_id=run_row.client_id and a.actor_type='owner'
      and a.event_type not in ('disposable_business_qa_started','website_setup_owner_approved')
      and a.created_at>=run_row.started_at
  ) into manual_rescue_used;

  if run_row.test_kind='business_e2e' and run_row.target_outcome='approve' then
    if client_row.id is null or project_row.id is null or deployment_row.project_id is null then
      checks:=jsonb_build_object(
        'evidence_source','derived_database_evidence_v2',
        'qa_client_exists',client_row.id is not null,
        'qa_only_client',coalesce(client_row.qa_only,false),
        'project_exists',project_row.id is not null,
        'deployment_exists',deployment_row.project_id is not null,
        'billing_artifacts_zero',billing_artifacts=0,
        'external_notifications_zero',external_notifications=0
      );
      passed:=false;
    else
      select id,status,latest_commit_sha into website_run_id,website_run_status,website_run_commit
      from public.website_automation_runs
      where client_id=client_row.id and project_id=project_row.id
      order by created_at desc limit 1;

      select count(*) into duplicate_repo_count from public.project_deployment_configs d
      where d.project_id<>project_row.id and d.github_owner=deployment_row.github_owner
        and d.github_repo=deployment_row.github_repo and nullif(d.github_repo,'') is not null;
      select count(*) into duplicate_site_count from public.project_deployment_configs d
      where d.project_id<>project_row.id and d.netlify_site_id=deployment_row.netlify_site_id
        and nullif(d.netlify_site_id,'') is not null;
      select count(*) into unresolved_exceptions from public.automation_jobs j
      where j.client_id=client_row.id and ((j.status='failed' and j.attempts>=j.max_attempts) or j.status='blocked');

      private_repo_verified:=exists(
        select 1 from public.automation_jobs j
        where j.client_id=client_row.id and j.project_id=project_row.id
          and j.job_type='provision_project_infrastructure' and j.status='completed'
          and coalesce((j.result->>'github_repository_private_verified')::boolean,false)=true
          and j.result->>'github_full_name'=deployment_row.github_owner||'/'||deployment_row.github_repo
      );

      preview_verified:=website_run_id is not null and exists(
        select 1 from public.website_automation_steps s
        where s.run_id=website_run_id and s.step_key='client_review' and s.status='completed'
          and nullif(s.output->>'preview_url','') like 'https://%'
          and coalesce((s.output->>'automatic_preview_validation')::boolean,false)=true
      );
      production_commit_verified:=website_run_status='published'
        and nullif(website_run_commit,'') is not null
        and website_run_commit=deployment_row.last_deployed_commit
        and exists(
          select 1 from public.project_deployments pd
          where pd.project_id=project_row.id and pd.client_id=client_row.id
            and pd.deploy_kind='production' and pd.status='published'
            and pd.git_commit_sha=website_run_commit and nullif(pd.deploy_url,'') like 'https://%'
        );
      maintenance_started:=exists(
        select 1 from public.website_maintenance_plans mp
        where mp.client_id=client_row.id and mp.project_id=project_row.id and mp.status='active'
          and nullif(mp.monitored_url,'')=deployment_row.production_url
      );
      cross_client_data_detected:=project_row.client_id<>client_row.id
        or deployment_row.client_id<>client_row.id
        or exists(select 1 from public.website_automation_runs wr where wr.id=website_run_id and (wr.client_id<>client_row.id or wr.project_id<>project_row.id))
        or exists(select 1 from public.project_deployments pd where pd.project_id=project_row.id and pd.client_id<>client_row.id);

      checks:=jsonb_build_object(
        'evidence_source','derived_database_evidence_v2',
        'qa_only_client',client_row.qa_only,
        'run_client_bound',run_row.client_id=client_row.id,
        'approval_bound',approval_row.id=run_row.approval_id and approval_row.client_id=client_row.id
          and approval_row.request_type='website_setup_review' and approval_row.status='accepted',
        'client_approved_or_active',client_row.status::text in ('approved','active'),
        'project_belongs_to_client',project_row.client_id=client_row.id,
        'deployment_project_matches',deployment_row.project_id=project_row.id and deployment_row.client_id=client_row.id,
        'private_repo_recorded',nullif(deployment_row.github_owner,'') is not null and nullif(deployment_row.github_repo,'') is not null,
        'private_repo_verified',private_repo_verified,
        'netlify_site_recorded',nullif(deployment_row.netlify_site_id,'') is not null,
        'production_verified',deployment_row.last_deployment_status='published'
          and nullif(deployment_row.last_deployed_commit,'') is not null and deployment_row.production_url like 'https://%',
        'repo_unique',duplicate_repo_count=0,
        'netlify_site_unique',duplicate_site_count=0,
        'no_exhausted_or_blocked_jobs',unresolved_exceptions=0,
        'preview_verified',preview_verified,
        'production_commit_verified',production_commit_verified,
        'maintenance_started',maintenance_started,
        'manual_rescue_used',manual_rescue_used,
        'cross_client_data_detected',cross_client_data_detected,
        'billing_artifacts_zero',billing_artifacts=0,
        'external_notifications_zero',external_notifications=0
      );
      passed:=(checks->>'qa_only_client')::boolean
        and (checks->>'run_client_bound')::boolean and (checks->>'approval_bound')::boolean
        and (checks->>'client_approved_or_active')::boolean and (checks->>'project_belongs_to_client')::boolean
        and (checks->>'deployment_project_matches')::boolean and (checks->>'private_repo_recorded')::boolean
        and (checks->>'private_repo_verified')::boolean and (checks->>'netlify_site_recorded')::boolean and (checks->>'production_verified')::boolean
        and (checks->>'repo_unique')::boolean and (checks->>'netlify_site_unique')::boolean
        and (checks->>'no_exhausted_or_blocked_jobs')::boolean and (checks->>'preview_verified')::boolean
        and (checks->>'production_commit_verified')::boolean and (checks->>'maintenance_started')::boolean
        and not (checks->>'manual_rescue_used')::boolean and not (checks->>'cross_client_data_detected')::boolean
        and (checks->>'billing_artifacts_zero')::boolean and (checks->>'external_notifications_zero')::boolean;
    end if;
  elsif run_row.test_kind='deny_path' and run_row.target_outcome='deny' then
    if client_row.id is null then
      checks:=jsonb_build_object('evidence_source','derived_database_evidence_v2','qa_client_exists',false);
      passed:=false;
    else
      select count(*) into downstream_projects from public.projects p where p.client_id=client_row.id;
      select count(*) into downstream_deployments from public.project_deployment_configs d where d.client_id=client_row.id;
      select count(*) into active_jobs from public.automation_jobs j
      where j.client_id=client_row.id and j.status in ('queued','running','failed','blocked');
      checks:=jsonb_build_object(
        'evidence_source','derived_database_evidence_v2',
        'qa_only_client',client_row.qa_only,
        'run_client_bound',run_row.client_id=client_row.id,
        'denial_approval_bound',approval_row.id=run_row.approval_id and approval_row.client_id=client_row.id
          and approval_row.request_type='website_setup_review' and approval_row.status='denied',
        'client_denied',client_row.status::text='denied' and client_row.pipeline_stopped_at is not null,
        'no_project_created',downstream_projects=0,
        'no_deployment_created',downstream_deployments=0,
        'no_active_downstream_jobs',active_jobs=0,
        'billing_artifacts_zero',billing_artifacts=0,
        'external_notifications_zero',external_notifications=0
      );
      passed:=(checks->>'qa_only_client')::boolean and (checks->>'run_client_bound')::boolean
        and (checks->>'denial_approval_bound')::boolean and (checks->>'client_denied')::boolean
        and (checks->>'no_project_created')::boolean and (checks->>'no_deployment_created')::boolean
        and (checks->>'no_active_downstream_jobs')::boolean and (checks->>'billing_artifacts_zero')::boolean
        and (checks->>'external_notifications_zero')::boolean;
    end if;
  else
    raise exception 'Run kind and target outcome do not match the strict disposable runner.';
  end if;

  update public.qa_lifecycle_runs
  set status=case when passed then 'passed' else 'failed' end,
      phase=case when passed then 'strict_evidence_passed' else 'strict_evidence_failed' end,
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
        'strict_evaluation',checks,'strict_evaluated_at',now(),'caller_evidence_ignored',true
      ),
      failure_reason=case when passed then null else 'Strict database-derived lifecycle evidence did not pass every required invariant.' end,
      last_evaluated_at=now(),completed_at=now()
  where id=run_row.id;

  return jsonb_build_object('ok',passed,'run_id',run_row.id,'test_kind',run_row.test_kind,'checks',checks);
end;
$$;

revoke all on function public.evaluate_qa_lifecycle_run(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.evaluate_qa_lifecycle_run(uuid) to service_role;

create or replace function public.count_strict_clean_business_runs()
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select count(*)::integer
  from public.qa_lifecycle_runs q
  join public.clients c on c.id=q.client_id and c.qa_only=true
  where q.test_kind='business_e2e' and q.target_outcome='approve'
    and q.disposable=true and q.monitor_version='disposable-business-v2'
    and q.status='passed' and q.completed_at is not null
    and coalesce(q.evidence->'strict_evaluation'->>'evidence_source','')='derived_database_evidence_v2'
    and coalesce((q.evidence->'strict_evaluation'->>'qa_only_client')::boolean,false)=true
    and coalesce((q.evidence->'strict_evaluation'->>'production_verified')::boolean,false)=true
    and coalesce((q.evidence->'strict_evaluation'->>'private_repo_verified')::boolean,false)=true
    and coalesce((q.evidence->'strict_evaluation'->>'production_commit_verified')::boolean,false)=true
    and coalesce((q.evidence->'strict_evaluation'->>'maintenance_started')::boolean,false)=true
    and coalesce((q.evidence->'strict_evaluation'->>'manual_rescue_used')::boolean,true)=false
    and coalesce((q.evidence->'strict_evaluation'->>'cross_client_data_detected')::boolean,true)=false
    and coalesce((q.evidence->'strict_evaluation'->>'billing_artifacts_zero')::boolean,false)=true
    and coalesce((q.evidence->'strict_evaluation'->>'external_notifications_zero')::boolean,false)=true;
$$;

revoke all on function public.count_strict_clean_business_runs()
from public,anon,authenticated,service_role;
grant execute on function public.count_strict_clean_business_runs() to service_role;

-- Service scheduler watches real state and calls the strict evaluator only after a
-- terminal decision, complete publication evidence, hard failure, or timeout.
create or replace function public.monitor_disposable_business_qa_runs()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  run_row public.qa_lifecycle_runs%rowtype;
  project_uuid uuid;
  approval_status_value text;
  evaluated_count integer:=0;
  waiting_count integer:=0;
  evaluation jsonb;
begin
  for run_row in
    select * from public.qa_lifecycle_runs
    where status='running' and monitor_version='disposable-business-v2'
    order by started_at for update skip locked
  loop
    begin
      select status::text into approval_status_value
      from public.owner_approval_requests where id=run_row.approval_id;
      select id into project_uuid from public.projects
      where client_id=run_row.client_id order by created_at desc limit 1;

      if project_uuid is not null and run_row.project_id is distinct from project_uuid then
        update public.qa_lifecycle_runs set project_id=project_uuid where id=run_row.id;
        run_row.project_id:=project_uuid;
      end if;

      update public.qa_lifecycle_runs
      set phase=case
        when approval_status_value='pending' then 'awaiting_owner_decision'
        when approval_status_value='accepted' and project_uuid is null then 'approved_awaiting_workspace'
        when approval_status_value='accepted' then 'approved_pipeline_running'
        when approval_status_value='denied' then 'denial_hard_stop_verifying'
        else 'decision_state_invalid'
      end,
      last_evaluated_at=now()
      where id=run_row.id;

      if run_row.deadline_at<=now()
         or (run_row.target_outcome='approve' and approval_status_value='denied')
         or (run_row.target_outcome='deny' and approval_status_value='accepted')
         or exists(
           select 1 from public.automation_jobs j where j.client_id=run_row.client_id
             and ((j.status='failed' and j.attempts>=j.max_attempts) or j.status='blocked')
         )
         or (run_row.target_outcome='deny' and approval_status_value='denied'
           and not exists(select 1 from public.automation_jobs j where j.client_id=run_row.client_id and j.status='running'))
         or (run_row.target_outcome='approve' and approval_status_value='accepted' and project_uuid is not null
           and exists(
             select 1 from public.project_deployment_configs d
             join public.website_automation_runs wr on wr.project_id=d.project_id and wr.client_id=d.client_id
             join public.website_maintenance_plans mp on mp.project_id=d.project_id and mp.client_id=d.client_id
             where d.project_id=project_uuid and d.client_id=run_row.client_id
               and d.last_deployment_status='published' and nullif(d.last_deployed_commit,'') is not null
               and d.production_url like 'https://%' and wr.status='published'
               and wr.latest_commit_sha=d.last_deployed_commit and mp.status='active'
           )) then
        evaluation:=public.evaluate_qa_lifecycle_run(run_row.id);
        evaluated_count:=evaluated_count+1;
      else
        waiting_count:=waiting_count+1;
      end if;
    exception when others then
      update public.qa_lifecycle_runs
      set status='failed',phase='monitor_error',failure_reason=left(sqlerrm,2000),
          last_evaluated_at=now(),completed_at=now(),
          evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('monitor_error',left(sqlerrm,2000),'monitor_error_at',now())
      where id=run_row.id;
      evaluated_count:=evaluated_count+1;
    end;
  end loop;

  return jsonb_build_object('ok',true,'evaluated',evaluated_count,'waiting',waiting_count,'ran_at',now());
end;
$$;

revoke all on function public.monitor_disposable_business_qa_runs()
from public,anon,authenticated,service_role;
grant execute on function public.monitor_disposable_business_qa_runs() to service_role;

-- The strict counter is the sole ten-run writer. The older broad readiness evaluator
-- may still update other checks, but it cannot overwrite this gate with legacy rows.
create or replace function public.protect_strict_ten_run_readiness()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.check_key='ten_clean_runs'
     and coalesce(new.checked_by,'')<>'nxq-strict-qa-readiness-v2' then
    new.status:='unknown';
    new.evidence:=jsonb_build_object(
      'strict_clean_business_e2e_runs',public.count_strict_clean_business_runs(),
      'required',10,'evidence_policy','strict_qa_only_database_derived_v2',
      'legacy_override_rejected',true
    );
    new.checked_by:='nxq-strict-qa-readiness-protector-v2';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_strict_ten_run_readiness on public.launch_readiness_checks;
create trigger protect_strict_ten_run_readiness
before insert or update on public.launch_readiness_checks
for each row execute function public.protect_strict_ten_run_readiness();

create or replace function public.evaluate_strict_ten_run_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  strict_count integer:=public.count_strict_clean_business_runs();
  ready_now boolean;
begin
  ready_now:=strict_count>=10;
  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object(
        'strict_clean_business_e2e_runs',strict_count,'required',10,
        'evidence_policy','strict_qa_only_database_derived_v2'
      ),
      last_checked_at=now(),checked_by='nxq-strict-qa-readiness-v2',updated_at=now()
  where check_key='ten_clean_runs';
  return jsonb_build_object('ok',true,'ready',ready_now,'strict_clean_runs',strict_count,'required',10);
end;
$$;

revoke all on function public.evaluate_strict_ten_run_readiness()
from public,anon,authenticated,service_role;
grant execute on function public.evaluate_strict_ten_run_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-disposable-business-qa-monitor-every-two-minutes') then
    perform cron.unschedule('nxq-disposable-business-qa-monitor-every-two-minutes');
  end if;
  if exists(select 1 from cron.job where jobname='nxq-strict-ten-run-readiness-every-five-minutes') then
    perform cron.unschedule('nxq-strict-ten-run-readiness-every-five-minutes');
  end if;
end $$;

select cron.schedule(
  'nxq-disposable-business-qa-monitor-every-two-minutes','*/2 * * * *',
  $$select public.monitor_disposable_business_qa_runs();$$
);
select cron.schedule(
  'nxq-strict-ten-run-readiness-every-five-minutes','*/5 * * * *',
  $$select public.evaluate_strict_ten_run_readiness();$$
);

comment on function public.start_disposable_business_qa_run(text,text) is
  'Owner-only creation of one fictional pending Business QA decision; creates no provider infrastructure before the normal owner decision.';
comment on function public.evaluate_qa_lifecycle_run(uuid) is
  'Service-only strict QA evaluator. Pass/fail evidence is derived from linked tenant, provider, publication, maintenance, billing, and notification ledgers.';
comment on function public.monitor_disposable_business_qa_runs() is
  'Automatically watches owner-started disposable Business QA and invokes strict evaluation only on terminal database evidence, hard failure, or timeout.';
