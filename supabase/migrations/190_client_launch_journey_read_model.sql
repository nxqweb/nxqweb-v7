-- Client-facing launch journey derived only from authoritative workflow evidence.
-- This function is read-only: it does not advance automation or manufacture progress.

create or replace function public.current_client_launch_journey()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  project_row public.projects%rowtype;
  approval_row public.owner_approval_requests%rowtype;
  onboarding_row public.client_onboarding_state%rowtype;
  run_row public.website_automation_runs%rowtype;
  deployment_row public.project_deployment_configs%rowtype;
  maintenance_row public.website_maintenance_plans%rowtype;
  domain_row public.client_domains%rowtype;
  intake_exists boolean := false;
  accepted boolean := false;
  denied boolean := false;
  build_plan_ready boolean := false;
  build_ready boolean := false;
  preview_ready boolean := false;
  live_ready boolean := false;
  care_ready boolean := false;
  clean_file_count integer := 0;
  restricted_file_count integer := 0;
  completed_count integer := 0;
  progress_value integer := 0;
  attention_required boolean := false;
  stage_key text := 'setup';
  stage_title text := 'Complete website setup';
  stage_detail text := 'Tell NXQ what your business needs so the project can be reviewed.';
  action_owner text := 'client';
  action_title text := 'Complete website setup';
  action_detail text := 'Finish the setup sheet with your services, goals, contact details, and style direction.';
  action_href text := '/client';
  milestones jsonb;
  requirements jsonb;
begin
  select * into client_row
  from public.clients
  where auth_user_id = auth.uid()
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Client account not found.';
  end if;

  select exists(
    select 1 from public.client_intakes i where i.client_id = client_row.id
  ) into intake_exists;

  select * into project_row
  from public.projects
  where client_id = client_row.id
  order by created_at desc
  limit 1;

  select * into approval_row
  from public.owner_approval_requests
  where client_id = client_row.id and request_type = 'website_setup_review'
  order by created_at desc
  limit 1;

  select * into onboarding_row
  from public.client_onboarding_state
  where client_id = client_row.id;

  if project_row.id is not null then
    select * into run_row
    from public.website_automation_runs
    where client_id = client_row.id and project_id = project_row.id
    order by created_at desc
    limit 1;

    select * into deployment_row
    from public.project_deployment_configs
    where client_id = client_row.id and project_id = project_row.id
    limit 1;

    select * into maintenance_row
    from public.website_maintenance_plans
    where client_id = client_row.id and project_id = project_row.id
    limit 1;
  end if;

  select * into domain_row
  from public.client_domains
  where client_id = client_row.id
  order by requested_at desc
  limit 1;

  select
    count(*) filter (where s.status = 'clean' and s.quarantine_status = 'released'),
    count(*) filter (where s.status in ('queued','scanning','failed') or s.quarantine_status in ('restricted','quarantined'))
  into clean_file_count, restricted_file_count
  from public.client_file_security_scans s
  where s.client_id = client_row.id;

  accepted := approval_row.status::text = 'accepted' or client_row.status::text in ('approved','active','overdue','frozen');
  denied := approval_row.status::text = 'denied' or client_row.status::text = 'denied';
  build_plan_ready := project_row.id is not null and coalesce(project_row.build_plan, '{}'::jsonb) <> '{}'::jsonb;
  build_ready := run_row.status in ('preview_ready','client_review','revision_required','production_audit','ready_for_owner','published');
  preview_ready := run_row.status in ('preview_ready','client_review','revision_required','production_audit','ready_for_owner','published');
  live_ready := deployment_row.last_deployment_status = 'published' or run_row.status = 'published' or project_row.website_status in ('live','maintenance');
  care_ready := live_ready and maintenance_row.status = 'active';

  completed_count :=
    (case when intake_exists then 1 else 0 end) +
    (case when accepted then 1 else 0 end) +
    (case when build_plan_ready then 1 else 0 end) +
    (case when build_ready then 1 else 0 end) +
    (case when live_ready then 1 else 0 end) +
    (case when care_ready then 1 else 0 end);
  progress_value := case when denied then 0 else round((completed_count::numeric / 6) * 100)::integer end;

  if denied then
    stage_key := 'stopped';
    stage_title := 'Website setup was not approved';
    stage_detail := coalesce(client_row.pipeline_stop_reason, 'The project is stopped and no new infrastructure will be created.');
    action_owner := 'client';
    action_title := 'Contact NXQ Web with questions';
    action_detail := 'The setup is stopped. Contact support if you believe the decision needs another look.';
    action_href := 'mailto:websitedesignercontact@protonmail.com';
  elsif client_row.billing_status::text in ('past_due','freeze_review','frozen') then
    attention_required := true;
    stage_key := case when live_ready then 'care' else 'paused' end;
    stage_title := case when client_row.billing_status::text = 'frozen' then 'Website service is paused' else 'Billing needs attention' end;
    stage_detail := 'Review the billing details shown in your portal. NXQ never freezes service without an owner decision.';
    action_owner := 'client';
    action_title := 'Review billing';
    action_detail := 'Open your billing details to see the current status and next step.';
    action_href := '/client/billing';
  elsif not intake_exists then
    attention_required := true;
  elsif onboarding_row.status in ('waiting_for_intake','needs_information')
    or approval_row.status::text = 'more_info_requested' then
    attention_required := true;
    stage_key := 'setup';
    stage_title := 'NXQ needs a little more information';
    stage_detail := coalesce(onboarding_row.next_step, 'Open the setup sheet and answer the requested question.');
    action_owner := 'client';
    action_title := 'Finish requested information';
    action_detail := coalesce(onboarding_row.next_step, 'Open the setup sheet and submit the missing details.');
    action_href := '/client';
  elsif domain_row.id is not null and (
    domain_row.automation_state = 'action_required' or domain_row.action_required_message is not null
  ) then
    attention_required := true;
    stage_key := case when live_ready then 'care' else 'launch' end;
    stage_title := 'Your domain needs one update';
    stage_detail := coalesce(domain_row.action_required_message, 'Your registrar needs a DNS change before the domain can finish connecting.');
    action_owner := 'client';
    action_title := 'Open domain instructions';
    action_detail := coalesce(domain_row.action_required_message, 'Follow the exact registrar instructions shown in Domain status.');
    action_href := '/client/domain';
  elsif care_ready then
    stage_key := 'care';
    stage_title := 'Live and protected';
    stage_detail := 'Your website is live and NXQ maintenance is active.';
    action_owner := 'nxq';
    action_title := 'No action needed';
    action_detail := 'NXQ is monitoring the website and will surface anything that genuinely needs you.';
    action_href := '/client/health';
  elsif live_ready then
    stage_key := 'care';
    stage_title := 'Website is live';
    stage_detail := 'NXQ is finishing the monitoring and maintenance handoff.';
    action_owner := 'nxq';
    action_title := 'NXQ is activating ongoing care';
    action_detail := 'No client action is required right now.';
    action_href := '/client/health';
  elsif preview_ready then
    stage_key := 'launch';
    stage_title := 'Final launch checks';
    stage_detail := 'The website build reached preview and NXQ is completing protected launch checks.';
    action_owner := 'nxq';
    action_title := 'NXQ is finishing launch checks';
    action_detail := 'You will see an action here only if NXQ needs a domain update or clarification.';
    action_href := '/client/health';
  elsif run_row.id is not null then
    stage_key := 'build';
    stage_title := 'Website build in progress';
    stage_detail := coalesce(run_row.current_step, 'NXQ is building and testing your website on a protected branch.');
    action_owner := 'nxq';
    action_title := 'NXQ is building your website';
    action_detail := 'No action is required unless NXQ asks for a specific detail.';
    action_href := '/client/health';
  elsif accepted and build_plan_ready then
    stage_key := 'build';
    stage_title := 'Build is being prepared';
    stage_detail := 'Your approved website plan is ready for the protected build worker.';
    action_owner := 'nxq';
    action_title := 'NXQ is preparing the build';
    action_detail := 'No action is required right now.';
    action_href := '/client/health';
  elsif accepted then
    stage_key := 'plan';
    stage_title := 'Website plan in progress';
    stage_detail := coalesce(onboarding_row.next_step, project_row.next_step, 'NXQ is turning your approved setup into a build plan.');
    action_owner := 'nxq';
    action_title := 'NXQ is preparing your website plan';
    action_detail := 'No action is required unless a specific question appears here.';
    action_href := '/client/health';
  else
    stage_key := 'review';
    stage_title := 'Setup is under review';
    stage_detail := 'NXQ has your setup and the owner decision is the next step.';
    action_owner := 'nxq';
    action_title := 'Waiting for NXQ review';
    action_detail := 'Your information was received. You do not need to resubmit it.';
    action_href := '/client';
  end if;

  milestones := jsonb_build_array(
    jsonb_build_object('key','setup','title','Website setup','status',case when intake_exists then 'complete' else 'current' end,'detail',case when intake_exists then 'Your business details were received.' else 'Complete your business, services, goals, and style details.' end),
    jsonb_build_object('key','review','title','NXQ review','status',case when denied then 'stopped' when accepted then 'complete' when intake_exists then 'current' else 'upcoming' end,'detail',case when denied then 'The project was not approved.' when accepted then 'The website setup was approved.' else 'NXQ reviews the setup before automation begins.' end),
    jsonb_build_object('key','plan','title','Website plan','status',case when denied then 'stopped' when build_plan_ready then 'complete' when accepted then 'current' else 'upcoming' end,'detail','NXQ converts the approved setup into a structured build plan.'),
    jsonb_build_object('key','build','title','Protected build','status',case when denied then 'stopped' when build_ready then 'complete' when run_row.id is not null or build_plan_ready then 'current' else 'upcoming' end,'detail','The website is generated and tested away from production.'),
    jsonb_build_object('key','launch','title','Launch','status',case when denied then 'stopped' when live_ready then 'complete' when preview_ready then 'current' else 'upcoming' end,'detail','NXQ verifies the preview, deployment, domain, and production evidence.'),
    jsonb_build_object('key','care','title','Ongoing care','status',case when denied then 'stopped' when care_ready then 'complete' when live_ready then 'current' else 'upcoming' end,'detail','Monitoring, maintenance, security, SEO, and reporting continue after launch.')
  );

  requirements := jsonb_build_array(
    jsonb_build_object('key','setup','title','Website setup details','status',case when intake_exists then 'complete' else 'action_required' end,'detail',case when intake_exists then 'Received by NXQ.' else 'Required before review can begin.' end,'href','/client'),
    jsonb_build_object('key','more_info','title','Requested follow-up','status',case when onboarding_row.status in ('waiting_for_intake','needs_information') or approval_row.status::text='more_info_requested' then 'action_required' else 'complete' end,'detail',case when onboarding_row.status in ('waiting_for_intake','needs_information') then coalesce(onboarding_row.next_step,'NXQ needs more information.') when approval_row.status::text='more_info_requested' then 'Answer the specific question in your setup sheet.' else 'Nothing else is requested right now.' end,'href','/client'),
    jsonb_build_object('key','assets','title','Logos, photos, and brand files','status',case when restricted_file_count>0 then 'processing' when clean_file_count>0 then 'complete' else 'optional' end,'detail',case when restricted_file_count>0 then restricted_file_count||' file(s) are still in security review.' when clean_file_count>0 then clean_file_count||' secure file(s) are ready for NXQ.' else 'Optional unless NXQ asks for a specific asset.' end,'href','/client/files'),
    jsonb_build_object('key','domain','title','Domain connection','status',case when domain_row.id is null then 'optional' when domain_row.automation_state='connected' and domain_row.ssl_status='ready' then 'complete' when domain_row.automation_state='action_required' or domain_row.action_required_message is not null then 'action_required' else 'processing' end,'detail',case when domain_row.id is null then 'You can submit a domain now or connect one later.' when domain_row.automation_state='connected' and domain_row.ssl_status='ready' then domain_row.domain_name||' is connected with SSL.' when domain_row.automation_state='action_required' or domain_row.action_required_message is not null then coalesce(domain_row.action_required_message,'Your registrar needs a DNS update.') else 'NXQ is checking '||domain_row.domain_name||' automatically.' end,'href','/client/domain'),
    jsonb_build_object('key','billing','title','Billing','status',case when client_row.billing_status::text='active' then 'complete' when client_row.billing_status::text in ('past_due','freeze_review','frozen') then 'action_required' else 'processing' end,'detail',case when client_row.billing_status::text='active' then 'Billing is active.' when client_row.billing_status::text in ('past_due','freeze_review','frozen') then 'Open billing details to review the current status.' else 'NXQ will show an action when billing setup is available.' end,'href','/client/billing')
  );

  return jsonb_build_object(
    'client_id', client_row.id,
    'business_name', client_row.business_name,
    'client_status', client_row.status,
    'project_id', project_row.id,
    'stage_key', stage_key,
    'stage_title', stage_title,
    'stage_detail', stage_detail,
    'progress_percent', progress_value,
    'attention_required', attention_required,
    'next_action', jsonb_build_object('owner',action_owner,'title',action_title,'detail',action_detail,'href',action_href),
    'milestones', milestones,
    'requirements', requirements,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.current_client_launch_journey() from public, anon;
grant execute on function public.current_client_launch_journey() to authenticated, service_role;

comment on function public.current_client_launch_journey() is
  'Tenant-derived, read-only client launch timeline and action checklist based on real onboarding, approval, build, deployment, domain, billing, file-security, and maintenance evidence.';
