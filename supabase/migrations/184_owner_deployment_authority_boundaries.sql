-- Move the remaining owner deployment lifecycle mutations behind narrow,
-- server-authoritative RPCs. Browser code may request an action, but it cannot
-- supply tenant identity, copy provider state, or rewrite lifecycle fields.

create or replace function public.owner_save_deployment_connection(
  target_project_id uuid,
  target_github_owner text default null,
  target_github_repo text default null,
  target_production_branch text default 'main',
  target_netlify_site_id text default null,
  target_production_url text default null,
  target_auto_publish_locked boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  project_row public.projects%rowtype;
  client_row public.clients%rowtype;
  config_row public.project_deployment_configs%rowtype;
  github_owner_value text:=nullif(btrim(coalesce(target_github_owner,'')),'');
  github_repo_value text:=nullif(btrim(coalesce(target_github_repo,'')),'');
  branch_value text:=btrim(coalesce(target_production_branch,'main'));
  site_value text:=nullif(btrim(coalesce(target_netlify_site_id,'')),'');
  url_value text:=nullif(btrim(coalesce(target_production_url,'')),'');
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if target_project_id is null then raise exception 'Project id is required.'; end if;
  if target_auto_publish_locked is not true then
    raise exception 'NXQ auto-publish safety lock cannot be disabled from the portal.';
  end if;
  if (github_owner_value is null)<>(github_repo_value is null) then
    raise exception 'GitHub owner and repository must both be set or both be blank.';
  end if;
  if github_owner_value is not null and (
    github_owner_value !~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$'
    or github_repo_value !~ '^[A-Za-z0-9._-]{1,100}$'
  ) then raise exception 'GitHub repository identity contains unsupported characters.'; end if;
  if length(branch_value) not between 1 and 200
     or branch_value !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     or branch_value like '%..%' or branch_value like '%@{%' or branch_value like '%//%'
     or right(branch_value,1) in ('.','/') then
    raise exception 'Production branch is not a valid protected branch name.';
  end if;
  if site_value is not null and (length(site_value)>200 or site_value !~ '^[A-Za-z0-9._-]+$') then
    raise exception 'Netlify site id contains unsupported characters.';
  end if;
  if url_value is not null and (length(url_value)>500 or url_value !~ '^https://[^[:space:]]+$') then
    raise exception 'Production URL must be a valid HTTPS URL.';
  end if;

  select * into project_row from public.projects where id=target_project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  select * into client_row from public.clients where id=project_row.client_id for update;
  if not found then raise exception 'Project client was not found.'; end if;
  if client_row.qa_only then raise exception 'Disposable QA deployment connections are automation-owned.'; end if;
  if client_row.status::text in ('denied','dormant','archived')
     or client_row.pipeline_stopped_at is not null then
    raise exception 'Client lifecycle does not allow deployment configuration.';
  end if;

  insert into public.project_deployment_configs(
    project_id,client_id,github_owner,github_repo,production_branch,
    netlify_site_id,production_url,auto_publish_locked,last_deployment_status
  ) values(
    project_row.id,project_row.client_id,github_owner_value,github_repo_value,
    branch_value,site_value,url_value,true,'not_configured'
  )
  on conflict(project_id) do update set
    github_owner=excluded.github_owner,
    github_repo=excluded.github_repo,
    production_branch=excluded.production_branch,
    netlify_site_id=excluded.netlify_site_id,
    production_url=excluded.production_url,
    auto_publish_locked=true,
    last_verified_at=null,
    last_verification_status='not_checked',
    last_verification_details=null,
    updated_at=now()
  returning * into config_row;

  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(project_row.client_id,project_row.id,'owner_deployment_connection_saved','owner',jsonb_build_object(
    'deployment_config_id',config_row.id,'github_repository_configured',github_owner_value is not null,
    'netlify_site_configured',site_value is not null,'production_url_configured',url_value is not null,
    'auto_publish_locked',true,'provider_action_performed',false,'server_authoritative',true
  ));
  return to_jsonb(config_row);
end;
$$;

create or replace function public.owner_create_preview_request(
  target_deployment_config_id uuid,
  target_source_branch text,
  target_requested_commit_sha text default null,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  config_row public.project_deployment_configs%rowtype;
  client_row public.clients%rowtype;
  request_row public.preview_deployment_requests%rowtype;
  branch_value text:=btrim(coalesce(target_source_branch,''));
  commit_value text:=nullif(lower(btrim(coalesce(target_requested_commit_sha,''))),'');
  note_value text:=nullif(btrim(coalesce(target_note,'')),'');
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  select * into config_row from public.project_deployment_configs
  where id=target_deployment_config_id for update;
  if not found then raise exception 'Deployment connection was not found.'; end if;
  select * into client_row from public.clients where id=config_row.client_id;
  if not found then raise exception 'Deployment client was not found.'; end if;
  if client_row.qa_only then raise exception 'Disposable QA preview requests are automation-owned.'; end if;
  if client_row.status::text in ('denied','dormant','archived') or client_row.pipeline_stopped_at is not null then
    raise exception 'Client lifecycle does not allow preview requests.';
  end if;
  if config_row.project_id is distinct from (
    select p.id from public.projects p where p.id=config_row.project_id and p.client_id=config_row.client_id
  ) then raise exception 'Deployment configuration tenant binding is invalid.'; end if;
  if config_row.auto_publish_locked is not true then raise exception 'Auto-publish safety lock must remain enabled.'; end if;
  if length(branch_value) not between 1 and 200
     or branch_value !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     or lower(branch_value) in ('main',lower(config_row.production_branch))
     or branch_value like '%..%' or branch_value like '%@{%' or branch_value like '%//%'
     or right(branch_value,1) in ('.','/') then
    raise exception 'Preview branch is invalid or matches the protected production branch.';
  end if;
  if commit_value is not null and commit_value !~ '^[a-f0-9]{40}$' then
    raise exception 'Pinned preview commit must be a full 40-character SHA.';
  end if;
  if note_value is not null and length(note_value)>1000 then raise exception 'Preview note is too long.'; end if;

  insert into public.preview_deployment_requests(
    deployment_config_id,project_id,client_id,requested_by,source_branch,
    requested_commit_sha,status,owner_decision_note
  ) values(
    config_row.id,config_row.project_id,config_row.client_id,auth.uid(),branch_value,
    commit_value,'pending_owner_approval',note_value
  ) returning * into request_row;
  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(config_row.client_id,config_row.project_id,'owner_preview_request_created','owner',jsonb_build_object(
    'preview_request_id',request_row.id,'source_branch',branch_value,'commit_pinned',commit_value is not null,
    'provider_action_performed',false,'server_authoritative',true
  ));
  return to_jsonb(request_row);
end;
$$;

create or replace function public.owner_decide_preview_request(
  target_preview_request_id uuid,
  target_decision text,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  request_row public.preview_deployment_requests%rowtype;
  decision_value text:=lower(btrim(coalesce(target_decision,'')));
  note_value text:=nullif(btrim(coalesce(target_note,'')),'');
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if decision_value not in ('approved_for_preview','rejected') then raise exception 'Unsupported preview decision.'; end if;
  if decision_value='rejected' and (note_value is null or length(note_value)<3) then
    raise exception 'A preview rejection reason is required.';
  end if;
  if note_value is not null and length(note_value)>1000 then raise exception 'Preview decision note is too long.'; end if;
  select * into request_row from public.preview_deployment_requests
  where id=target_preview_request_id for update;
  if not found then raise exception 'Preview request was not found.'; end if;
  if request_row.status=decision_value then return to_jsonb(request_row); end if;
  if request_row.status<>'pending_owner_approval' then raise exception 'Only a pending preview request can be decided.'; end if;
  if exists(select 1 from public.clients c where c.id=request_row.client_id and (c.qa_only or c.pipeline_stopped_at is not null)) then
    raise exception 'Client lifecycle does not allow a manual preview decision.';
  end if;
  update public.preview_deployment_requests set
    status=decision_value,owner_decision_by=auth.uid(),owner_decision_at=now(),owner_decision_note=note_value
  where id=request_row.id returning * into request_row;
  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(request_row.client_id,request_row.project_id,'owner_preview_'||decision_value,'owner',jsonb_build_object(
    'preview_request_id',request_row.id,'provider_action_performed',false,'server_authoritative',true
  ));
  return to_jsonb(request_row);
end;
$$;

create or replace function public.owner_create_production_launch_request(target_preview_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  preview_row public.preview_deployment_requests%rowtype;
  config_row public.project_deployment_configs%rowtype;
  launch_row public.production_launch_requests%rowtype;
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  select * into preview_row from public.preview_deployment_requests where id=target_preview_request_id for update;
  if not found then raise exception 'Preview request was not found.'; end if;
  if preview_row.execution_status<>'published' or preview_row.status<>'published'
     or preview_row.preview_url is null or preview_row.preview_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Only a verified published HTTPS preview can create a launch request.';
  end if;
  select * into config_row from public.project_deployment_configs
  where id=preview_row.deployment_config_id and project_id=preview_row.project_id and client_id=preview_row.client_id
  for update;
  if not found then raise exception 'Preview deployment configuration is invalid.'; end if;
  if config_row.auto_publish_locked is not true then raise exception 'Auto-publish safety lock must remain enabled.'; end if;
  if config_row.production_url is not null and config_row.production_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Production URL must use HTTPS.';
  end if;
  if exists(select 1 from public.clients c where c.id=preview_row.client_id and (c.qa_only or c.pipeline_stopped_at is not null)) then
    raise exception 'Client lifecycle does not allow a manual production launch request.';
  end if;
  insert into public.production_launch_requests(
    deployment_config_id,project_id,client_id,preview_request_id,requested_by,
    production_branch,production_url,status
  ) values(
    config_row.id,preview_row.project_id,preview_row.client_id,preview_row.id,auth.uid(),
    config_row.production_branch,config_row.production_url,'audit_required'
  ) returning * into launch_row;
  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(launch_row.client_id,launch_row.project_id,'owner_production_launch_request_created','owner',jsonb_build_object(
    'launch_request_id',launch_row.id,'preview_request_id',preview_row.id,
    'provider_action_performed',false,'server_authoritative',true
  ));
  return to_jsonb(launch_row);
exception when unique_violation then
  raise exception 'This preview already has an active production launch request.';
end;
$$;

create or replace function public.owner_decide_production_launch(
  target_launch_request_id uuid,
  target_decision text,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  launch_row public.production_launch_requests%rowtype;
  decision_value text:=lower(btrim(coalesce(target_decision,'')));
  note_value text:=btrim(coalesce(target_note,''));
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if decision_value not in ('approved_for_production','rejected') then raise exception 'Unsupported launch decision.'; end if;
  if length(note_value) not between 3 and 1000 then raise exception 'A launch decision note is required.'; end if;
  select * into launch_row from public.production_launch_requests
  where id=target_launch_request_id for update;
  if not found then raise exception 'Production launch request was not found.'; end if;
  if launch_row.status=decision_value then return to_jsonb(launch_row); end if;
  if decision_value='approved_for_production' then
    if launch_row.audit_status<>'passed' or launch_row.status not in ('audit_passed','pending_owner_approval') then
      raise exception 'A current passing launch audit is required before approval.';
    end if;
  elsif launch_row.status not in ('audit_required','audit_passed','audit_blocked','pending_owner_approval') then
    raise exception 'Launch request is no longer eligible for rejection.';
  end if;
  if exists(select 1 from public.clients c where c.id=launch_row.client_id and (c.qa_only or c.pipeline_stopped_at is not null)) then
    raise exception 'Client lifecycle does not allow a manual production decision.';
  end if;
  update public.production_launch_requests set
    status=decision_value,owner_decision_by=auth.uid(),owner_decision_at=now(),owner_decision_note=note_value
  where id=launch_row.id returning * into launch_row;
  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(launch_row.client_id,launch_row.project_id,'owner_production_'||decision_value,'owner',jsonb_build_object(
    'launch_request_id',launch_row.id,'provider_action_performed',false,'server_authoritative',true
  ));
  return to_jsonb(launch_row);
end;
$$;

revoke insert,update,delete on public.project_deployment_configs from authenticated;
revoke insert,update,delete on public.project_deployments from authenticated;
revoke insert,update,delete on public.preview_deployment_requests from authenticated;
revoke insert,update,delete on public.production_launch_requests from authenticated;
grant select on public.project_deployment_configs,public.project_deployments,
  public.preview_deployment_requests,public.production_launch_requests to authenticated;

revoke all on function public.owner_save_deployment_connection(uuid,text,text,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.owner_create_preview_request(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.owner_decide_preview_request(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.owner_create_production_launch_request(uuid) from public,anon,authenticated,service_role;
revoke all on function public.owner_decide_production_launch(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.owner_save_deployment_connection(uuid,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.owner_create_preview_request(uuid,text,text,text) to authenticated;
grant execute on function public.owner_decide_preview_request(uuid,text,text) to authenticated;
grant execute on function public.owner_create_production_launch_request(uuid) to authenticated;
grant execute on function public.owner_decide_production_launch(uuid,text,text) to authenticated;

comment on function public.owner_save_deployment_connection(uuid,text,text,text,text,text,boolean) is
  'Owner-only deployment configuration boundary. Resets verification and never calls a provider.';
comment on function public.owner_create_preview_request(uuid,text,text,text) is
  'Owner-only preview request boundary. Tenant identity is derived from the deployment config.';
comment on function public.owner_decide_preview_request(uuid,text,text) is
  'Owner-only, terminal-safe preview approval or rejection boundary.';
comment on function public.owner_create_production_launch_request(uuid) is
  'Owner-only launch request boundary derived from a verified published preview.';
comment on function public.owner_decide_production_launch(uuid,text,text) is
  'Owner-only, audit-gated production approval or rejection boundary.';
