-- NXQ referral rewards, Founding Business Grant, and server-side cost guards.
-- Financial invariants:
--   * rewards are non-cash, non-transferable account credits;
--   * a referred client must complete a verified first payment;
--   * credits remain pending through a configurable dispute window;
--   * an invoice can never be reduced below the configured $10 floor;
--   * QA-only clients and suspicious/self referrals never earn rewards.

create extension if not exists pgcrypto;

create table if not exists public.nxq_growth_program_settings (
  singleton boolean primary key default true check(singleton),
  referral_program_enabled boolean not null default false,
  referral_credit_amount numeric(10,2) not null default 10 check(referral_credit_amount > 0),
  referred_first_invoice_discount numeric(10,2) not null default 10 check(referred_first_invoice_discount > 0),
  minimum_invoice_payment numeric(10,2) not null default 10 check(minimum_invoice_payment >= 10),
  referral_hold_days integer not null default 14 check(referral_hold_days between 7 and 90),
  founding_grant_public_enrollment_enabled boolean not null default false,
  founding_grant_legal_review_complete boolean not null default false,
  founding_grant_cohort_limit integer not null default 10000 check(founding_grant_cohort_limit = 10000),
  founding_grant_award_limit integer not null default 10 check(founding_grant_award_limit = 10),
  founding_grant_monthly_cost_cap numeric(10,2) not null default 50 check(founding_grant_monthly_cost_cap = 50),
  updated_by_auth_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.nxq_growth_program_settings(singleton) values(true) on conflict(singleton) do nothing;

alter table public.billing_provider_events drop constraint if exists billing_provider_events_event_type_check;
alter table public.billing_provider_events add constraint billing_provider_events_event_type_check check(event_type in ('payment_succeeded','payment_failed','subscription_cancelled','subscription_active','payment_refunded','payment_disputed'));

create table if not exists public.nxq_referral_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  referral_code text not null unique check(referral_code ~ '^[A-Z0-9]{8,20}$'),
  status text not null default 'active' check(status in ('active','paused','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nxq_referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referrer_client_id uuid not null references public.clients(id) on delete cascade,
  referred_client_id uuid not null unique references public.clients(id) on delete cascade,
  referral_code text not null,
  status text not null default 'pending_payment' check(status in ('pending_payment','holding','qualified','blocked','reversed')),
  attributed_at timestamptz not null default now(),
  first_payment_provider text,
  first_payment_event_id text,
  first_payment_amount numeric(10,2),
  first_payment_at timestamptz,
  hold_until timestamptz,
  qualified_at timestamptz,
  blocked_reason text,
  risk_score smallint not null default 0 check(risk_score between 0 and 100),
  risk_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(referrer_client_id <> referred_client_id),
  unique(referrer_client_id,referred_client_id)
);
create index if not exists nxq_referral_attributions_maturity_idx on public.nxq_referral_attributions(status,hold_until);

create table if not exists public.nxq_referral_risk_signals (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null references public.nxq_referral_attributions(id) on delete cascade,
  signal_type text not null check(signal_type in ('same_payment_method','same_email_domain','same_phone','same_address','same_device','same_ip','disposable_email','owner_related','refund','dispute','late_attribution','suspicious_cluster','manual_review')),
  severity smallint not null check(severity between 1 and 100),
  evidence_hash text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(attribution_id,signal_type,evidence_hash)
);

create table if not exists public.nxq_referral_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  attribution_id uuid references public.nxq_referral_attributions(id) on delete restrict,
  entry_type text not null check(entry_type in ('earned','applied','reversed','expired','adjustment')),
  status text not null check(status in ('pending','available','applied','reversed')),
  amount numeric(10,2) not null check(amount <> 0),
  remaining_amount numeric(10,2) not null default 0 check(remaining_amount >= 0),
  provider_invoice_id text,
  idempotency_key text not null unique,
  description text not null,
  available_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check((entry_type='earned' and amount>0) or (entry_type<>'earned')),
  check(remaining_amount <= greatest(amount,0))
);
create index if not exists nxq_referral_credit_fifo_idx on public.nxq_referral_credit_ledger(client_id,status,available_at,created_at);

create table if not exists public.nxq_invoice_credit_applications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_key text not null,
  provider_invoice_id text not null,
  invoice_subtotal numeric(10,2) not null check(invoice_subtotal >= 0),
  credit_applied numeric(10,2) not null check(credit_applied >= 0),
  amount_due numeric(10,2) not null check(amount_due >= 10),
  created_at timestamptz not null default now(),
  unique(provider_key,provider_invoice_id),
  check(credit_applied <= greatest(invoice_subtotal-10,0)),
  check(amount_due = invoice_subtotal-credit_applied)
);

create table if not exists public.nxq_founding_grant_applications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  cohort_position integer not null check(cohort_position between 1 and 10000),
  status text not null default 'draft' check(status in ('draft','submitted','eligible','selected','not_selected','revoked')),
  application_statement text,
  eligibility_evidence jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by_auth_user_id uuid references auth.users(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nxq_founding_grant_awards (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.nxq_founding_grant_applications(id) on delete restrict,
  client_id uuid not null unique references public.clients(id) on delete cascade,
  status text not null default 'active' check(status in ('active','paused','revoked','ended')),
  monthly_nxq_cost_cap numeric(10,2) not null default 50 check(monthly_nxq_cost_cap = 50),
  terms_version text not null,
  qualifying_service_note text not null default 'No-subscription base website and hosting while the qualifying service remains offered and the account remains in good standing. No cash value or transfer.',
  awarded_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.nxq_client_resource_policies (
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_key text not null check(resource_key in ('api_requests','ai_tokens','storage_bytes','bandwidth_bytes','form_submissions','content_edits','automation_jobs','outreach_messages','provider_cost_cents')),
  monthly_limit bigint not null check(monthly_limit >= 0),
  warning_percent smallint not null default 80 check(warning_percent between 50 and 99),
  hard_stop boolean not null default true,
  policy_source text not null default 'tier',
  updated_at timestamptz not null default now(),
  primary key(client_id,resource_key)
);

create table if not exists public.nxq_client_resource_reservations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  resource_key text not null,
  units bigint not null check(units > 0),
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(client_id,resource_key,idempotency_key),
  foreign key(client_id,resource_key) references public.nxq_client_resource_policies(client_id,resource_key) on delete cascade
);
create index if not exists nxq_resource_reservations_month_idx on public.nxq_client_resource_reservations(client_id,resource_key,occurred_at);

create table if not exists public.nxq_tier_resource_defaults (
  tier_key text not null check(tier_key in ('starter','growth','intelligence','enterprise')),
  resource_key text not null check(resource_key in ('api_requests','ai_tokens','storage_bytes','bandwidth_bytes','form_submissions','content_edits','automation_jobs','outreach_messages','provider_cost_cents')),
  monthly_limit bigint not null check(monthly_limit>=0),
  warning_percent smallint not null default 80 check(warning_percent between 50 and 99),
  primary key(tier_key,resource_key)
);

insert into public.nxq_tier_resource_defaults(tier_key,resource_key,monthly_limit)
values
  ('starter','api_requests',2500),('starter','ai_tokens',25000),('starter','storage_bytes',268435456),('starter','bandwidth_bytes',5368709120),('starter','form_submissions',100),('starter','content_edits',20),('starter','automation_jobs',100),('starter','outreach_messages',0),('starter','provider_cost_cents',1000),
  ('growth','api_requests',10000),('growth','ai_tokens',100000),('growth','storage_bytes',1073741824),('growth','bandwidth_bytes',21474836480),('growth','form_submissions',500),('growth','content_edits',100),('growth','automation_jobs',500),('growth','outreach_messages',0),('growth','provider_cost_cents',6000),
  ('intelligence','api_requests',30000),('intelligence','ai_tokens',300000),('intelligence','storage_bytes',2147483648),('intelligence','bandwidth_bytes',53687091200),('intelligence','form_submissions',1500),('intelligence','content_edits',300),('intelligence','automation_jobs',1500),('intelligence','outreach_messages',0),('intelligence','provider_cost_cents',11000),
  ('enterprise','api_requests',100000),('enterprise','ai_tokens',1000000),('enterprise','storage_bytes',10737418240),('enterprise','bandwidth_bytes',214748364800),('enterprise','form_submissions',10000),('enterprise','content_edits',2000),('enterprise','automation_jobs',10000),('enterprise','outreach_messages',0),('enterprise','provider_cost_cents',11000)
on conflict(tier_key,resource_key) do update set monthly_limit=excluded.monthly_limit,warning_percent=excluded.warning_percent;

alter table public.nxq_growth_program_settings enable row level security;
alter table public.nxq_referral_profiles enable row level security;
alter table public.nxq_referral_attributions enable row level security;
alter table public.nxq_referral_risk_signals enable row level security;
alter table public.nxq_referral_credit_ledger enable row level security;
alter table public.nxq_invoice_credit_applications enable row level security;
alter table public.nxq_founding_grant_applications enable row level security;
alter table public.nxq_founding_grant_awards enable row level security;
alter table public.nxq_client_resource_policies enable row level security;
alter table public.nxq_client_resource_reservations enable row level security;
alter table public.nxq_tier_resource_defaults enable row level security;

revoke all on table public.nxq_growth_program_settings,public.nxq_referral_profiles,public.nxq_referral_attributions,public.nxq_referral_risk_signals,public.nxq_referral_credit_ledger,public.nxq_invoice_credit_applications,public.nxq_founding_grant_applications,public.nxq_founding_grant_awards,public.nxq_client_resource_policies,public.nxq_client_resource_reservations from public,anon,authenticated;
revoke all on table public.nxq_tier_resource_defaults from public,anon,authenticated;
grant select on table public.nxq_growth_program_settings,public.nxq_referral_profiles,public.nxq_referral_attributions,public.nxq_referral_credit_ledger,public.nxq_invoice_credit_applications,public.nxq_founding_grant_applications,public.nxq_founding_grant_awards,public.nxq_client_resource_policies,public.nxq_client_resource_reservations to authenticated;
grant select,insert,update,delete on table public.nxq_growth_program_settings,public.nxq_referral_profiles,public.nxq_referral_attributions,public.nxq_referral_risk_signals,public.nxq_referral_credit_ledger,public.nxq_invoice_credit_applications,public.nxq_founding_grant_applications,public.nxq_founding_grant_awards,public.nxq_client_resource_policies,public.nxq_client_resource_reservations to service_role;
grant select,insert,update,delete on table public.nxq_tier_resource_defaults to service_role;

create policy growth_settings_owner_read on public.nxq_growth_program_settings for select to authenticated using(public.is_nxq_owner());
create policy referral_profile_owner_or_client_read on public.nxq_referral_profiles for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());
create policy referral_attribution_owner_or_client_read on public.nxq_referral_attributions for select to authenticated using(public.is_nxq_owner() or referrer_client_id=public.current_client_id() or referred_client_id=public.current_client_id());
create policy referral_ledger_owner_or_client_read on public.nxq_referral_credit_ledger for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());
create policy invoice_credit_owner_or_client_read on public.nxq_invoice_credit_applications for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());
create policy grant_application_owner_or_client_read on public.nxq_founding_grant_applications for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());
create policy grant_award_owner_or_client_read on public.nxq_founding_grant_awards for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());
create policy resource_policy_owner_or_client_read on public.nxq_client_resource_policies for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());
create policy resource_reservation_owner_or_client_read on public.nxq_client_resource_reservations for select to authenticated using(public.is_nxq_owner() or client_id=public.current_client_id());

create or replace function public.nxq_ensure_referral_profile(target_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c uuid; p public.nxq_referral_profiles%rowtype; candidate text;
begin
  c:=coalesce(target_client_id,public.current_client_id());
  if c is null then raise exception 'Client workspace not found.'; end if;
  if target_client_id is not null and target_client_id<>public.current_client_id() and not public.is_nxq_owner() and auth.role()<>'service_role' then raise exception 'Access denied.'; end if;
  select * into p from public.nxq_referral_profiles where client_id=c;
  if not found then
    candidate:='NXQ'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,9));
    insert into public.nxq_referral_profiles(client_id,referral_code) values(c,candidate) returning * into p;
  end if;
  return jsonb_build_object('client_id',p.client_id,'referral_code',p.referral_code,'status',p.status);
end; $$;

create or replace function public.nxq_claim_referral(target_referral_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare referred uuid:=public.current_client_id(); referrer uuid; program public.nxq_growth_program_settings%rowtype; attribution_id uuid;
begin
  if referred is null then raise exception 'Client workspace not found.'; end if;
  select * into program from public.nxq_growth_program_settings where singleton=true;
  if not program.referral_program_enabled then raise exception 'The referral program is not open yet.'; end if;
  select client_id into referrer from public.nxq_referral_profiles where referral_code=upper(btrim(target_referral_code)) and status='active';
  if referrer is null then raise exception 'Referral code not found.'; end if;
  if referrer=referred then raise exception 'Self-referrals are not allowed.'; end if;
  if exists(select 1 from public.clients where id in (referrer,referred) and coalesce(qa_only,false)) then raise exception 'QA-only clients cannot participate in referrals.'; end if;
  if exists(select 1 from public.billing_provider_events where client_id=referred and applied and not ignored and event_type in ('payment_succeeded','subscription_active')) then raise exception 'Referral attribution must be completed before the first verified payment.'; end if;
  insert into public.nxq_referral_attributions(referrer_client_id,referred_client_id,referral_code)
  values(referrer,referred,upper(btrim(target_referral_code))) returning id into attribution_id;
  insert into public.nxq_referral_credit_ledger(client_id,attribution_id,entry_type,status,amount,remaining_amount,idempotency_key,description,available_at,metadata)
  values(referred,attribution_id,'earned','available',program.referred_first_invoice_discount,program.referred_first_invoice_discount,'referred-first-invoice:'||attribution_id::text,'Referred-client first invoice discount',now(),jsonb_build_object('first_invoice_only',true,'cash_value',false))
  on conflict(idempotency_key) do nothing;
  insert into public.activity_logs(client_id,actor_type,action,details) values(referred,'client','referral_attributed',jsonb_build_object('attribution_id',attribution_id,'referrer_client_id',referrer,'cash_value',false));
  return jsonb_build_object('ok',true,'attribution_id',attribution_id,'status','pending_payment','discount_eligibility','first_verified_invoice_only');
exception when unique_violation then raise exception 'This client already has a referral attribution.';
end; $$;

create or replace function public.nxq_record_referral_first_payment(target_client_id uuid,target_provider text,target_event_id text,target_amount numeric,target_paid_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.nxq_referral_attributions%rowtype; hold_days integer;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into a from public.nxq_referral_attributions where referred_client_id=target_client_id for update;
  if not found then return jsonb_build_object('ok',true,'ignored',true,'reason','no_referral_attribution'); end if;
  if a.status in ('blocked','reversed','qualified') then return jsonb_build_object('ok',true,'ignored',true,'status',a.status); end if;
  if a.status='holding' or a.first_payment_event_id is not null then return jsonb_build_object('ok',true,'ignored',true,'reason','first_payment_already_recorded','status',a.status,'hold_until',a.hold_until); end if;
  select referral_hold_days into hold_days from public.nxq_growth_program_settings where singleton=true;
  update public.nxq_referral_attributions set status='holding',first_payment_provider=left(target_provider,80),first_payment_event_id=left(target_event_id,180),first_payment_amount=target_amount,first_payment_at=target_paid_at,hold_until=target_paid_at+make_interval(days=>hold_days),updated_at=now() where id=a.id;
  return jsonb_build_object('ok',true,'status','holding','hold_until',target_paid_at+make_interval(days=>hold_days));
end; $$;

create or replace function public.nxq_mature_referral_credits(target_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; reward numeric; processed integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select referral_credit_amount into reward from public.nxq_growth_program_settings where singleton=true;
  for a in select * from public.nxq_referral_attributions where status='holding' and hold_until<=now() and risk_score<50 order by hold_until for update skip locked limit least(greatest(target_limit,1),500)
  loop
    if exists(select 1 from public.nxq_referral_risk_signals where attribution_id=a.id and signal_type in ('refund','dispute','same_payment_method','owner_related') and severity>=50) then
      update public.nxq_referral_attributions set status='blocked',blocked_reason='risk_review_required',updated_at=now() where id=a.id;
      continue;
    end if;
    update public.nxq_referral_attributions set status='qualified',qualified_at=now(),updated_at=now() where id=a.id;
    insert into public.nxq_referral_credit_ledger(client_id,attribution_id,entry_type,status,amount,remaining_amount,idempotency_key,description,available_at)
    values(a.referrer_client_id,a.id,'earned','available',reward,reward,'referrer:'||a.id::text,'Qualified referral reward',now()) on conflict(idempotency_key) do nothing;
    processed:=processed+1;
  end loop;
  return jsonb_build_object('ok',true,'matured',processed);
end; $$;

create or replace function public.nxq_apply_referral_credit(target_client_id uuid,target_provider_key text,target_provider_invoice_id text,target_invoice_subtotal numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare floor_amount numeric; cap numeric; available numeric; apply_amount numeric; remaining numeric; row_record record;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if target_invoice_subtotal<10 then raise exception 'Invoice subtotal is below the protected minimum.'; end if;
  if exists(select 1 from public.nxq_invoice_credit_applications where provider_key=target_provider_key and provider_invoice_id=target_provider_invoice_id) then
    return (select to_jsonb(x) from public.nxq_invoice_credit_applications x where provider_key=target_provider_key and provider_invoice_id=target_provider_invoice_id);
  end if;
  select minimum_invoice_payment into floor_amount from public.nxq_growth_program_settings where singleton=true;
  cap:=greatest(target_invoice_subtotal-floor_amount,0);
  select coalesce(sum(remaining_amount),0) into available from public.nxq_referral_credit_ledger where client_id=target_client_id and status='available' and remaining_amount>0;
  apply_amount:=least(cap,available); remaining:=apply_amount;
  for row_record in select id,remaining_amount from public.nxq_referral_credit_ledger where client_id=target_client_id and status='available' and remaining_amount>0 order by available_at,created_at for update
  loop
    exit when remaining<=0;
    update public.nxq_referral_credit_ledger set remaining_amount=greatest(remaining_amount-least(remaining,row_record.remaining_amount),0),status=case when remaining_amount-least(remaining,row_record.remaining_amount)<=0 then 'applied' else 'available' end where id=row_record.id;
    remaining:=remaining-least(remaining,row_record.remaining_amount);
  end loop;
  insert into public.nxq_invoice_credit_applications(client_id,provider_key,provider_invoice_id,invoice_subtotal,credit_applied,amount_due) values(target_client_id,left(target_provider_key,80),left(target_provider_invoice_id,180),target_invoice_subtotal,apply_amount,target_invoice_subtotal-apply_amount);
  if apply_amount>0 then insert into public.nxq_referral_credit_ledger(client_id,entry_type,status,amount,remaining_amount,provider_invoice_id,idempotency_key,description) values(target_client_id,'applied','applied',-apply_amount,0,left(target_provider_invoice_id,180),'invoice:'||target_provider_key||':'||target_provider_invoice_id,'Referral credits applied to invoice'); end if;
  return jsonb_build_object('ok',true,'invoice_subtotal',target_invoice_subtotal,'credit_applied',apply_amount,'amount_due',target_invoice_subtotal-apply_amount,'minimum_payment',floor_amount,'cash_value',false);
end; $$;

create or replace function public.nxq_flag_referral_payment_reversal(target_client_id uuid,target_event_id text,target_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.nxq_referral_attributions%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into a from public.nxq_referral_attributions where referred_client_id=target_client_id for update;
  if not found then return jsonb_build_object('ok',true,'ignored',true); end if;
  insert into public.nxq_referral_risk_signals(attribution_id,signal_type,severity,evidence_hash,evidence) values(a.id,case when target_reason='dispute' then 'dispute' else 'refund' end,100,encode(digest(target_event_id,'sha256'),'hex'),jsonb_build_object('event_id_hash',encode(digest(target_event_id,'sha256'),'hex'))) on conflict do nothing;
  update public.nxq_referral_attributions set status=case when status='qualified' then 'reversed' else 'blocked' end,blocked_reason=target_reason,updated_at=now() where id=a.id;
  update public.nxq_referral_credit_ledger set status='reversed',remaining_amount=0 where attribution_id=a.id and remaining_amount>0;
  return jsonb_build_object('ok',true,'status','reversed_or_blocked');
end; $$;

create or replace function public.nxq_referral_dashboard()
returns jsonb language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_client_id(); profile jsonb; program jsonb;
begin
  if c is null then raise exception 'Client workspace not found.'; end if;
  profile:=public.nxq_ensure_referral_profile(c);
  select jsonb_build_object('enabled',referral_program_enabled,'reward',referral_credit_amount,'first_month_discount',referred_first_invoice_discount,'minimum_payment',minimum_invoice_payment,'hold_days',referral_hold_days,'grant_enrollment_open',founding_grant_public_enrollment_enabled and founding_grant_legal_review_complete,'grant_monthly_cost_cap',founding_grant_monthly_cost_cap) into program from public.nxq_growth_program_settings where singleton=true;
  return jsonb_build_object('profile',profile,'program',program,'balances',jsonb_build_object('pending',coalesce((select sum(remaining_amount) from public.nxq_referral_credit_ledger where client_id=c and status='pending'),0),'available',coalesce((select sum(remaining_amount) from public.nxq_referral_credit_ledger where client_id=c and status='available'),0),'applied',abs(coalesce((select sum(amount) from public.nxq_referral_credit_ledger where client_id=c and entry_type='applied'),0))),'referrals',coalesce((select jsonb_agg(to_jsonb(x) order by x.attributed_at desc) from (select id,status,attributed_at,hold_until,qualified_at,risk_score from public.nxq_referral_attributions where referrer_client_id=c) x),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,entry_type,status,amount,remaining_amount,description,available_at,created_at from public.nxq_referral_credit_ledger where client_id=c limit 100) x),'[]'::jsonb),'grant_application',(select to_jsonb(x) from public.nxq_founding_grant_applications x where client_id=c),'grant_award',(select to_jsonb(x) from public.nxq_founding_grant_awards x where client_id=c));
end; $$;

create or replace function public.nxq_submit_founding_grant_application(target_statement text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_client_id(); settings public.nxq_growth_program_settings%rowtype; position integer; result_id uuid;
begin
  if c is null then raise exception 'Client workspace not found.'; end if;
  select * into settings from public.nxq_growth_program_settings where singleton=true;
  if not settings.founding_grant_public_enrollment_enabled or not settings.founding_grant_legal_review_complete then raise exception 'Founding Grant applications are not open yet.'; end if;
  if length(btrim(target_statement))<30 then raise exception 'Please provide at least 30 characters.'; end if;
  select count(*)+1 into position from public.clients where coalesce(qa_only,false)=false and created_at<=(select created_at from public.clients where id=c);
  if position>settings.founding_grant_cohort_limit then raise exception 'This account is outside the founding cohort.'; end if;
  insert into public.nxq_founding_grant_applications(client_id,cohort_position,status,application_statement,submitted_at) values(c,position,'submitted',left(btrim(target_statement),4000),now()) on conflict(client_id) do update set status='submitted',application_statement=excluded.application_statement,submitted_at=now(),updated_at=now() returning id into result_id;
  return jsonb_build_object('ok',true,'application_id',result_id,'status','submitted','selection_guaranteed',false);
end; $$;

create or replace function public.nxq_reserve_client_resource(target_client_id uuid,target_resource_key text,target_units bigint,target_idempotency_key text,target_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.nxq_client_resource_policies%rowtype; used bigint; projected bigint;
begin
  if auth.role()<>'service_role' and (target_client_id<>public.current_client_id() or auth.uid() is null) then raise exception 'Access denied.'; end if;
  if target_units<=0 or length(target_idempotency_key)<8 then raise exception 'Invalid reservation.'; end if;
  select * into p from public.nxq_client_resource_policies where client_id=target_client_id and resource_key=target_resource_key for update;
  if not found then raise exception 'No server-side resource policy is configured.'; end if;
  if exists(select 1 from public.nxq_client_resource_reservations where client_id=target_client_id and resource_key=target_resource_key and idempotency_key=target_idempotency_key) then return jsonb_build_object('ok',true,'idempotent',true); end if;
  select coalesce(sum(units),0) into used from public.nxq_client_resource_reservations where client_id=target_client_id and resource_key=target_resource_key and occurred_at>=date_trunc('month',now()) and occurred_at<date_trunc('month',now())+interval '1 month';
  projected:=used+target_units;
  if p.hard_stop and projected>p.monthly_limit then return jsonb_build_object('ok',false,'allowed',false,'reason','monthly_limit_reached','used',used,'limit',p.monthly_limit,'resets_at',date_trunc('month',now())+interval '1 month'); end if;
  insert into public.nxq_client_resource_reservations(client_id,resource_key,units,idempotency_key,metadata) values(target_client_id,target_resource_key,target_units,target_idempotency_key,target_metadata);
  return jsonb_build_object('ok',true,'allowed',true,'used',projected,'limit',p.monthly_limit,'warning',projected*100>=p.monthly_limit*p.warning_percent,'remaining',greatest(p.monthly_limit-projected,0),'resets_at',date_trunc('month',now())+interval '1 month');
end; $$;

create or replace function public.nxq_seed_client_resource_policies(target_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; tier text; revenue_cost_cap bigint; grant_cap bigint; seeded integer:=0;
begin
  if auth.role()<>'service_role' and not public.is_nxq_owner() then raise exception 'Owner or service-role access required.'; end if;
  select client.id,client.monthly_price,coalesce(client.qa_only,false) as qa_only,coalesce(pft.tier_key,'starter') as tier_key
  into c from public.clients client left join public.product_family_tiers pft on pft.id=client.product_tier_id where client.id=target_client_id;
  if c.id is null then raise exception 'Client not found.'; end if;
  tier:=case when c.tier_key in ('starter','growth','intelligence','enterprise') then c.tier_key else 'starter' end;
  revenue_cost_cap:=greatest(floor((coalesce(c.monthly_price,0)-40)*100),0)::bigint;
  select floor(monthly_nxq_cost_cap*100)::bigint into grant_cap from public.nxq_founding_grant_awards where client_id=c.id and status='active';
  insert into public.nxq_client_resource_policies(client_id,resource_key,monthly_limit,warning_percent,hard_stop,policy_source,updated_at)
  select c.id,d.resource_key,
    case
      when c.qa_only then 0
      when d.resource_key='provider_cost_cents' and grant_cap is not null then least(d.monthly_limit,grant_cap)
      when d.resource_key='provider_cost_cents' then least(d.monthly_limit,revenue_cost_cap)
      else d.monthly_limit
    end,
    d.warning_percent,true,case when grant_cap is not null then 'founding_grant' else 'tier' end,now()
  from public.nxq_tier_resource_defaults d where d.tier_key=tier
  on conflict(client_id,resource_key) do update set monthly_limit=excluded.monthly_limit,warning_percent=excluded.warning_percent,hard_stop=true,policy_source=excluded.policy_source,updated_at=now();
  get diagnostics seeded=row_count;
  return jsonb_build_object('ok',true,'client_id',c.id,'tier_key',tier,'policies_written',seeded,'provider_cost_ceiling_cents',case when c.qa_only then 0 when grant_cap is not null then grant_cap else revenue_cost_cap end,'minimum_monthly_contribution_before_referral_credits',40);
end; $$;

create or replace function public.owner_update_growth_program_settings(target_referral_program_enabled boolean,target_founding_grant_enrollment_enabled boolean,target_founding_grant_legal_review_complete boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  update public.nxq_growth_program_settings set referral_program_enabled=target_referral_program_enabled,founding_grant_public_enrollment_enabled=target_founding_grant_enrollment_enabled,founding_grant_legal_review_complete=target_founding_grant_legal_review_complete,updated_by_auth_user_id=auth.uid(),updated_at=now() where singleton=true;
  return jsonb_build_object('ok',true,'referrals_enabled',target_referral_program_enabled,'grant_enrollment_enabled',target_founding_grant_enrollment_enabled,'legal_review_complete',target_founding_grant_legal_review_complete);
end; $$;

create or replace function public.owner_decide_founding_grant_application(target_application_id uuid,target_decision text,target_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.nxq_founding_grant_applications%rowtype; settings public.nxq_growth_program_settings%rowtype; award_count integer;
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  if target_decision not in ('eligible','selected','not_selected','revoked') then raise exception 'Invalid grant decision.'; end if;
  if length(btrim(target_note))<8 then raise exception 'A decision note is required.'; end if;
  select * into a from public.nxq_founding_grant_applications where id=target_application_id for update;
  if not found then raise exception 'Application not found.'; end if;
  select * into settings from public.nxq_growth_program_settings where singleton=true for update;
  if target_decision='selected' then
    if not settings.founding_grant_legal_review_complete then raise exception 'Legal review must be completed before an award.'; end if;
    select count(*) into award_count from public.nxq_founding_grant_awards where status in ('active','paused');
    if award_count>=settings.founding_grant_award_limit and not exists(select 1 from public.nxq_founding_grant_awards where application_id=a.id) then raise exception 'The ten-award cap has been reached.'; end if;
    insert into public.nxq_founding_grant_awards(application_id,client_id,status,monthly_nxq_cost_cap,terms_version,metadata)
    values(a.id,a.client_id,'active',settings.founding_grant_monthly_cost_cap,'founding-grant-v1',jsonb_build_object('no_cash_value',true,'non_transferable',true,'owner_note',left(btrim(target_note),2000)))
    on conflict(application_id) do update set status='active',ended_at=null,metadata=excluded.metadata;
  elsif target_decision='revoked' then
    update public.nxq_founding_grant_awards set status='revoked',ended_at=now(),metadata=metadata||jsonb_build_object('revocation_note',left(btrim(target_note),2000)) where application_id=a.id;
  end if;
  update public.nxq_founding_grant_applications set status=target_decision,decided_at=now(),decided_by_auth_user_id=auth.uid(),decision_note=left(btrim(target_note),2000),updated_at=now() where id=a.id;
  return jsonb_build_object('ok',true,'application_id',a.id,'status',target_decision,'award_cap',settings.founding_grant_award_limit);
end; $$;

create or replace function public.nxq_record_referral_risk_signal(target_attribution_id uuid,target_signal_type text,target_severity smallint,target_evidence_hash text,target_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare total_score integer; should_block boolean;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  insert into public.nxq_referral_risk_signals(attribution_id,signal_type,severity,evidence_hash,evidence)
  values(target_attribution_id,target_signal_type,target_severity,nullif(left(target_evidence_hash,180),''),coalesce(target_evidence,'{}'::jsonb)) on conflict do nothing;
  select least(coalesce(sum(severity),0),100),coalesce(bool_or(severity>=70 or signal_type in ('same_payment_method','owner_related','refund','dispute')),false) into total_score,should_block from public.nxq_referral_risk_signals where attribution_id=target_attribution_id;
  update public.nxq_referral_attributions set risk_score=coalesce(total_score,0),risk_summary=jsonb_build_object('signals',(select coalesce(jsonb_agg(jsonb_build_object('type',signal_type,'severity',severity)),'[]'::jsonb) from public.nxq_referral_risk_signals where attribution_id=target_attribution_id)),status=case when should_block and status<>'reversed' then 'blocked' else status end,blocked_reason=case when should_block then 'automated_risk_hold' else blocked_reason end,updated_at=now() where id=target_attribution_id;
  return jsonb_build_object('ok',true,'risk_score',coalesce(total_score,0),'blocked',should_block);
end; $$;

create or replace function public.owner_growth_dashboard()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  return jsonb_build_object('settings',(select to_jsonb(s) from public.nxq_growth_program_settings s where singleton=true),'summary',jsonb_build_object('attributions',(select count(*) from public.nxq_referral_attributions),'qualified',(select count(*) from public.nxq_referral_attributions where status='qualified'),'blocked',(select count(*) from public.nxq_referral_attributions where status in ('blocked','reversed')),'available_credit',(select coalesce(sum(remaining_amount),0) from public.nxq_referral_credit_ledger where status='available'),'grant_applications',(select count(*) from public.nxq_founding_grant_applications),'active_grants',(select count(*) from public.nxq_founding_grant_awards where status='active')),'grant_applications',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,client_id,cohort_position,status,application_statement,submitted_at,created_at from public.nxq_founding_grant_applications limit 100) x),'[]'::jsonb));
end; $$;

revoke all on function public.nxq_ensure_referral_profile(uuid),public.nxq_claim_referral(text),public.nxq_record_referral_first_payment(uuid,text,text,numeric,timestamptz),public.nxq_mature_referral_credits(integer),public.nxq_apply_referral_credit(uuid,text,text,numeric),public.nxq_flag_referral_payment_reversal(uuid,text,text),public.nxq_referral_dashboard(),public.nxq_submit_founding_grant_application(text),public.nxq_reserve_client_resource(uuid,text,bigint,text,jsonb),public.nxq_seed_client_resource_policies(uuid),public.owner_update_growth_program_settings(boolean,boolean,boolean),public.owner_decide_founding_grant_application(uuid,text,text),public.nxq_record_referral_risk_signal(uuid,text,smallint,text,jsonb),public.owner_growth_dashboard() from public,anon;
grant execute on function public.nxq_ensure_referral_profile(uuid),public.nxq_claim_referral(text),public.nxq_referral_dashboard(),public.nxq_submit_founding_grant_application(text),public.nxq_reserve_client_resource(uuid,text,bigint,text,jsonb) to authenticated;
grant execute on function public.owner_update_growth_program_settings(boolean,boolean,boolean),public.owner_decide_founding_grant_application(uuid,text,text),public.owner_growth_dashboard(),public.nxq_seed_client_resource_policies(uuid) to authenticated;
grant execute on function public.nxq_record_referral_first_payment(uuid,text,text,numeric,timestamptz),public.nxq_mature_referral_credits(integer),public.nxq_apply_referral_credit(uuid,text,text,numeric),public.nxq_flag_referral_payment_reversal(uuid,text,text),public.nxq_record_referral_risk_signal(uuid,text,smallint,text,jsonb) to service_role;

comment on table public.nxq_referral_credit_ledger is 'Non-cash, non-transferable referral credit ledger. Credit application must preserve the protected minimum invoice payment.';
comment on table public.nxq_founding_grant_awards is 'At most ten owner-selected awards from the first 10,000 verified paying clients; public enrollment remains off until legal review.';
comment on function public.nxq_reserve_client_resource(uuid,text,bigint,text,jsonb) is 'Atomic server-side monthly allowance reservation. UI state cannot bypass the hard stop.';
comment on function public.nxq_seed_client_resource_policies(uuid) is 'Seeds hard server-side tier limits and caps provider cost so ordinary service economics retain at least $40 before referral credits.';
