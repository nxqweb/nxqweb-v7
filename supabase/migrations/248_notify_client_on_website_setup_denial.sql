-- Read-only end-to-end audit of the Business flow (signup/intake -> owner
-- decision -> build -> deploy handoff -> client portal -> maintenance)
-- found that deny_website_setup() (migration 183) hard-stops a client's
-- pipeline on denial but never notifies the client. The parallel accepted
-- path is picked up by owner_approval_queue_storefront_provisioning
-- (migration 109), and both the preview-ready and production-published
-- moments now notify the client (see the application-code fixes made the
-- same session in build-business-website and promote-business-production).
-- Denial is at least as important for the client to hear about -- without
-- this, a denied client has no way to learn their pipeline stopped short of
-- manually checking their portal.
--
-- This migration only adds a notification_deliveries insert to the
-- already-existing deny_website_setup() function, on the newly-denied path
-- only (not the idempotent already-denied replay), using the exact same
-- channel/recipient_kind/priority pattern already established elsewhere in
-- this schema (migrations 137, 148, 154, 155, 159). No new table, no
-- privilege change: notification_deliveries and its dispatch worker
-- already exist. Every other line of the function body is unchanged from
-- migration 183.
--
-- This migration is staged for review; it has not been applied to any
-- database.

create or replace function public.deny_website_setup(
  approval_request_id uuid,
  denial_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  request_row public.owner_approval_requests%rowtype;
  client_row public.clients%rowtype;
  reason_value text:=btrim(coalesce(denial_reason,''));
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if approval_request_id is null then raise exception 'Approval request id is required.'; end if;
  if length(reason_value) not between 5 and 1000 then
    raise exception 'Denial reason must be between 5 and 1000 characters.';
  end if;

  select * into request_row
  from public.owner_approval_requests
  where id=approval_request_id
  for update;
  if not found then raise exception 'Website setup approval request not found.'; end if;
  if request_row.request_type<>'website_setup_review' then
    raise exception 'Only a website setup review can use the setup denial boundary.';
  end if;
  if request_row.client_id is null then
    raise exception 'Website setup approval is not linked to a client.';
  end if;

  select * into client_row from public.clients where id=request_row.client_id for update;
  if not found then raise exception 'Client for website setup approval was not found.'; end if;

  if request_row.status::text='denied'
     and client_row.status::text='denied'
     and client_row.pipeline_stopped_at is not null then
    return jsonb_build_object(
      'ok',true,'already_denied',true,'approval_id',request_row.id,
      'client_id',client_row.id,'client_status','denied',
      'pipeline_stopped',true,
      'message',client_row.business_name||': website setup was already denied and hard-stopped.'
    );
  end if;

  if request_row.status::text<>'pending' then
    raise exception 'Only a pending website setup review can be denied.';
  end if;

  -- Migration 129's deterministic trigger performs the hard stop in this same
  -- transaction. Any trigger failure rolls the decision back atomically.
  update public.owner_approval_requests
  set status='denied',owner_response=reason_value,resolved_at=now()
  where id=request_row.id;

  select * into client_row from public.clients where id=request_row.client_id;
  if client_row.status::text<>'denied' or client_row.pipeline_stopped_at is null then
    raise exception 'Website setup denial did not produce the required client hard stop.';
  end if;

  insert into public.notification_deliveries(
    client_id,channel,recipient_kind,template_key,subject,body,priority,metadata
  ) values (
    client_row.id,'in_app','client','business_setup_denied',
    'Your website setup was not approved',
    'NXQ reviewed your website setup and could not approve it at this time: '||reason_value,
    'high',
    jsonb_build_object('approval_id',request_row.id,'denial_reason',reason_value)
  );

  return jsonb_build_object(
    'ok',true,'already_denied',false,'approval_id',request_row.id,
    'client_id',client_row.id,'client_status','denied',
    'pipeline_stopped',true,'infrastructure_created',false,
    'message',client_row.business_name||': denied. The automation pipeline is hard-stopped.'
  );
end;
$$;

revoke all on function public.deny_website_setup(uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.deny_website_setup(uuid,text) to authenticated;

comment on function public.deny_website_setup(uuid,text) is
  'Denies a pending website setup review, hard-stops the client pipeline via migration 129''s trigger, and notifies the client in-app -- identical to migration 183''s version except for the added client notification on the newly-denied path.';
