-- Capture the missing client domain table and make every Owner Portal decision
-- atomic, typed, and server-authoritative. Browser code may request APPROVE or
-- DENY, but it cannot directly mutate approval/client/domain lifecycle rows.

create table if not exists public.client_domains (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  domain_name text not null,
  domain_type text not null default 'client_owned',
  status text not null default 'owner_review',
  registrar_name text,
  dns_provider text,
  ownership_confirmed boolean not null default false,
  client_notes text,
  dns_instructions text,
  owner_notes text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, domain_name)
);

alter table public.client_domains enable row level security;

drop policy if exists "Owners can manage client domains" on public.client_domains;
create policy "Owners can manage client domains"
on public.client_domains for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

drop policy if exists "Clients can read own domains" on public.client_domains;
create policy "Clients can read own domains"
on public.client_domains for select to authenticated
using (exists(
  select 1 from public.clients c
  where c.id=client_domains.client_id and c.auth_user_id=auth.uid()
));

revoke insert,update,delete on public.client_domains from authenticated;
grant select on public.client_domains to authenticated;

-- Client and approval lifecycle rows are RPC-owned. Clients retain their scoped
-- reads and may create safe request rows through dedicated SECURITY DEFINER APIs.
revoke insert,update,delete on public.clients from anon,authenticated;
revoke insert,update,delete on public.owner_approval_requests from anon,authenticated;
revoke all on function public.reset_client_workspace(uuid)
from public,anon,authenticated,service_role;

drop trigger if exists set_client_domains_updated_at on public.client_domains;
create trigger set_client_domains_updated_at
before update on public.client_domains
for each row execute function public.set_updated_at();

create or replace function public.submit_current_client_website_setup(
  target_setup_report text,
  target_tier_key text,
  target_business_type text,
  target_service_area text,
  target_submission_kind text default 'initial',
  target_requested_field_key text default null,
  target_requested_field_label text default null,
  target_requested_info text default null,
  target_client_answer text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  tier_row public.product_family_tiers%rowtype;
  report_value text:=btrim(coalesce(target_setup_report,''));
  tier_key_value text:=lower(btrim(coalesce(target_tier_key,'')));
  business_type_value text:=btrim(coalesce(target_business_type,''));
  service_area_value text:=btrim(coalesce(target_service_area,''));
  submission_kind_value text:=lower(btrim(coalesce(target_submission_kind,'')));
  field_key_value text:=lower(btrim(coalesce(target_requested_field_key,'')));
  field_label_value text:=btrim(coalesce(target_requested_field_label,''));
  requested_info_value text:=btrim(coalesce(target_requested_info,''));
  client_answer_value text:=btrim(coalesce(target_client_answer,''));
  request_sections text[];
  active_request_value text;
  approval_uuid uuid;
  approval_title text;
  approval_summary text;
begin
  if auth.role()<>'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  if submission_kind_value not in ('initial','resubmission','targeted') then
    raise exception 'Unsupported website setup submission kind.';
  end if;
  if tier_key_value not in ('starter','growth','intelligence') then
    raise exception 'Unsupported Business tier.';
  end if;
  if length(business_type_value) not between 2 and 120 then
    raise exception 'Business type must be between 2 and 120 characters.';
  end if;
  if length(service_area_value) not between 1 and 500 then
    raise exception 'Service area must be between 1 and 500 characters.';
  end if;
  if length(report_value) not between 200 and 30000
     or position('NXQ WEB WEBSITE SETUP REPORT' in report_value)<>1 then
    raise exception 'A complete NXQ website setup report is required.';
  end if;

  select * into client_row
  from public.clients
  where auth_user_id=auth.uid()
  for update;
  if not found then raise exception 'No client profile is linked to this login.'; end if;
  if client_row.qa_only then raise exception 'Disposable QA clients cannot submit portal setup.'; end if;
  if client_row.pipeline_stopped_at is not null
     or client_row.status::text not in ('lead','intake_received','needs_owner_review') then
    raise exception 'Client lifecycle does not allow a website setup submission.';
  end if;
  if submission_kind_value<>'targeted'
     and (position('Agreement accepted: Yes' in report_value)=0
       or length(btrim(split_part(split_part(
         report_value,E'\nTyped signature: ',2
       ),E'\n',1)))<2) then
    raise exception 'A signed NXQ website setup report is required.';
  end if;
  if exists(
    select 1 from public.owner_approval_requests ar
    where ar.client_id=client_row.id
      and ar.request_type='website_setup_review'
      and ar.status::text='pending'
  ) then
    raise exception 'A website setup review is already pending.';
  end if;

  select tier.* into tier_row
  from public.product_family_tiers tier
  join public.product_families family on family.id=tier.product_family_id
  where family.slug='business'
    and family.is_active=true
    and family.public_status in ('available','beta')
    and tier.tier_key=tier_key_value
    and tier.is_active=true
    and tier.public_status in ('available','beta')
    and tier.monthly_price is not null
  limit 1;
  if not found then raise exception 'Selected Business tier is not currently available.'; end if;

  if position(
    'Selected package: '||tier_row.name||' - $'||
    trunc(tier_row.monthly_price)::bigint::text||'/mo'
    in report_value
  )=0 then
    raise exception 'Setup report package details do not match the authoritative tier catalog.';
  end if;

  if submission_kind_value='targeted' then
    if client_row.status::text<>'needs_owner_review'
       or position('NXQ TARGETED MORE INFO REQUEST' in coalesce(client_row.notes,''))=0 then
      raise exception 'No targeted information request is active for this client.';
    end if;
    request_sections:=string_to_array(
      coalesce(client_row.notes,''),'NXQ TARGETED MORE INFO REQUEST'
    );
    active_request_value:='NXQ TARGETED MORE INFO REQUEST'||
      request_sections[array_upper(request_sections,1)];
    if position('Agreement accepted: Yes' in coalesce(client_row.notes,''))=0
       or length(btrim(split_part(split_part(
         coalesce(client_row.notes,''),E'\nTyped signature: ',2
       ),E'\n',1)))<2 then
      raise exception 'The original signed setup report could not be verified.';
    end if;
    if field_key_value not in (
      'preferred_contact_method','emergency_availability','business_hours','locations',
      'services','pages_needed','style_direction','assistant_rules','other'
    ) then raise exception 'Unsupported targeted information field.'; end if;
    if length(field_label_value) not between 1 and 80
       or length(requested_info_value) not between 5 and 1000
       or length(client_answer_value) not between 1 and 5000 then
      raise exception 'Targeted information response is incomplete.';
    end if;
    if position('Field key: '||field_key_value in active_request_value)=0
       or position('Field label: '||field_label_value in active_request_value)=0
       or position('Requested info: '||requested_info_value in active_request_value)=0 then
      raise exception 'Targeted response does not match the active requested field.';
    end if;
  end if;

  update public.clients
  set
    product_family_id=tier_row.product_family_id,
    product_tier_id=tier_row.id,
    monthly_price=tier_row.monthly_price,
    business_type=business_type_value,
    service_area=service_area_value,
    status='intake_received',
    notes=report_value,
    updated_at=now()
  where id=client_row.id;

  approval_title:=case submission_kind_value
    when 'targeted' then 'Website setup targeted update'
    when 'resubmission' then 'Website setup resubmitted'
    else 'Website setup submitted'
  end;
  approval_summary:=case submission_kind_value
    when 'targeted' then client_row.business_name||' answered the targeted setup request for '||field_label_value||'.'
    when 'resubmission' then client_row.business_name||' resubmitted an updated website setup for '||tier_row.name||'.'
    else client_row.business_name||' submitted a website setup for '||tier_row.name||'.'
  end;

  insert into public.owner_approval_requests(
    client_id,project_id,request_type,title,summary,recommended_action,risk_level,status
  ) values(
    client_row.id,null,'website_setup_review',approval_title,approval_summary,
    report_value,'low','pending'
  ) returning id into approval_uuid;

  insert into public.activity_logs(client_id,actor_type,action,details)
  values(client_row.id,'client',case when submission_kind_value='targeted'
    then 'targeted_more_info_submitted' else 'website_setup_submitted' end,jsonb_build_object(
    'approval_id',approval_uuid,'submission_kind',submission_kind_value,
    'product_tier_key',tier_key_value,'monthly_price',tier_row.monthly_price,
    'requested_field_key',nullif(field_key_value,''),'server_authoritative',true
  ));

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(client_row.id,'client_website_setup_submitted','client',jsonb_build_object(
    'approval_id',approval_uuid,'submission_kind',submission_kind_value,
    'product_family_slug','business','product_tier_key',tier_key_value,
    'catalog_monthly_price',tier_row.monthly_price,'external_notification_sent',false
  ));

  return jsonb_build_object(
    'ok',true,'client_id',client_row.id,'client_status','intake_received',
    'approval_id',approval_uuid,'submission_kind',submission_kind_value,
    'product_tier_key',tier_key_value,'monthly_price',tier_row.monthly_price,
    'message',case when submission_kind_value='targeted'
      then 'Requested update submitted for owner review.'
      else 'Website setup submitted for owner review.' end
  );
end;
$$;

revoke all on function public.submit_current_client_website_setup(text,text,text,text,text,text,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.submit_current_client_website_setup(text,text,text,text,text,text,text,text,text)
to authenticated;

comment on function public.submit_current_client_website_setup(text,text,text,text,text,text,text,text,text) is
  'Authenticated client setup boundary. Resolves Business tier pricing from the catalog and atomically creates one pending owner review.';

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
  'Owner-only DENY boundary for a pending website setup. The denial trigger must hard-stop the client in the same transaction.';

create or replace function public.resolve_owner_approval_decision(
  target_approval_id uuid,
  decision_status text,
  owner_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  request_row public.owner_approval_requests%rowtype;
  decision_value text:=lower(btrim(coalesce(decision_status,'')));
  response_value text:=btrim(coalesce(owner_response_text,''));
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if decision_value not in ('accepted','denied') then
    raise exception 'Decision must be accepted or denied.';
  end if;
  if length(response_value) not between 1 and 1000 then
    raise exception 'Owner response must be between 1 and 1000 characters.';
  end if;

  select * into request_row
  from public.owner_approval_requests
  where id=target_approval_id
  for update;
  if not found then raise exception 'Approval request was not found.'; end if;

  -- Each high-risk family has its own typed resolver. This generic boundary is
  -- deliberately limited to the one captured review type with generic semantics.
  if request_row.request_type<>'commerce_intake_review' then
    raise exception 'This approval type requires its dedicated decision workflow.';
  end if;

  if request_row.status::text=decision_value then
    return jsonb_build_object(
      'ok',true,'already_decided',true,'approval_id',request_row.id,
      'decision_status',decision_value,'message','Approval was already resolved.'
    );
  end if;
  if request_row.status::text<>'pending' then
    raise exception 'Only a pending approval can be resolved.';
  end if;

  update public.owner_approval_requests
  set status=decision_value::public.approval_status,
      owner_response=response_value,
      resolved_at=now()
  where id=request_row.id;

  insert into public.activity_logs(client_id,actor_type,action,details)
  values(request_row.client_id,'owner','approval_'||decision_value,jsonb_build_object(
    'approval_id',request_row.id,'request_type',request_row.request_type,
    'owner_response',response_value,'server_authoritative',true
  ));

  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(request_row.client_id,request_row.project_id,'owner_approval_'||decision_value,'owner',jsonb_build_object(
    'approval_id',request_row.id,'request_type',request_row.request_type,
    'external_notification_sent',false
  ));

  return jsonb_build_object(
    'ok',true,'already_decided',false,'approval_id',request_row.id,
    'decision_status',decision_value,
    'message','Approval decision saved with status: '||decision_value||'.'
  );
end;
$$;

revoke all on function public.resolve_owner_approval_decision(uuid,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.resolve_owner_approval_decision(uuid,text,text) to authenticated;

comment on function public.resolve_owner_approval_decision(uuid,text,text) is
  'Owner-only typed resolver for generic Commerce intake approval decisions. Specialized approval families are rejected.';

create or replace function public.resolve_domain_connection_review(
  target_approval_id uuid,
  decision_status text,
  owner_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  request_row public.owner_approval_requests%rowtype;
  domain_row public.client_domains%rowtype;
  decision_value text:=lower(btrim(coalesce(decision_status,'')));
  response_value text:=btrim(coalesce(owner_response_text,''));
  domain_name_value text;
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if decision_value not in ('accepted','denied') then
    raise exception 'Domain decision must be accepted or denied.';
  end if;
  if length(response_value) not between 1 and 1000 then
    raise exception 'Owner response must be between 1 and 1000 characters.';
  end if;

  select * into request_row
  from public.owner_approval_requests
  where id=target_approval_id
  for update;
  if not found then raise exception 'Approval request was not found.'; end if;
  if request_row.request_type<>'domain_connection_review' then
    raise exception 'This RPC only resolves domain connection reviews.';
  end if;
  if request_row.client_id is null then
    raise exception 'Domain review is not linked to a client.';
  end if;
  if request_row.status::text=decision_value then
    return jsonb_build_object(
      'ok',true,'already_decided',true,'approval_id',request_row.id,
      'decision_status',decision_value,'message','Domain review was already resolved.'
    );
  end if;
  if request_row.status::text<>'pending' then
    raise exception 'Only a pending domain review can be resolved.';
  end if;

  domain_name_value:=substring(
    concat_ws(E'\n',request_row.summary,request_row.recommended_action)
    from 'Domain:\s*([a-z0-9.-]+\.[a-z]{2,})'
  );
  if nullif(btrim(coalesce(domain_name_value,'')),'') is null then
    domain_name_value:=substring(
      concat_ws(E'\n',request_row.summary,request_row.recommended_action)
      from '\m([a-z0-9-]+\.[a-z]{2,})\M'
    );
  end if;
  domain_name_value:=lower(btrim(coalesce(domain_name_value,'')));
  domain_name_value:=regexp_replace(domain_name_value,'\.+$','');
  if domain_name_value='' then
    raise exception 'Could not find the domain name in the approval request.';
  end if;

  select * into domain_row
  from public.client_domains
  where client_id=request_row.client_id and domain_name=domain_name_value
  order by requested_at desc
  limit 1
  for update;
  if not found then raise exception 'Domain record was not found.'; end if;

  update public.client_domains
  set
    status=case when decision_value='accepted' then 'waiting_dns' else 'failed' end,
    reviewed_at=now(),
    dns_instructions=case when decision_value='accepted'
      then 'NXQ approved this client-owned domain. Automated verification will continue; the client keeps ownership.'
      else dns_instructions end,
    owner_notes=response_value,
    updated_at=now()
  where id=domain_row.id;

  update public.owner_approval_requests
  set status=decision_value::public.approval_status,
      owner_response=response_value,
      resolved_at=now()
  where id=request_row.id;

  insert into public.activity_logs(client_id,actor_type,action,details)
  values(request_row.client_id,'owner','domain_connection_'||decision_value,jsonb_build_object(
    'approval_id',request_row.id,'domain_id',domain_row.id,
    'domain_name',domain_name_value,'owner_response',response_value,
    'server_authoritative',true
  ));

  insert into public.automation_audit_log(client_id,project_id,event_type,actor_type,details)
  values(request_row.client_id,request_row.project_id,'domain_connection_'||decision_value,'owner',jsonb_build_object(
    'approval_id',request_row.id,'domain_id',domain_row.id,
    'domain_name',domain_name_value,'external_notification_sent',false
  ));

  return jsonb_build_object(
    'ok',true,'already_decided',false,'approval_id',request_row.id,
    'domain_id',domain_row.id,'domain_name',domain_name_value,
    'decision_status',decision_value,
    'message',domain_name_value||case when decision_value='accepted'
      then ' moved to automated DNS verification.' else ' was denied.' end
  );
end;
$$;

revoke all on function public.resolve_domain_connection_review(uuid,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.resolve_domain_connection_review(uuid,text,text) to authenticated;

comment on function public.resolve_domain_connection_review(uuid,text,text) is
  'Owner-only atomic domain approval boundary. Locks the pending review and exact domain before changing either record.';
