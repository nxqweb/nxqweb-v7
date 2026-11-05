-- Make the billing promise true at runtime: automation may retry, remind, and
-- move an overdue account to review, but only an authenticated owner can freeze.
-- Also expose one narrow recovery action for exhausted internal maintenance.

create or replace function public.advance_automatic_billing_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  sub_row public.billing_subscriptions%rowtype;
  past_due_count integer:=0;
  review_count integer:=0;
  awaiting_owner_review_count integer:=0;
  reminder_key text;
begin
  for client_row in
    select c.*
    from public.clients c
    join public.billing_subscriptions s on s.client_id=c.id
    where c.billing_status::text in ('past_due','freeze_review')
      and s.automation_enabled=true
      and s.processor_connected=true
      and c.billing_overdue_since is not null
      and not c.qa_only
    for update of c skip locked
  loop
    select * into sub_row from public.billing_subscriptions where client_id=client_row.id;

    if client_row.billing_status::text='past_due' then
      reminder_key:='billing:'||client_row.id::text||':past-due-reminder:'||
        floor(extract(epoch from (now()-client_row.billing_overdue_since))/86400/3)::text;
      perform public.record_billing_notification(
        client_row.id,'past_due_reminder',reminder_key,
        jsonb_build_object('overdue_since',client_row.billing_overdue_since,'grace_days',sub_row.grace_days)
      );
      if client_row.billing_overdue_since+make_interval(days=>sub_row.grace_days)<=now() then
        update public.clients set billing_status='freeze_review',billing_updated_at=now(),updated_at=now()
        where id=client_row.id;
        insert into public.automation_audit_log(client_id,event_type,actor_type,details)
        values(client_row.id,'billing_moved_to_human_freeze_review','backend',jsonb_build_object(
          'overdue_since',client_row.billing_overdue_since,'grace_days',sub_row.grace_days,
          'requires_owner_decision',true,'auto_freeze',false
        ));
        review_count:=review_count+1;
      else
        past_due_count:=past_due_count+1;
      end if;
    else
      perform public.record_billing_notification(
        client_row.id,'freeze_review_owner_attention',
        'billing:'||client_row.id::text||':freeze-review:'||to_char(now() at time zone 'UTC','YYYYMMDD'),
        jsonb_build_object(
          'overdue_since',client_row.billing_overdue_since,
          'retry_attempts',sub_row.consecutive_failures,
          'requires_owner_decision',true,'auto_freeze',false
        )
      );
      awaiting_owner_review_count:=awaiting_owner_review_count+1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,'past_due_reviewed',past_due_count,
    'moved_to_freeze_review',review_count,
    'awaiting_owner_freeze_review',awaiting_owner_review_count,
    'automatically_frozen',0,'ran_at',now()
  );
end;
$$;

revoke all on function public.advance_automatic_billing_lifecycle() from public,anon,authenticated;
grant execute on function public.advance_automatic_billing_lifecycle() to service_role;

create or replace function public.owner_set_client_billing_state(
  target_client_id uuid,
  next_billing_status public.billing_status,
  next_billing_provider text default null,
  billing_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  selected_client public.clients%rowtype;
  note_value text:=nullif(btrim(coalesce(billing_note,'')),'');
  provider_value text:=left(coalesce(nullif(btrim(next_billing_provider),''),'manual'),80);
  allowed_transition boolean:=false;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  select * into selected_client from public.clients where id=target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected_client.qa_only then raise exception 'QA-only clients are permanently non-billable.'; end if;

  if selected_client.billing_status=next_billing_status then
    return jsonb_build_object(
      'success',true,'already_applied',true,'client_id',selected_client.id,
      'billing_status',selected_client.billing_status,
      'message',selected_client.business_name||' billing was already '||replace(selected_client.billing_status::text,'_',' ')||'.'
    );
  end if;

  allowed_transition:=case
    when selected_client.billing_status in ('not_configured','activation_pending') and next_billing_status='active' then true
    when selected_client.billing_status='active' and next_billing_status in ('past_due','cancelled') then true
    when selected_client.billing_status='past_due' and next_billing_status in ('freeze_review','cancelled') then true
    when selected_client.billing_status='freeze_review' and next_billing_status in ('frozen','cancelled') then true
    when selected_client.billing_status='frozen' and next_billing_status='cancelled' then true
    else false
  end;
  if not allowed_transition then
    raise exception 'Invalid billing transition from % to %. Payment restoration must use a verified payment action.',selected_client.billing_status,next_billing_status;
  end if;
  if next_billing_status in ('frozen','cancelled') and length(coalesce(note_value,''))<8 then
    raise exception 'A specific owner note of at least 8 characters is required for freeze or cancellation.';
  end if;

  update public.clients set
    billing_status=next_billing_status,
    billing_provider=coalesce(provider_value,billing_provider,'manual'),
    billing_overdue_since=case
      when next_billing_status='past_due' then coalesce(billing_overdue_since,now())
      when next_billing_status in ('active','cancelled') then null else billing_overdue_since end,
    billing_frozen_at=case
      when next_billing_status='frozen' then coalesce(billing_frozen_at,now())
      when next_billing_status='active' then null else billing_frozen_at end,
    billing_updated_at=now(),updated_at=now()
  where id=selected_client.id;

  insert into public.activity_logs(client_id,actor_type,action,details)
  values(selected_client.id,'owner','billing_'||next_billing_status::text,jsonb_build_object(
    'previous_billing_status',selected_client.billing_status,
    'billing_status',next_billing_status,'billing_provider',provider_value,
    'note',note_value,'owner_auth_user_id',auth.uid(),
    'source','owner_set_client_billing_state'
  ));
  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(selected_client.id,'owner_billing_state_changed','owner',jsonb_build_object(
    'previous_billing_status',selected_client.billing_status,
    'billing_status',next_billing_status,'note',note_value,
    'owner_auth_user_id',auth.uid(),'auto_freeze',false
  ));

  return jsonb_build_object(
    'success',true,'client_id',selected_client.id,
    'previous_billing_status',selected_client.billing_status,
    'billing_status',next_billing_status,
    'message',selected_client.business_name||' billing changed from '||
      replace(selected_client.billing_status::text,'_',' ')||' to '||replace(next_billing_status::text,'_',' ')||'.'
  );
end;
$$;

-- Retire the broader legacy owner RPC from normal authenticated use.
revoke execute on function public.set_client_billing_state(uuid,public.billing_status,text,text) from authenticated;
revoke all on function public.owner_set_client_billing_state(uuid,public.billing_status,text,text) from public,anon,authenticated,service_role;
grant execute on function public.owner_set_client_billing_state(uuid,public.billing_status,text,text) to authenticated;

create or replace function public.owner_retry_maintenance_exception(target_alert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  alert_row public.website_maintenance_alerts%rowtype;
  task_row public.website_maintenance_tasks%rowtype;
  client_row public.clients%rowtype;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  select * into alert_row from public.website_maintenance_alerts where id=target_alert_id for update;
  if not found or alert_row.status not in ('open','acknowledged') then
    raise exception 'Open maintenance exception not found.';
  end if;
  if alert_row.maintenance_task_id is null then raise exception 'Maintenance exception has no retryable task.'; end if;
  select * into task_row from public.website_maintenance_tasks where id=alert_row.maintenance_task_id for update;
  if not found or task_row.status not in ('failed','blocked') then
    raise exception 'Only failed or blocked maintenance tasks can be retried.';
  end if;
  if task_row.task_type not in (
    'uptime_check','ssl_check','form_test','broken_link_scan',
    'security_scan','seo_check','backup_check','monthly_report'
  ) then raise exception 'This maintenance task is not eligible for automatic recovery.'; end if;

  select * into client_row from public.clients where id=task_row.client_id for update;
  if client_row.status::text not in ('approved','active','overdue')
     or client_row.billing_status::text in ('frozen','cancelled') then
    raise exception 'Client lifecycle does not permit maintenance recovery.';
  end if;
  if not exists(
    select 1 from public.owner_approval_requests approval
    where approval.client_id=task_row.client_id and approval.project_id=task_row.project_id
      and approval.request_type='website_setup_review' and approval.status='accepted'
  ) then raise exception 'Original accepted website setup approval is required.'; end if;
  if exists(
    select 1 from public.client_automation_controls controls
    where controls.client_id=task_row.client_id
      and (not controls.automation_enabled or controls.automation_paused)
  ) then raise exception 'Client automation is paused or disabled.'; end if;
  if exists(
    select 1 from public.website_maintenance_plans plan
    where plan.id=task_row.maintenance_plan_id and plan.status in ('paused','disabled')
  ) then raise exception 'Maintenance plan is paused or disabled.'; end if;

  update public.website_maintenance_tasks set
    status='queued',attempts=0,scheduled_for=now(),started_at=null,completed_at=null,
    last_error=null,
    result=(coalesce(result,'{}'::jsonb)-'worker_name'-'claimed_at')||jsonb_build_object(
      'owner_retry_requested_at',now(),'owner_auth_user_id',auth.uid()
    ),updated_at=now()
  where id=task_row.id;
  update public.website_maintenance_plans set status='active',latest_error=null,updated_at=now()
  where id=task_row.maintenance_plan_id and status='error';
  update public.website_maintenance_alerts set status='acknowledged',acknowledged_at=now()
  where id=alert_row.id;
  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(task_row.client_id,task_row.project_id,'owner_maintenance_retry_requested','owner',jsonb_build_object(
    'maintenance_alert_id',alert_row.id,'maintenance_task_id',task_row.id,
    'task_type',task_row.task_type,'previous_status',task_row.status,
    'previous_attempts',task_row.attempts,'owner_auth_user_id',auth.uid(),
    'force_success',false
  ));
  return jsonb_build_object(
    'ok',true,'alert_id',alert_row.id,'task_id',task_row.id,
    'status','queued','force_success',false
  );
end;
$$;

revoke all on function public.owner_retry_maintenance_exception(uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_retry_maintenance_exception(uuid) to authenticated;

revoke insert,update,delete on public.website_maintenance_alerts from authenticated;
revoke insert,update,delete on public.website_maintenance_tasks from authenticated;
revoke insert,update,delete on public.website_maintenance_plans from authenticated;

comment on function public.advance_automatic_billing_lifecycle() is
  'Automates retries, reminders, and freeze review only. It never freezes service; that requires an authenticated owner action.';
comment on function public.owner_set_client_billing_state(uuid,public.billing_status,text,text) is
  'Owner-only guarded billing transition. Frozen/cancelled states require a specific note; payment restoration uses a separate verified action.';
comment on function public.owner_retry_maintenance_exception(uuid) is
  'Owner-only safe maintenance retry. Requeues normal worker validation and never force-completes a task.';
