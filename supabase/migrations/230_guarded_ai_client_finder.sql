-- Guarded AI Client Finder and outreach delivery foundation.
-- Discovery uses approved provider APIs only. Zero-key mode creates fictional data.
-- Delivery is disabled by default, requires an owner-approved draft, suppression checks,
-- daily capacity, business-hour controls, and a separate server-side delivery switch.

alter table public.nxq_sales_outreach_settings
  add column if not exists automation_mode text not null default 'review_only' check(automation_mode in ('disabled','review_only','guarded')),
  add column if not exists emergency_stop boolean not null default true,
  add column if not exists daily_email_limit integer not null default 20 check(daily_email_limit between 1 and 50),
  add column if not exists business_timezone text not null default 'America/Los_Angeles',
  add column if not exists send_window_start time not null default '09:00',
  add column if not exists send_window_end time not null default '16:30',
  add column if not exists max_bounce_percent numeric(5,2) not null default 3 check(max_bounce_percent between 0 and 10),
  add column if not exists max_complaint_percent numeric(5,2) not null default 0.10 check(max_complaint_percent between 0 and 1),
  add column if not exists provider_key text,
  add column if not exists provider_connection_status text not null default 'not_configured' check(provider_connection_status in ('not_configured','ready','degraded','disabled')),
  add column if not exists external_delivery_enabled boolean not null default false;

alter table public.nxq_sales_prospects
  add column if not exists normalized_domain text,
  add column if not exists source_provider text,
  add column if not exists source_record_id text,
  add column if not exists source_retrieved_at timestamptz,
  add column if not exists website_audit_status text not null default 'not_run' check(website_audit_status in ('not_run','queued','running','completed','failed','blocked')),
  add column if not exists website_quality_score smallint check(website_quality_score between 0 and 100),
  add column if not exists website_audit_summary jsonb not null default '{}'::jsonb,
  add column if not exists email_validation_status text not null default 'unknown' check(email_validation_status in ('unknown','valid','risky','invalid','disposable','role_account'));

create unique index if not exists nxq_sales_prospects_provider_record_unique on public.nxq_sales_prospects(source_provider,source_record_id) where source_provider is not null and source_record_id is not null;
create index if not exists nxq_sales_prospects_domain_idx on public.nxq_sales_prospects(normalized_domain) where normalized_domain is not null;

create table if not exists public.nxq_sales_source_runs (
  id uuid primary key default gen_random_uuid(),
  run_code text not null unique default ('FIND-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  niche_key text not null,
  geography text not null,
  provider_key text not null,
  mode text not null check(mode in ('fictional','provider_api')),
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  requested_limit integer not null check(requested_limit between 1 and 100),
  discovered_count integer not null default 0 check(discovered_count>=0),
  imported_count integer not null default 0 check(imported_count>=0),
  provider_cost_cents integer not null default 0 check(provider_cost_cents>=0),
  error_message text,
  requested_by_auth_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.nxq_sales_website_audits (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.nxq_sales_prospects(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','completed','failed','blocked')),
  requested_url text,
  final_url text,
  score smallint check(score between 0 and 100),
  checks jsonb not null default '{}'::jsonb,
  factual_findings jsonb not null default '[]'::jsonb,
  failure_reason text,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists nxq_sales_website_audits_prospect_idx on public.nxq_sales_website_audits(prospect_id,created_at desc);

create table if not exists public.nxq_sales_suppressions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check(scope in ('email','domain','phone','prospect')),
  normalized_hash text not null,
  reason text not null check(reason in ('opt_out','hard_bounce','complaint','invalid','duplicate','manual','legal_hold')),
  permanent boolean not null default true,
  prospect_id uuid references public.nxq_sales_prospects(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(scope,normalized_hash)
);

create table if not exists public.nxq_sales_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.nxq_sales_outreach_drafts(id) on delete cascade,
  prospect_id uuid not null references public.nxq_sales_prospects(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','reserved','sending','sent','blocked','failed','cancelled')),
  provider_key text,
  provider_message_id text,
  idempotency_key text not null unique,
  scheduled_for timestamptz not null,
  attempted_at timestamptz,
  sent_at timestamptz,
  blocked_reason text,
  error_message text,
  delivery_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nxq_sales_delivery_jobs_due_idx on public.nxq_sales_delivery_jobs(status,scheduled_for);

create table if not exists public.nxq_sales_reply_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.nxq_sales_prospects(id) on delete cascade,
  draft_id uuid references public.nxq_sales_outreach_drafts(id) on delete set null,
  provider_event_id text unique,
  reply_text text not null,
  classification text not null check(classification in ('interested','question','not_now','not_interested','unsubscribe','wrong_person','out_of_office','unknown')),
  confidence numeric(5,4) check(confidence between 0 and 1),
  requires_owner_review boolean not null default true,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.nxq_sales_source_runs enable row level security;
alter table public.nxq_sales_website_audits enable row level security;
alter table public.nxq_sales_suppressions enable row level security;
alter table public.nxq_sales_delivery_jobs enable row level security;
alter table public.nxq_sales_reply_events enable row level security;

revoke all on table public.nxq_sales_source_runs,public.nxq_sales_website_audits,public.nxq_sales_suppressions,public.nxq_sales_delivery_jobs,public.nxq_sales_reply_events from public,anon,authenticated;
grant select on table public.nxq_sales_source_runs,public.nxq_sales_website_audits,public.nxq_sales_suppressions,public.nxq_sales_delivery_jobs,public.nxq_sales_reply_events to authenticated;
grant select,insert,update,delete on table public.nxq_sales_source_runs,public.nxq_sales_website_audits,public.nxq_sales_suppressions,public.nxq_sales_delivery_jobs,public.nxq_sales_reply_events to service_role;

create policy owner_read_sales_source_runs on public.nxq_sales_source_runs for select to authenticated using(public.is_nxq_owner());
create policy owner_read_sales_website_audits on public.nxq_sales_website_audits for select to authenticated using(public.is_nxq_owner());
create policy owner_read_sales_suppressions on public.nxq_sales_suppressions for select to authenticated using(public.is_nxq_owner());
create policy owner_read_sales_delivery_jobs on public.nxq_sales_delivery_jobs for select to authenticated using(public.is_nxq_owner());
create policy owner_read_sales_reply_events on public.nxq_sales_reply_events for select to authenticated using(public.is_nxq_owner());

create or replace function public.owner_update_client_finder_settings(
  target_automation_mode text,
  target_emergency_stop boolean,
  target_daily_email_limit integer,
  target_business_timezone text,
  target_send_window_start time,
  target_send_window_end time
)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  if target_automation_mode not in ('disabled','review_only','guarded') then raise exception 'Invalid automation mode.'; end if;
  if target_daily_email_limit not between 1 and 50 then raise exception 'Daily email limit must be between 1 and 50.'; end if;
  if target_send_window_start>=target_send_window_end then raise exception 'Send window start must precede end.'; end if;
  update public.nxq_sales_outreach_settings set automation_mode=target_automation_mode,emergency_stop=target_emergency_stop,daily_email_limit=target_daily_email_limit,business_timezone=left(btrim(target_business_timezone),80),send_window_start=target_send_window_start,send_window_end=target_send_window_end,updated_by_auth_user_id=auth.uid(),updated_at=now() where singleton=true;
  return jsonb_build_object('ok',true,'automation_mode',target_automation_mode,'emergency_stop',target_emergency_stop,'external_delivery_enabled',false,'note','The database switch does not enable the server-side delivery environment switch.');
end; $$;

create or replace function public.owner_create_fictional_sales_source_run(target_niche_key text,target_geography text,target_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=public as $$
declare run_id uuid; i integer; prospect_id uuid; safe_limit integer:=least(greatest(target_limit,1),20); niches text[]:=array['tree_services','roofing','auto_services'];
begin
  if not public.is_nxq_owner() and auth.role()<>'service_role' then raise exception 'Owner access required.'; end if;
  if not target_niche_key=any(niches) then raise exception 'Fictional discovery is limited to the approved launch niches.'; end if;
  insert into public.nxq_sales_source_runs(niche_key,geography,provider_key,mode,status,requested_limit,requested_by_auth_user_id,started_at) values(target_niche_key,left(btrim(target_geography),120),'zero_key_fictional','fictional','running',safe_limit,auth.uid(),now()) returning id into run_id;
  for i in 1..safe_limit loop
    insert into public.nxq_sales_prospects(business_name,niche_key,city,state_region,contact_email,source_url,status,priority,qualification_signals,research_notes,source_provider,source_record_id,source_retrieved_at,email_validation_status)
    values('NXQ Fictional '||replace(initcap(target_niche_key),'_',' ')||' '||i,target_niche_key,split_part(target_geography,',',1),null,'qa-client-finder-'||substr(run_id::text,1,8)||'-'||i||'@example.invalid','https://example.invalid/nxq-fictional-source','research','normal',jsonb_build_object('no_website',true,'fictional',true),'Reserved fictional QA record. Never deliver externally.','zero_key_fictional',run_id::text||':'||i,now(),'invalid')
    returning id into prospect_id;
    insert into public.nxq_sales_suppressions(scope,normalized_hash,reason,permanent,prospect_id,evidence) values('prospect',encode(digest(prospect_id::text,'sha256'),'hex'),'legal_hold',true,prospect_id,jsonb_build_object('fictional',true,'external_delivery_forbidden',true)) on conflict do nothing;
    insert into public.nxq_sales_outreach_events(prospect_id,event_type,actor_auth_user_id,evidence) values(prospect_id,'prospect_created',auth.uid(),jsonb_build_object('source_run_id',run_id,'fictional',true));
  end loop;
  update public.nxq_sales_source_runs set status='completed',discovered_count=safe_limit,imported_count=safe_limit,completed_at=now() where id=run_id;
  return jsonb_build_object('ok',true,'run_id',run_id,'mode','fictional','created',safe_limit,'external_delivery',false);
end; $$;

create or replace function public.nxq_queue_sales_delivery(target_draft_id uuid,target_scheduled_for timestamptz,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.nxq_sales_outreach_drafts%rowtype; p public.nxq_sales_prospects%rowtype; s public.nxq_sales_outreach_settings%rowtype; job_id uuid; target_hash text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into d from public.nxq_sales_outreach_drafts where id=target_draft_id for update;
  if not found or d.status<>'approved' or d.channel<>'email' then raise exception 'Only an owner-approved email draft can be queued.'; end if;
  select * into p from public.nxq_sales_prospects where id=d.prospect_id for update;
  select * into s from public.nxq_sales_outreach_settings where singleton=true;
  if s.emergency_stop or s.automation_mode<>'guarded' or not s.external_delivery_enabled then raise exception 'External outreach delivery is disabled.'; end if;
  if p.status='do_not_contact' or p.contact_email is null or p.email_validation_status not in ('valid','role_account') then raise exception 'Recipient is suppressed or does not have a deliverable business email.'; end if;
  target_hash:=encode(digest(lower(btrim(p.contact_email)),'sha256'),'hex');
  if exists(select 1 from public.nxq_sales_suppressions where scope='email' and normalized_hash=target_hash and permanent) or exists(select 1 from public.nxq_sales_suppressions where scope='prospect' and prospect_id=p.id and permanent) then raise exception 'Recipient is permanently suppressed.'; end if;
  if (select count(*) from public.nxq_sales_delivery_jobs where status='sent' and sent_at>=date_trunc('day',now() at time zone s.business_timezone) at time zone s.business_timezone)>=s.daily_email_limit then raise exception 'Daily outreach limit reached.'; end if;
  insert into public.nxq_sales_delivery_jobs(draft_id,prospect_id,idempotency_key,scheduled_for) values(d.id,p.id,left(target_idempotency_key,180),target_scheduled_for) returning id into job_id;
  return jsonb_build_object('ok',true,'job_id',job_id,'status','queued','requires_server_delivery_switch',true);
end; $$;

create or replace function public.nxq_reserve_sales_delivery(target_job_id uuid,target_server_delivery_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.nxq_sales_delivery_jobs%rowtype; d public.nxq_sales_outreach_drafts%rowtype; p public.nxq_sales_prospects%rowtype; s public.nxq_sales_outreach_settings%rowtype; local_now timestamp; target_hash text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into j from public.nxq_sales_delivery_jobs where id=target_job_id and status='queued' and scheduled_for<=now() for update skip locked;
  if not found then return jsonb_build_object('ok',false,'reason','job_unavailable'); end if;
  select * into d from public.nxq_sales_outreach_drafts where id=j.draft_id;
  select * into p from public.nxq_sales_prospects where id=j.prospect_id;
  select * into s from public.nxq_sales_outreach_settings where singleton=true;
  local_now:=now() at time zone s.business_timezone;
  if not target_server_delivery_enabled or s.emergency_stop or not s.external_delivery_enabled or s.provider_connection_status<>'ready' then update public.nxq_sales_delivery_jobs set status='blocked',blocked_reason='delivery_switch_or_provider_not_ready',updated_at=now() where id=j.id; return jsonb_build_object('ok',false,'reason','delivery_disabled'); end if;
  if d.status<>'approved' then update public.nxq_sales_delivery_jobs set status='blocked',blocked_reason='draft_not_approved',updated_at=now() where id=j.id; return jsonb_build_object('ok',false,'reason','draft_not_approved'); end if;
  if p.status='do_not_contact' or p.contact_email is null or p.email_validation_status not in ('valid','role_account') then update public.nxq_sales_delivery_jobs set status='blocked',blocked_reason='recipient_not_deliverable',updated_at=now() where id=j.id; return jsonb_build_object('ok',false,'reason','recipient_not_deliverable'); end if;
  target_hash:=encode(digest(lower(btrim(p.contact_email)),'sha256'),'hex');
  if exists(select 1 from public.nxq_sales_suppressions where permanent and ((scope='email' and normalized_hash=target_hash) or (scope='prospect' and prospect_id=p.id))) then update public.nxq_sales_delivery_jobs set status='blocked',blocked_reason='recipient_suppressed',updated_at=now() where id=j.id; return jsonb_build_object('ok',false,'reason','recipient_suppressed'); end if;
  if local_now::time<s.send_window_start or local_now::time>s.send_window_end or extract(isodow from local_now) in (6,7) then return jsonb_build_object('ok',false,'reason','outside_business_hours'); end if;
  if (select count(*) from public.nxq_sales_delivery_jobs where status='sent' and sent_at>=date_trunc('day',now() at time zone s.business_timezone) at time zone s.business_timezone)>=s.daily_email_limit then return jsonb_build_object('ok',false,'reason','daily_limit_reached'); end if;
  update public.nxq_sales_delivery_jobs set status='reserved',attempted_at=now(),updated_at=now() where id=j.id;
  return jsonb_build_object('ok',true,'job_id',j.id,'status','reserved');
end; $$;

create or replace function public.nxq_record_sales_delivery_event(target_job_id uuid,target_event_type text,target_provider_message_id text default null,target_error text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.nxq_sales_delivery_jobs%rowtype; p public.nxq_sales_prospects%rowtype; delivered integer; bounced integer; complained integer; s public.nxq_sales_outreach_settings%rowtype; email_hash text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if target_event_type not in ('sent','soft_bounce','hard_bounce','complaint','failed') then raise exception 'Invalid delivery event.'; end if;
  select * into j from public.nxq_sales_delivery_jobs where id=target_job_id for update;
  if not found then raise exception 'Delivery job not found.'; end if;
  select * into p from public.nxq_sales_prospects where id=j.prospect_id for update;
  update public.nxq_sales_delivery_jobs set status=case when target_event_type='sent' then 'sent' when target_event_type in ('hard_bounce','complaint') then 'blocked' else 'failed' end,provider_message_id=coalesce(left(target_provider_message_id,180),provider_message_id),sent_at=case when target_event_type='sent' then now() else sent_at end,error_message=left(target_error,2000),blocked_reason=case when target_event_type in ('hard_bounce','complaint') then target_event_type else blocked_reason end,updated_at=now() where id=j.id;
  if target_event_type in ('hard_bounce','complaint') and p.contact_email is not null then
    email_hash:=encode(digest(lower(btrim(p.contact_email)),'sha256'),'hex');
    insert into public.nxq_sales_suppressions(scope,normalized_hash,reason,permanent,prospect_id,evidence) values('email',email_hash,target_event_type,true,p.id,jsonb_build_object('job_id',j.id)) on conflict(scope,normalized_hash) do update set reason=excluded.reason,permanent=true,evidence=excluded.evidence;
    update public.nxq_sales_prospects set status='do_not_contact',do_not_contact_reason='Provider reported '||target_event_type,do_not_contact_at=now(),updated_at=now() where id=p.id;
  end if;
  select * into s from public.nxq_sales_outreach_settings where singleton=true for update;
  select count(*) filter(where status='sent'),count(*) filter(where blocked_reason='hard_bounce'),count(*) filter(where blocked_reason='complaint') into delivered,bounced,complained from public.nxq_sales_delivery_jobs where coalesce(sent_at,attempted_at,created_at)>=now()-interval '30 days';
  if delivered>=20 and ((bounced::numeric/greatest(delivered,1))*100>s.max_bounce_percent or (complained::numeric/greatest(delivered,1))*100>s.max_complaint_percent) then update public.nxq_sales_outreach_settings set emergency_stop=true,updated_at=now() where singleton=true; end if;
  return jsonb_build_object('ok',true,'status',target_event_type,'suppressed',target_event_type in ('hard_bounce','complaint'),'emergency_stop',(select emergency_stop from public.nxq_sales_outreach_settings where singleton=true));
end; $$;

create or replace function public.owner_record_sales_reply(target_prospect_id uuid,target_reply_text text,target_classification text,target_confidence numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare reply_id uuid;
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  if target_classification not in ('interested','question','not_now','not_interested','unsubscribe','wrong_person','out_of_office','unknown') then raise exception 'Invalid reply classification.'; end if;
  insert into public.nxq_sales_reply_events(prospect_id,reply_text,classification,confidence) values(target_prospect_id,left(target_reply_text,10000),target_classification,target_confidence) returning id into reply_id;
  update public.nxq_sales_prospects set status=case when target_classification='unsubscribe' then 'do_not_contact' when target_classification in ('interested','question') then 'replied' when target_classification in ('not_interested','wrong_person') then 'lost' else status end,do_not_contact_reason=case when target_classification='unsubscribe' then 'Reply requested unsubscribe.' else do_not_contact_reason end,do_not_contact_at=case when target_classification='unsubscribe' then now() else do_not_contact_at end,updated_at=now() where id=target_prospect_id;
  if target_classification='unsubscribe' then
    update public.nxq_sales_contact_permissions set status='revoked',revoked_at=now(),updated_at=now() where prospect_id=target_prospect_id;
    insert into public.nxq_sales_suppressions(scope,normalized_hash,reason,prospect_id,evidence) select 'email',encode(digest(lower(btrim(contact_email)),'sha256'),'hex'),'opt_out',id,jsonb_build_object('reply_id',reply_id) from public.nxq_sales_prospects where id=target_prospect_id and contact_email is not null on conflict(scope,normalized_hash) do update set reason='opt_out',permanent=true,evidence=excluded.evidence;
  end if;
  insert into public.nxq_sales_outreach_events(prospect_id,event_type,actor_auth_user_id,evidence) values(target_prospect_id,case when target_classification='unsubscribe' then 'opt_out_recorded' else 'reply_recorded' end,auth.uid(),jsonb_build_object('reply_id',reply_id,'classification',target_classification));
  return jsonb_build_object('ok',true,'reply_id',reply_id,'classification',target_classification,'suppressed',target_classification='unsubscribe');
end; $$;

create or replace function public.owner_client_finder_dashboard()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  return jsonb_build_object(
    'settings',(select to_jsonb(s) from public.nxq_sales_outreach_settings s where singleton=true),
    'summary',jsonb_build_object(
      'source_runs',(select count(*) from public.nxq_sales_source_runs),
      'fictional_prospects',(select count(*) from public.nxq_sales_prospects where source_provider='zero_key_fictional'),
      'audits_complete',(select count(*) from public.nxq_sales_website_audits where status='completed'),
      'drafts_needing_review',(select count(*) from public.nxq_sales_outreach_drafts where status='needs_review'),
      'approved_not_sent',(select count(*) from public.nxq_sales_outreach_drafts where status='approved'),
      'suppressed',(select count(*) from public.nxq_sales_suppressions where permanent),
      'replies_needing_review',(select count(*) from public.nxq_sales_reply_events where requires_owner_review and processed_at is null)
    ),
    'recent_runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,run_code,niche_key,geography,mode,status,requested_limit,imported_count,provider_cost_cents,created_at from public.nxq_sales_source_runs limit 20) x),'[]'::jsonb),
    'recent_audits',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select a.id,a.prospect_id,p.business_name,a.status,a.score,a.factual_findings,a.checked_at,a.created_at from public.nxq_sales_website_audits a join public.nxq_sales_prospects p on p.id=a.prospect_id limit 20) x),'[]'::jsonb),
    'recent_replies',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select r.id,r.prospect_id,p.business_name,r.classification,r.confidence,r.requires_owner_review,r.created_at from public.nxq_sales_reply_events r join public.nxq_sales_prospects p on p.id=r.prospect_id limit 20) x),'[]'::jsonb)
  );
end; $$;

create or replace function public.nxq_create_due_sales_followup_drafts(target_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p record; next_step integer; created_count integer:=0; safe_limit integer:=least(greatest(target_limit,1),50);
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  for p in
    select prospect.* from public.nxq_sales_prospects prospect
    where prospect.status='contacted' and prospect.next_follow_up_at<=now()
      and prospect.do_not_contact_at is null
      and not exists(select 1 from public.nxq_sales_reply_events reply where reply.prospect_id=prospect.id and reply.classification not in ('out_of_office','unknown'))
      and not exists(select 1 from public.nxq_sales_suppressions suppression where suppression.prospect_id=prospect.id and suppression.permanent)
    order by prospect.next_follow_up_at,prospect.lead_score desc for update skip locked limit safe_limit
  loop
    select coalesce(max(sequence_step),0)+1 into next_step from public.nxq_sales_outreach_drafts where prospect_id=p.id and channel='email';
    if next_step between 2 and 3 then
      insert into public.nxq_sales_outreach_drafts(prospect_id,channel,sequence_step,subject,body,status,compliance_snapshot)
      values(p.id,'email',next_step,'Quick follow-up for '||left(p.business_name,120),'Hi '||coalesce(nullif(p.contact_name,''),'there')||E',\n\nI wanted to follow up on the website notes I shared for '||p.business_name||E'. If improving the site is not a priority, reply unsubscribe and I will close this out.\n\nChristian at NXQ Web','needs_review',jsonb_build_object('owner_approval_required',true,'automatic_send',false,'follow_up',true,'created_at',now()))
      on conflict(prospect_id,channel,sequence_step) do nothing;
      update public.nxq_sales_prospects set status='draft_ready',next_follow_up_at=null,updated_at=now() where id=p.id;
      created_count:=created_count+1;
    else
      update public.nxq_sales_prospects set next_follow_up_at=null,updated_at=now() where id=p.id;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'drafts_created',created_count,'owner_review_required',true,'external_delivery',false);
end; $$;

revoke all on function public.owner_update_client_finder_settings(text,boolean,integer,text,time,time),public.owner_create_fictional_sales_source_run(text,text,integer),public.nxq_queue_sales_delivery(uuid,timestamptz,text),public.nxq_reserve_sales_delivery(uuid,boolean),public.nxq_record_sales_delivery_event(uuid,text,text,text),public.owner_record_sales_reply(uuid,text,text,numeric),public.owner_client_finder_dashboard(),public.nxq_create_due_sales_followup_drafts(integer) from public,anon;
grant execute on function public.owner_update_client_finder_settings(text,boolean,integer,text,time,time),public.owner_create_fictional_sales_source_run(text,text,integer),public.owner_record_sales_reply(uuid,text,text,numeric),public.owner_client_finder_dashboard() to authenticated;
grant execute on function public.nxq_queue_sales_delivery(uuid,timestamptz,text),public.nxq_reserve_sales_delivery(uuid,boolean),public.nxq_record_sales_delivery_event(uuid,text,text,text),public.nxq_create_due_sales_followup_drafts(integer) to service_role;

comment on table public.nxq_sales_source_runs is 'Auditable provider-API discovery jobs. Zero-key runs contain fictional example.invalid records only.';
comment on table public.nxq_sales_suppressions is 'Permanent hashed suppression list checked before every delivery reservation.';
comment on function public.nxq_reserve_sales_delivery(uuid,boolean) is 'Final delivery gate: server switch, DB switch, provider health, suppression, approval, daily cap, and business hours must all pass.';
