-- Autonomous post-launch change-request routing.
-- Safe structured edits can flow automatically; ambiguous/high-risk changes escalate.

create or replace function public.classify_change_request_risk()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  normalized text := lower(coalesce(new.description,'') || ' ' || coalesce(new.title,''));
begin
  if new.request_type in ('domain','pricing') then
    new.risk_level := 'high';
  elsif new.request_type in ('new_page','design','location','seo') then
    new.risk_level := 'medium';
  elsif new.request_type in ('content','image','service')
        and not (normalized ~ '(legal|guarantee|warranty|medical|financial|refund|contract|emergency promise|licensed|certified)') then
    new.risk_level := 'low';
  else
    new.risk_level := 'medium';
  end if;
  return new;
end; $$;

drop trigger if exists classify_change_request_risk on public.website_change_requests;
create trigger classify_change_request_risk before insert or update of request_type,title,description
on public.website_change_requests for each row execute function public.classify_change_request_risk();

create or replace function public.route_submitted_change_request()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status <> 'submitted' or (tg_op='UPDATE' and old.status='submitted') then return new; end if;
  if not public.nxq_automation_scope_allowed('client',new.client_id::text) then
    update public.website_change_requests set status='blocked',last_error='Client automation is paused by governance.' where id=new.id;
    return new;
  end if;

  if new.risk_level='low' then
    perform public.enqueue_automation_job(
      new.client_id,new.project_id,'website_apply_change_request',
      'change-request:'||new.id::text||':apply:v1',
      jsonb_build_object('execution_target','edge','change_request_id',new.id,'requires_external_worker',true,'risk_level',new.risk_level),
      now(),40
    );
    update public.website_change_requests set status='queued',automation_plan=jsonb_build_object('route','automatic_safe_branch','risk_level',new.risk_level),updated_at=now() where id=new.id;
  else
    perform public.enqueue_automation_job(
      new.client_id,new.project_id,'classify_website_change_request',
      'change-request:'||new.id::text||':classify:v2',
      jsonb_build_object('execution_target','ai','change_request_id',new.id,'requires_ai_worker',true,'risk_level',new.risk_level),
      now(),35
    );
    update public.website_change_requests set status='classifying',automation_plan=jsonb_build_object('route','classification_required','risk_level',new.risk_level),updated_at=now() where id=new.id;
  end if;
  return new;
end; $$;

drop trigger if exists route_submitted_change_request on public.website_change_requests;
create trigger route_submitted_change_request after insert or update of status
on public.website_change_requests for each row execute function public.route_submitted_change_request();

create or replace function public.notify_change_request_state()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  msg text;
begin
  if old.status is not distinct from new.status then return new; end if;
  msg := case new.status
    when 'queued' then 'NXQ accepted your change request and queued safe automated work.'
    when 'building' then 'NXQ is building your requested website change on a safe branch.'
    when 'preview_ready' then 'Your requested website change passed its build stage and has a preview.'
    when 'published' then 'Your website change has been published successfully.'
    when 'needs_info' then 'NXQ needs more information before it can safely continue this change.'
    when 'blocked' then 'NXQ paused this change because a safe automated path is not currently available.'
    when 'failed' then 'NXQ could not complete this change automatically and has escalated it.'
    else null end;
  if msg is not null then
    insert into public.notification_deliveries(client_id,project_id,channel,recipient_kind,template_key,subject,body,priority,metadata)
    values(new.client_id,new.project_id,'in_app','client','website_change_status','Website change update',msg,
      case when new.status in ('failed','blocked') then 'high' else 'normal' end,
      jsonb_build_object('change_request_id',new.id,'request_code',new.request_code,'status',new.status));
  end if;
  return new;
end; $$;

drop trigger if exists notify_change_request_state on public.website_change_requests;
create trigger notify_change_request_state after update of status on public.website_change_requests
for each row execute function public.notify_change_request_state();

revoke all on function public.classify_change_request_risk() from public,anon,authenticated;
revoke all on function public.route_submitted_change_request() from public,anon,authenticated;
revoke all on function public.notify_change_request_state() from public,anon,authenticated;

comment on function public.route_submitted_change_request() is 'Routes low-risk structured changes to safe automated build work; ambiguous/risky changes require classification/escalation rather than direct production mutation.';