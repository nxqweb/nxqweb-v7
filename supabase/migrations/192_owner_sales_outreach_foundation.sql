-- NXQ Web owner-only sales and outreach foundation.
-- Drafting and scheduling are allowed; every message requires a separate owner approval.
-- This migration intentionally creates no provider adapter and no autonomous send path.

create extension if not exists pgcrypto;

create table if not exists public.nxq_sales_outreach_settings (
  singleton boolean primary key default true check(singleton),
  sender_display_name text not null default 'Christian at NXQ Web',
  sender_business_name text not null default 'NXQ Web',
  sender_email text,
  postal_address text,
  email_opt_out_instruction text not null default 'Reply unsubscribe and I will not contact you again.',
  sms_stop_language text not null default 'Reply STOP to opt out.',
  discord_policy text not null default 'Opt-in community and support only. No cold DMs, bulk messages, self-bots, or user-bots.',
  updated_by_auth_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.nxq_sales_outreach_settings(singleton)
values(true) on conflict(singleton) do nothing;

create table if not exists public.nxq_sales_prospects (
  id uuid primary key default gen_random_uuid(),
  prospect_code text not null unique default ('PROS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  business_name text not null,
  niche_key text not null default 'other' check(niche_key in ('tree_services','roofing','auto_services','home_services','professional_services','health_wellness','food_hospitality','retail','other')),
  website_url text,
  city text,
  state_region text,
  contact_name text,
  contact_email text,
  contact_phone text,
  discord_handle text,
  source_url text,
  status text not null default 'research' check(status in ('research','qualified','draft_ready','approved_to_contact','contacted','replied','meeting','won','lost','do_not_contact','archived')),
  priority text not null default 'normal' check(priority in ('low','normal','high')),
  recommended_tier_key text not null default 'growth' check(recommended_tier_key in ('starter','growth','intelligence','enterprise')),
  lead_score smallint not null default 0 check(lead_score between 0 and 100),
  qualification_signals jsonb not null default '{}'::jsonb,
  research_notes text,
  do_not_contact_reason text,
  do_not_contact_at timestamptz,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nxq_sales_prospects_email_unique
on public.nxq_sales_prospects(lower(contact_email)) where contact_email is not null and btrim(contact_email)<>'';
create index if not exists nxq_sales_prospects_status_due_idx
on public.nxq_sales_prospects(status,next_follow_up_at,lead_score desc,created_at desc);

create table if not exists public.nxq_sales_contact_permissions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.nxq_sales_prospects(id) on delete cascade,
  channel text not null check(channel in ('email','sms','discord')),
  status text not null default 'unknown' check(status in ('unknown','allowed','denied','revoked')),
  basis text not null default 'none' check(basis in ('none','public_business_email','direct_request','existing_relationship','opt_in','explicit_written_consent')),
  evidence_note text,
  evidence_source text,
  evidence_at timestamptz,
  revoked_at timestamptz,
  updated_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(prospect_id,channel),
  check(status<>'allowed' or basis<>'none'),
  check(channel='email' or status<>'allowed' or (basis in ('direct_request','existing_relationship','opt_in','explicit_written_consent') and evidence_at is not null))
);

create table if not exists public.nxq_sales_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.nxq_sales_prospects(id) on delete cascade,
  channel text not null check(channel in ('email','sms','discord')),
  sequence_step smallint not null default 1 check(sequence_step between 1 and 10),
  subject text,
  body text not null,
  rendered_body text,
  status text not null default 'draft' check(status in ('draft','needs_review','approved','rejected','sent','blocked','cancelled')),
  scheduled_for timestamptz,
  compliance_snapshot jsonb not null default '{}'::jsonb,
  owner_decision_note text,
  approved_by_auth_user_id uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(prospect_id,channel,sequence_step)
);
create index if not exists nxq_sales_outreach_drafts_review_idx
on public.nxq_sales_outreach_drafts(status,scheduled_for,created_at desc);

create table if not exists public.nxq_sales_outreach_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.nxq_sales_prospects(id) on delete cascade,
  draft_id uuid references public.nxq_sales_outreach_drafts(id) on delete set null,
  event_type text not null check(event_type in ('prospect_created','permission_recorded','draft_created','draft_approved','draft_rejected','message_marked_sent','reply_recorded','opt_out_recorded','status_changed')),
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists nxq_sales_outreach_events_prospect_idx
on public.nxq_sales_outreach_events(prospect_id,created_at desc);

alter table public.nxq_sales_outreach_settings enable row level security;
alter table public.nxq_sales_prospects enable row level security;
alter table public.nxq_sales_contact_permissions enable row level security;
alter table public.nxq_sales_outreach_drafts enable row level security;
alter table public.nxq_sales_outreach_events enable row level security;

revoke all on table public.nxq_sales_outreach_settings,public.nxq_sales_prospects,public.nxq_sales_contact_permissions,public.nxq_sales_outreach_drafts,public.nxq_sales_outreach_events from public,anon;
grant select on table public.nxq_sales_outreach_settings,public.nxq_sales_prospects,public.nxq_sales_contact_permissions,public.nxq_sales_outreach_drafts,public.nxq_sales_outreach_events to authenticated;
grant select,insert,update,delete on table public.nxq_sales_outreach_settings,public.nxq_sales_prospects,public.nxq_sales_contact_permissions,public.nxq_sales_outreach_drafts,public.nxq_sales_outreach_events to service_role;

create policy owner_read_sales_settings on public.nxq_sales_outreach_settings for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy owner_read_sales_prospects on public.nxq_sales_prospects for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy owner_read_sales_permissions on public.nxq_sales_contact_permissions for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy owner_read_sales_drafts on public.nxq_sales_outreach_drafts for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy owner_read_sales_events on public.nxq_sales_outreach_events for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));

create or replace function public.nxq_sales_score(target_niche_key text,target_signals jsonb)
returns smallint language plpgsql immutable set search_path=public as $$
declare score_value integer:=15;
begin
  if target_niche_key in ('tree_services','roofing','auto_services','home_services') then score_value:=score_value+5; end if;
  if coalesce((target_signals->>'no_website')::boolean,false) then score_value:=score_value+35; end if;
  if coalesce((target_signals->>'outdated_design')::boolean,false) then score_value:=score_value+12; end if;
  if coalesce((target_signals->>'weak_mobile')::boolean,false) then score_value:=score_value+12; end if;
  if coalesce((target_signals->>'weak_contact_path')::boolean,false) then score_value:=score_value+10; end if;
  if coalesce((target_signals->>'limited_local_seo')::boolean,false) then score_value:=score_value+10; end if;
  if coalesce((target_signals->>'missing_service_pages')::boolean,false) then score_value:=score_value+8; end if;
  return least(100,greatest(0,score_value))::smallint;
exception when invalid_text_representation then
  return least(100,greatest(0,score_value))::smallint;
end; $$;
revoke all on function public.nxq_sales_score(text,jsonb) from public,anon,authenticated;

create or replace function public.owner_update_sales_outreach_settings(
  target_sender_display_name text,target_sender_email text,target_postal_address text
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  if length(btrim(coalesce(target_sender_display_name,''))) not between 2 and 120 then raise exception 'Sender display name is required.'; end if;
  if btrim(coalesce(target_sender_email,''))<>'' and target_sender_email!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Sender email is invalid.'; end if;
  update public.nxq_sales_outreach_settings set
    sender_display_name=btrim(target_sender_display_name),sender_email=nullif(lower(btrim(target_sender_email)),''),
    postal_address=nullif(btrim(target_postal_address),''),updated_by_auth_user_id=auth.uid(),updated_at=now()
  where singleton=true;
  return jsonb_build_object('ok',true,'email_ready',btrim(coalesce(target_sender_email,''))<>'','postal_address_ready',btrim(coalesce(target_postal_address,''))<>'');
end; $$;

create or replace function public.owner_create_sales_prospect(
  target_business_name text,target_niche_key text,target_website_url text,target_city text,target_state_region text,
  target_contact_name text,target_contact_email text,target_contact_phone text,target_source_url text,
  target_signals jsonb default '{}'::jsonb,target_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare prospect_uuid uuid; normalized_email text:=nullif(lower(btrim(target_contact_email)),''); score_value smallint;
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  if length(btrim(coalesce(target_business_name,''))) not between 2 and 180 then raise exception 'Business name is required.'; end if;
  if target_niche_key not in ('tree_services','roofing','auto_services','home_services','professional_services','health_wellness','food_hospitality','retail','other') then raise exception 'Industry category is invalid.'; end if;
  if normalized_email is not null and normalized_email!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Contact email is invalid.'; end if;
  score_value:=public.nxq_sales_score(target_niche_key,coalesce(target_signals,'{}'::jsonb));
  insert into public.nxq_sales_prospects(business_name,niche_key,website_url,city,state_region,contact_name,contact_email,contact_phone,source_url,status,priority,recommended_tier_key,lead_score,qualification_signals,research_notes,created_by_auth_user_id)
  values(btrim(target_business_name),target_niche_key,nullif(btrim(target_website_url),''),nullif(btrim(target_city),''),nullif(btrim(target_state_region),''),nullif(btrim(target_contact_name),''),normalized_email,nullif(btrim(target_contact_phone),''),nullif(btrim(target_source_url),''),case when score_value>=60 then 'qualified' else 'research' end,case when score_value>=75 then 'high' else 'normal' end,case when score_value>=85 then 'intelligence' when score_value>=60 then 'growth' else 'starter' end,score_value,coalesce(target_signals,'{}'::jsonb),nullif(btrim(target_notes),''),auth.uid())
  returning id into prospect_uuid;
  if normalized_email is not null then
    insert into public.nxq_sales_contact_permissions(prospect_id,channel,status,basis,evidence_note,evidence_source,evidence_at,updated_by_auth_user_id)
    values(prospect_uuid,'email','allowed','public_business_email','Business email recorded during owner research.',nullif(btrim(target_source_url),''),now(),auth.uid());
  end if;
  insert into public.nxq_sales_outreach_events(prospect_id,event_type,actor_auth_user_id,evidence)
  values(prospect_uuid,'prospect_created',auth.uid(),jsonb_build_object('lead_score',score_value,'niche_key',target_niche_key));
  return prospect_uuid;
end; $$;

create or replace function public.owner_record_sales_permission(
  target_prospect_id uuid,target_channel text,target_status text,target_basis text,target_evidence_note text,target_evidence_source text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare evidence_time timestamptz:=case when target_status='allowed' then now() else null end;
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  if target_channel not in ('email','sms','discord') or target_status not in ('unknown','allowed','denied','revoked') then raise exception 'Permission state is invalid.'; end if;
  if target_basis not in ('none','public_business_email','direct_request','existing_relationship','opt_in','explicit_written_consent') then raise exception 'Permission basis is invalid.'; end if;
  if target_status='allowed' and target_basis='none' then raise exception 'Allowed contact requires a documented basis.'; end if;
  if target_channel in ('sms','discord') and target_status='allowed' and (target_basis not in ('direct_request','existing_relationship','opt_in','explicit_written_consent') or length(btrim(coalesce(target_evidence_note,'')))<8) then raise exception 'SMS and Discord require specific opt-in or relationship evidence.'; end if;
  if not exists(select 1 from public.nxq_sales_prospects where id=target_prospect_id and status<>'do_not_contact') then raise exception 'Prospect is unavailable or do-not-contact.'; end if;
  insert into public.nxq_sales_contact_permissions(prospect_id,channel,status,basis,evidence_note,evidence_source,evidence_at,revoked_at,updated_by_auth_user_id,updated_at)
  values(target_prospect_id,target_channel,target_status,target_basis,nullif(btrim(target_evidence_note),''),nullif(btrim(target_evidence_source),''),evidence_time,case when target_status in ('denied','revoked') then now() else null end,auth.uid(),now())
  on conflict(prospect_id,channel) do update set status=excluded.status,basis=excluded.basis,evidence_note=excluded.evidence_note,evidence_source=excluded.evidence_source,evidence_at=excluded.evidence_at,revoked_at=excluded.revoked_at,updated_by_auth_user_id=excluded.updated_by_auth_user_id,updated_at=now();
  insert into public.nxq_sales_outreach_events(prospect_id,event_type,actor_auth_user_id,evidence)
  values(target_prospect_id,'permission_recorded',auth.uid(),jsonb_build_object('channel',target_channel,'status',target_status,'basis',target_basis));
  return jsonb_build_object('ok',true,'channel',target_channel,'status',target_status);
end; $$;

create or replace function public.owner_create_sales_outreach_draft(
  target_prospect_id uuid,target_channel text,target_sequence_step integer,target_subject text,target_body text,target_scheduled_for timestamptz default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare draft_uuid uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  if target_channel not in ('email','sms','discord') or target_sequence_step not between 1 and 10 then raise exception 'Draft channel or sequence step is invalid.'; end if;
  if length(btrim(coalesce(target_body,''))) not between 10 and 4000 then raise exception 'Draft body length is invalid.'; end if;
  if target_channel='email' and length(btrim(coalesce(target_subject,''))) not between 3 and 180 then raise exception 'Email subject is required.'; end if;
  if not exists(select 1 from public.nxq_sales_prospects where id=target_prospect_id and status not in ('do_not_contact','archived','won','lost')) then raise exception 'Prospect cannot receive a new draft.'; end if;
  insert into public.nxq_sales_outreach_drafts(prospect_id,channel,sequence_step,subject,body,status,scheduled_for,compliance_snapshot,created_by_auth_user_id)
  values(target_prospect_id,target_channel,target_sequence_step,nullif(btrim(target_subject),''),btrim(target_body),'needs_review',target_scheduled_for,jsonb_build_object('owner_approval_required',true,'automatic_send',false,'created_at',now()),auth.uid())
  on conflict(prospect_id,channel,sequence_step) do update set subject=excluded.subject,body=excluded.body,status='needs_review',scheduled_for=excluded.scheduled_for,rendered_body=null,owner_decision_note=null,approved_by_auth_user_id=null,approved_at=null,updated_at=now()
  returning id into draft_uuid;
  update public.nxq_sales_prospects set status='draft_ready',updated_at=now() where id=target_prospect_id and status in ('research','qualified');
  insert into public.nxq_sales_outreach_events(prospect_id,draft_id,event_type,actor_auth_user_id,evidence)
  values(target_prospect_id,draft_uuid,'draft_created',auth.uid(),jsonb_build_object('channel',target_channel,'sequence_step',target_sequence_step));
  return draft_uuid;
end; $$;

create or replace function public.owner_decide_sales_outreach_draft(target_draft_id uuid,target_decision text,target_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare draft_row public.nxq_sales_outreach_drafts%rowtype; prospect_row public.nxq_sales_prospects%rowtype; permission_row public.nxq_sales_contact_permissions%rowtype; settings_row public.nxq_sales_outreach_settings%rowtype; final_body text;
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  if target_decision not in ('approve','reject') or length(btrim(coalesce(target_note,'')))<4 then raise exception 'Approve or reject with a specific note.'; end if;
  select * into draft_row from public.nxq_sales_outreach_drafts where id=target_draft_id for update;
  if draft_row.id is null or draft_row.status<>'needs_review' then raise exception 'Draft is not awaiting review.'; end if;
  select * into prospect_row from public.nxq_sales_prospects where id=draft_row.prospect_id for update;
  if prospect_row.status='do_not_contact' then raise exception 'Prospect is do-not-contact.'; end if;
  if target_decision='reject' then
    update public.nxq_sales_outreach_drafts set status='rejected',owner_decision_note=btrim(target_note),updated_at=now() where id=target_draft_id;
    insert into public.nxq_sales_outreach_events(prospect_id,draft_id,event_type,actor_auth_user_id,evidence) values(prospect_row.id,draft_row.id,'draft_rejected',auth.uid(),jsonb_build_object('note',btrim(target_note)));
    return jsonb_build_object('ok',true,'status','rejected');
  end if;
  select * into permission_row from public.nxq_sales_contact_permissions where prospect_id=prospect_row.id and channel=draft_row.channel;
  if permission_row.id is null or permission_row.status<>'allowed' then raise exception 'Active channel permission is required before approval.'; end if;
  if draft_row.channel in ('sms','discord') and (permission_row.basis not in ('direct_request','existing_relationship','opt_in','explicit_written_consent') or permission_row.evidence_at is null) then raise exception 'SMS and Discord approval require documented consent evidence.'; end if;
  select * into settings_row from public.nxq_sales_outreach_settings where singleton=true;
  if draft_row.channel='email' then
    if coalesce(settings_row.sender_email,'')='' or coalesce(settings_row.postal_address,'')='' then raise exception 'Sender email and physical postal address are required before approving commercial email.'; end if;
    final_body:=draft_row.body||E'\n\n'||settings_row.sender_business_name||E'\n'||settings_row.postal_address||E'\n'||settings_row.email_opt_out_instruction;
  elsif draft_row.channel='sms' then
    final_body:=draft_row.body||case when position(lower(settings_row.sms_stop_language) in lower(draft_row.body))>0 then '' else E'\n'||settings_row.sms_stop_language end;
  else
    final_body:=draft_row.body;
  end if;
  update public.nxq_sales_outreach_drafts set status='approved',rendered_body=final_body,owner_decision_note=btrim(target_note),approved_by_auth_user_id=auth.uid(),approved_at=now(),compliance_snapshot=jsonb_build_object('owner_approved',true,'automatic_send',false,'permission_basis',permission_row.basis,'permission_evidence_at',permission_row.evidence_at,'do_not_contact_checked_at',now(),'channel',draft_row.channel),updated_at=now() where id=target_draft_id;
  update public.nxq_sales_prospects set status='approved_to_contact',updated_at=now() where id=prospect_row.id and status in ('research','qualified','draft_ready');
  insert into public.nxq_sales_outreach_events(prospect_id,draft_id,event_type,actor_auth_user_id,evidence) values(prospect_row.id,draft_row.id,'draft_approved',auth.uid(),jsonb_build_object('channel',draft_row.channel,'note',btrim(target_note),'automatic_send',false));
  return jsonb_build_object('ok',true,'status','approved','automatic_send',false);
end; $$;

create or replace function public.owner_mark_sales_outreach_sent(target_draft_id uuid,target_sent_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare draft_row public.nxq_sales_outreach_drafts%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  select d.* into draft_row from public.nxq_sales_outreach_drafts d join public.nxq_sales_prospects p on p.id=d.prospect_id where d.id=target_draft_id and d.status='approved' and p.status<>'do_not_contact' for update of d;
  if draft_row.id is null then raise exception 'Only an approved, still-contactable draft can be marked sent.'; end if;
  update public.nxq_sales_outreach_drafts set status='sent',sent_at=coalesce(target_sent_at,now()),updated_at=now() where id=target_draft_id;
  update public.nxq_sales_prospects set status='contacted',last_contacted_at=coalesce(target_sent_at,now()),next_follow_up_at=case when draft_row.sequence_step<3 then coalesce(target_sent_at,now())+interval '4 days' else null end,updated_at=now() where id=draft_row.prospect_id;
  insert into public.nxq_sales_outreach_events(prospect_id,draft_id,event_type,actor_auth_user_id,evidence) values(draft_row.prospect_id,draft_row.id,'message_marked_sent',auth.uid(),jsonb_build_object('channel',draft_row.channel,'manually_confirmed',true));
  return jsonb_build_object('ok',true,'status','sent','next_follow_up_days',case when draft_row.sequence_step<3 then 4 else null end);
end; $$;

create or replace function public.owner_record_sales_opt_out(target_prospect_id uuid,target_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  if length(btrim(coalesce(target_reason,'')))<4 then raise exception 'Opt-out evidence is required.'; end if;
  update public.nxq_sales_prospects set status='do_not_contact',do_not_contact_reason=btrim(target_reason),do_not_contact_at=now(),next_follow_up_at=null,updated_at=now() where id=target_prospect_id;
  if not found then raise exception 'Prospect not found.'; end if;
  update public.nxq_sales_contact_permissions set status='revoked',revoked_at=now(),updated_by_auth_user_id=auth.uid(),updated_at=now() where prospect_id=target_prospect_id;
  update public.nxq_sales_outreach_drafts set status='cancelled',owner_decision_note='Cancelled by do-not-contact hard stop.',updated_at=now() where prospect_id=target_prospect_id and status in ('draft','needs_review','approved');
  insert into public.nxq_sales_outreach_events(prospect_id,event_type,actor_auth_user_id,evidence) values(target_prospect_id,'opt_out_recorded',auth.uid(),jsonb_build_object('reason',btrim(target_reason),'all_channels_revoked',true));
  return jsonb_build_object('ok',true,'status','do_not_contact','all_channels_revoked',true);
end; $$;

create or replace function public.owner_sales_pipeline()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Authenticated owner access required.'; end if;
  return jsonb_build_object(
    'settings',(select to_jsonb(s)-'updated_by_auth_user_id' from public.nxq_sales_outreach_settings s where singleton=true),
    'summary',jsonb_build_object(
      'total',(select count(*) from public.nxq_sales_prospects where status<>'archived'),
      'qualified',(select count(*) from public.nxq_sales_prospects where status in ('qualified','draft_ready','approved_to_contact')),
      'needs_review',(select count(*) from public.nxq_sales_outreach_drafts where status='needs_review'),
      'follow_ups_due',(select count(*) from public.nxq_sales_prospects where next_follow_up_at<=now() and status='contacted'),
      'do_not_contact',(select count(*) from public.nxq_sales_prospects where status='do_not_contact')
    ),
    'prospects',coalesce((select jsonb_agg(to_jsonb(p)-'created_by_auth_user_id' order by p.lead_score desc,p.created_at desc) from (select * from public.nxq_sales_prospects order by lead_score desc,created_at desc limit 300) p),'[]'::jsonb),
    'permissions',coalesce((select jsonb_agg(to_jsonb(x)-'updated_by_auth_user_id' order by x.updated_at desc) from public.nxq_sales_contact_permissions x),'[]'::jsonb),
    'drafts',coalesce((select jsonb_agg(to_jsonb(d)-'created_by_auth_user_id'-'approved_by_auth_user_id' order by d.created_at desc) from (select * from public.nxq_sales_outreach_drafts order by created_at desc limit 500) d),'[]'::jsonb),
    'policy',jsonb_build_object('owner_approval_required_per_message',true,'automatic_send',false,'cold_sms_allowed',false,'cold_discord_dm_allowed',false,'email_requires_postal_address_and_opt_out',true,'opt_out_hard_stop',true)
  );
end; $$;

revoke all on function public.owner_update_sales_outreach_settings(text,text,text) from public,anon;
revoke all on function public.owner_create_sales_prospect(text,text,text,text,text,text,text,text,text,jsonb,text) from public,anon;
revoke all on function public.owner_record_sales_permission(uuid,text,text,text,text,text) from public,anon;
revoke all on function public.owner_create_sales_outreach_draft(uuid,text,integer,text,text,timestamptz) from public,anon;
revoke all on function public.owner_decide_sales_outreach_draft(uuid,text,text) from public,anon;
revoke all on function public.owner_mark_sales_outreach_sent(uuid,timestamptz) from public,anon;
revoke all on function public.owner_record_sales_opt_out(uuid,text) from public,anon;
revoke all on function public.owner_sales_pipeline() from public,anon;

grant execute on function public.owner_update_sales_outreach_settings(text,text,text) to authenticated;
grant execute on function public.owner_create_sales_prospect(text,text,text,text,text,text,text,text,text,jsonb,text) to authenticated;
grant execute on function public.owner_record_sales_permission(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.owner_create_sales_outreach_draft(uuid,text,integer,text,text,timestamptz) to authenticated;
grant execute on function public.owner_decide_sales_outreach_draft(uuid,text,text) to authenticated;
grant execute on function public.owner_mark_sales_outreach_sent(uuid,timestamptz) to authenticated;
grant execute on function public.owner_record_sales_opt_out(uuid,text) to authenticated;
grant execute on function public.owner_sales_pipeline() to authenticated;

comment on table public.nxq_sales_prospects is 'NXQ Web owner-only sales prospects. Separate from client website leads and never visible to clients.';
comment on table public.nxq_sales_outreach_drafts is 'Owner-reviewed outreach drafts. No row is an authorization for autonomous or bulk sending.';
comment on function public.owner_record_sales_opt_out(uuid,text) is 'Atomic all-channel do-not-contact hard stop that revokes permissions and cancels unsent drafts.';
comment on function public.owner_sales_pipeline() is 'Owner-only read model for the NXQ Web sales pipeline without secret or provider-message data.';
