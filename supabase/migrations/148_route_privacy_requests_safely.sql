-- Safe privacy/data-subject request routing.
-- Non-destructive requests can automate. Delete remains step-up/identity-check gated.

create or replace function public.route_data_subject_request()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status <> 'submitted' then return new; end if;

  if new.request_type = 'delete' then
    update public.data_subject_requests
    set status='identity_check',
        result=coalesce(result,'{}'::jsonb)||jsonb_build_object(
          'automation_route','step_up_identity_required',
          'destructive_action_started',false,
          'reason','Account deletion requires identity re-verification before destructive processing.'
        ),
        updated_at=now()
    where id=new.id;

    if new.client_id is not null then
      insert into public.notification_deliveries(client_id,channel,recipient_kind,template_key,subject,body,priority,metadata)
      values(new.client_id,'in_app','client','privacy_delete_identity_check','Identity check required','Your deletion request was received. NXQ requires identity verification before any destructive account action.', 'high', jsonb_build_object('data_request_id',new.id,'request_code',new.request_code));
    end if;
    return new;
  end if;

  update public.data_subject_requests set status='queued',updated_at=now() where id=new.id;

  perform public.enqueue_automation_job(
    new.client_id,
    null,
    'process_data_subject_request',
    'data-request:'||new.id::text||':process:v1',
    jsonb_build_object('execution_target','edge','requires_external_worker',true,'data_subject_request_id',new.id,'request_type',new.request_type),
    now(),30
  );

  return new;
end;
$$;

drop trigger if exists route_data_subject_request on public.data_subject_requests;
create trigger route_data_subject_request
after insert on public.data_subject_requests
for each row execute function public.route_data_subject_request();

revoke all on function public.route_data_subject_request() from public,anon,authenticated;

comment on function public.route_data_subject_request() is
  'Routes export/correct/restrict/consent-withdrawal to automation. Delete requires identity re-verification and never begins destructive work automatically.';
