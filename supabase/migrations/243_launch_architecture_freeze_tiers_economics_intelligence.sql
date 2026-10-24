-- NXQ-Web Launch Architecture Freeze v1
-- Canonical Business tier value ladder, economic guardrails, one-time carryover usage credits,
-- universal intelligence/event foundations, experiments, feature flags, jobs, consent, and Enterprise policy hooks.
-- This migration is intentionally provider-agnostic and does not enable external providers or production automation.

-- ---------------------------------------------------------------------------
-- 1. Canonical Business tier capability matrix
-- ---------------------------------------------------------------------------

insert into public.nxq_tier_entitlements(product_family_slug,tier_key,feature_key,enabled,limits)
values
  -- Starter: managed website foundation.
  ('business','starter','managed_website',true,jsonb_build_object('core_pages',5)),
  ('business','starter','client_portal',true,'{}'),
  ('business','starter','hosting_monitoring',true,'{}'),
  ('business','starter','ssl_security',true,'{}'),
  ('business','starter','backups_recovery',true,'{}'),
  ('business','starter','lead_capture',true,'{}'),
  ('business','starter','lead_inbox',true,'{}'),
  ('business','starter','basic_analytics',true,'{}'),
  ('business','starter','basic_seo',true,'{}'),
  ('business','starter','structured_data',true,'{}'),
  ('business','starter','uptime_monitoring',true,'{}'),
  ('business','starter','technical_maintenance',true,'{}'),
  ('business','starter','performance_monitoring',true,'{}'),
  ('business','starter','accessibility_checks',true,'{}'),
  ('business','starter','monthly_health_report',true,'{}'),
  ('business','starter','review_sections',true,'{}'),
  ('business','starter','basic_optimization',true,'{}'),
  ('business','starter','change_requests',true,'{}'),
  ('business','starter','event_conversion_tracking',false,'{}'),
  ('business','starter','advanced_analytics',false,'{}'),
  ('business','starter','advanced_seo',false,'{}'),
  ('business','starter','mouse_tracking',false,jsonb_build_object('consent_required',true)),
  ('business','starter','behavior_heatmaps',false,jsonb_build_object('consent_required',true)),
  ('business','starter','ab_testing',false,'{}'),
  ('business','starter','multi_location',false,jsonb_build_object('max_locations',1)),

  -- Growth: visibility, conversion and lead growth.
  ('business','growth','managed_website',true,jsonb_build_object('core_pages',12)),
  ('business','growth','client_portal',true,'{}'),
  ('business','growth','hosting_monitoring',true,'{}'),
  ('business','growth','ssl_security',true,'{}'),
  ('business','growth','backups_recovery',true,'{}'),
  ('business','growth','lead_capture',true,'{}'),
  ('business','growth','lead_inbox',true,'{}'),
  ('business','growth','basic_analytics',true,'{}'),
  ('business','growth','basic_seo',true,'{}'),
  ('business','growth','structured_data',true,'{}'),
  ('business','growth','uptime_monitoring',true,'{}'),
  ('business','growth','technical_maintenance',true,'{}'),
  ('business','growth','performance_monitoring',true,'{}'),
  ('business','growth','accessibility_checks',true,'{}'),
  ('business','growth','monthly_health_report',true,'{}'),
  ('business','growth','review_sections',true,'{}'),
  ('business','growth','basic_optimization',true,'{}'),
  ('business','growth','change_requests',true,'{}'),
  ('business','growth','event_conversion_tracking',true,jsonb_build_object('scroll_milestones',true,'cta_clicks',true,'form_funnel',true)),
  ('business','growth','advanced_analytics',true,'{}'),
  ('business','growth','lead_source_attribution',true,'{}'),
  ('business','growth','service_area_seo',true,'{}'),
  ('business','growth','seo_health_monitoring',true,'{}'),
  ('business','growth','reputation_monitoring',true,'{}'),
  ('business','growth','content_optimization',true,'{}'),
  ('business','growth','growth_reporting',true,'{}'),
  ('business','growth','lead_scoring_basic',true,'{}'),
  ('business','growth','competitor_opportunities',true,'{}'),
  ('business','growth','advanced_seo',false,'{}'),
  ('business','growth','mouse_tracking',false,jsonb_build_object('consent_required',true)),
  ('business','growth','behavior_heatmaps',false,jsonb_build_object('consent_required',true)),
  ('business','growth','ab_testing',false,'{}'),
  ('business','growth','multi_location',false,jsonb_build_object('max_locations',1)),

  -- Intelligence: behavior intelligence and active optimization.
  ('business','intelligence','managed_website',true,jsonb_build_object('core_pages',25)),
  ('business','intelligence','client_portal',true,'{}'),
  ('business','intelligence','hosting_monitoring',true,'{}'),
  ('business','intelligence','ssl_security',true,'{}'),
  ('business','intelligence','backups_recovery',true,'{}'),
  ('business','intelligence','lead_capture',true,'{}'),
  ('business','intelligence','lead_inbox',true,'{}'),
  ('business','intelligence','basic_analytics',true,'{}'),
  ('business','intelligence','basic_seo',true,'{}'),
  ('business','intelligence','structured_data',true,'{}'),
  ('business','intelligence','uptime_monitoring',true,'{}'),
  ('business','intelligence','technical_maintenance',true,'{}'),
  ('business','intelligence','performance_monitoring',true,'{}'),
  ('business','intelligence','accessibility_checks',true,'{}'),
  ('business','intelligence','monthly_health_report',true,'{}'),
  ('business','intelligence','review_sections',true,'{}'),
  ('business','intelligence','basic_optimization',true,'{}'),
  ('business','intelligence','change_requests',true,'{}'),
  ('business','intelligence','event_conversion_tracking',true,jsonb_build_object('scroll_milestones',true,'cta_clicks',true,'form_funnel',true)),
  ('business','intelligence','advanced_analytics',true,'{}'),
  ('business','intelligence','lead_source_attribution',true,'{}'),
  ('business','intelligence','service_area_seo',true,'{}'),
  ('business','intelligence','seo_health_monitoring',true,'{}'),
  ('business','intelligence','reputation_monitoring',true,'{}'),
  ('business','intelligence','content_optimization',true,'{}'),
  ('business','intelligence','growth_reporting',true,'{}'),
  ('business','intelligence','advanced_seo',true,'{}'),
  ('business','intelligence','mouse_tracking',true,jsonb_build_object('consent_required',true,'retention_days',90,'sensitive_field_capture',false)),
  ('business','intelligence','behavior_heatmaps',true,jsonb_build_object('consent_required',true,'retention_days',90,'sensitive_field_capture',false)),
  ('business','intelligence','rage_dead_click_detection',true,jsonb_build_object('consent_required',true)),
  ('business','intelligence','funnel_analysis',true,'{}'),
  ('business','intelligence','ai_optimization',true,jsonb_build_object('provider_gated',true)),
  ('business','intelligence','ab_testing',true,jsonb_build_object('production_change_requires_guard',true)),
  ('business','intelligence','lead_scoring_advanced',true,jsonb_build_object('provider_gated',true)),
  ('business','intelligence','seo_intelligence',true,jsonb_build_object('provider_gated',true)),
  ('business','intelligence','anomaly_detection',true,'{}'),
  ('business','intelligence','conversion_optimization',true,'{}'),
  ('business','intelligence','landing_page_experiments',true,jsonb_build_object('production_change_requires_guard',true)),
  ('business','intelligence','multi_location',false,jsonb_build_object('max_locations',1)),

  -- Enterprise: custom web system; economic/resource policy derives from approved price.
  ('business','enterprise','managed_website',true,jsonb_build_object('core_pages','custom')),
  ('business','enterprise','client_portal',true,'{}'),
  ('business','enterprise','hosting_monitoring',true,'{}'),
  ('business','enterprise','ssl_security',true,'{}'),
  ('business','enterprise','backups_recovery',true,'{}'),
  ('business','enterprise','lead_capture',true,'{}'),
  ('business','enterprise','lead_inbox',true,'{}'),
  ('business','enterprise','basic_analytics',true,'{}'),
  ('business','enterprise','basic_seo',true,'{}'),
  ('business','enterprise','structured_data',true,'{}'),
  ('business','enterprise','uptime_monitoring',true,'{}'),
  ('business','enterprise','technical_maintenance',true,'{}'),
  ('business','enterprise','performance_monitoring',true,'{}'),
  ('business','enterprise','accessibility_checks',true,'{}'),
  ('business','enterprise','monthly_health_report',true,'{}'),
  ('business','enterprise','review_sections',true,'{}'),
  ('business','enterprise','basic_optimization',true,'{}'),
  ('business','enterprise','change_requests',true,'{}'),
  ('business','enterprise','event_conversion_tracking',true,'{}'),
  ('business','enterprise','advanced_analytics',true,'{}'),
  ('business','enterprise','lead_source_attribution',true,'{}'),
  ('business','enterprise','service_area_seo',true,'{}'),
  ('business','enterprise','seo_health_monitoring',true,'{}'),
  ('business','enterprise','reputation_monitoring',true,'{}'),
  ('business','enterprise','content_optimization',true,'{}'),
  ('business','enterprise','growth_reporting',true,'{}'),
  ('business','enterprise','advanced_seo',true,'{}'),
  ('business','enterprise','mouse_tracking',true,jsonb_build_object('consent_required',true,'retention_days',90,'sensitive_field_capture',false)),
  ('business','enterprise','behavior_heatmaps',true,jsonb_build_object('consent_required',true,'retention_days',90,'sensitive_field_capture',false)),
  ('business','enterprise','rage_dead_click_detection',true,jsonb_build_object('consent_required',true)),
  ('business','enterprise','funnel_analysis',true,'{}'),
  ('business','enterprise','ai_optimization',true,jsonb_build_object('provider_gated',true)),
  ('business','enterprise','ab_testing',true,jsonb_build_object('production_change_requires_guard',true)),
  ('business','enterprise','lead_scoring_advanced',true,jsonb_build_object('provider_gated',true)),
  ('business','enterprise','seo_intelligence',true,jsonb_build_object('provider_gated',true)),
  ('business','enterprise','anomaly_detection',true,'{}'),
  ('business','enterprise','conversion_optimization',true,'{}'),
  ('business','enterprise','landing_page_experiments',true,jsonb_build_object('production_change_requires_guard',true)),
  ('business','enterprise','multi_location',true,jsonb_build_object('max_locations',100)),
  ('business','enterprise','multi_site',true,jsonb_build_object('max_sites','custom')),
  ('business','enterprise','custom_integrations',true,jsonb_build_object('owner_review_required',true)),
  ('business','enterprise','crm_sync',true,jsonb_build_object('provider_gated',true)),
  ('business','enterprise','custom_portals',true,'{}'),
  ('business','enterprise','role_permissions',true,'{}'),
  ('business','enterprise','custom_workflows',true,jsonb_build_object('owner_review_required',true)),
  ('business','enterprise','custom_ai_agents',true,jsonb_build_object('provider_gated',true,'owner_review_required',true)),
  ('business','enterprise','predictive_analytics',true,jsonb_build_object('provider_gated',true)),
  ('business','enterprise','advanced_reporting',true,'{}'),
  ('business','enterprise','priority_support',true,'{}')
on conflict(product_family_slug,tier_key,feature_key) do update set
  enabled=excluded.enabled,
  limits=excluded.limits,
  updated_at=now();

-- Public catalog copy reflects outcomes; server entitlements above remain the authority.
update public.product_family_tiers tier
set features = case tier.tier_key
  when 'starter' then '["Custom managed website up to 5 core pages","Hosting and SSL","Client portal and lead inbox","Basic analytics and local SEO","Structured data and indexing setup","Uptime, performance, accessibility and form health checks","Backups, recovery and technical maintenance","Monthly health report and basic optimization","Monthly change allowance"]'::jsonb
  when 'growth' then '["Everything in Starter","Expanded service and service-area content","Advanced analytics and conversion event tracking","Lead-source attribution and basic lead scoring","SEO health and content optimization","Review and reputation monitoring","Competitor and growth opportunities","Monthly growth reporting","Higher change, automation and usage allowances"]'::jsonb
  when 'intelligence' then '["Everything in Growth","Consent-gated mouse, click and scroll behavior intelligence","Heatmaps, rage/dead-click and funnel analysis","Advanced SEO intelligence","AI-assisted optimization recommendations","A/B testing and landing-page experiment foundation","Advanced lead intelligence","Anomaly and conversion optimization","Higher automation and usage allowances"]'::jsonb
  when 'enterprise' then '["Everything in Intelligence","Multi-location and multi-site systems","Location-specific SEO, analytics and lead routing","Custom portals, permissions and workflows","CRM and custom integrations","Custom AI-agent and predictive-analytics foundations","Advanced reporting and priority support","Custom allowances and economics based on approved monthly price"]'::jsonb
  else tier.features
end,
updated_at=now()
from public.product_families family
where family.id=tier.product_family_id and family.slug='business';

-- ---------------------------------------------------------------------------
-- 2. Economics and one-time carryover usage credits
-- ---------------------------------------------------------------------------

create table if not exists public.nxq_tier_economic_policies (
  product_family_slug text not null,
  tier_key text not null check(tier_key in ('starter','growth','intelligence','enterprise')),
  preferred_margin_percent numeric(5,2) not null default 95 check(preferred_margin_percent between 90 and 99),
  target_margin_percent numeric(5,2) not null default 90 check(target_margin_percent between 85 and preferred_margin_percent),
  minimum_margin_percent numeric(5,2) not null default 85 check(minimum_margin_percent between 80 and target_margin_percent),
  custom_price_driven boolean not null default false,
  topup_purchase_cents integer not null default 1000 check(topup_purchase_cents=1000),
  topup_usable_cents integer not null default 900 check(topup_usable_cents=900),
  recurring_topup_allowed boolean not null default false check(recurring_topup_allowed=false),
  auto_refill_allowed boolean not null default false check(auto_refill_allowed=false),
  updated_at timestamptz not null default now(),
  primary key(product_family_slug,tier_key)
);

insert into public.nxq_tier_economic_policies(product_family_slug,tier_key,custom_price_driven)
values
  ('business','starter',false),
  ('business','growth',false),
  ('business','intelligence',false),
  ('business','enterprise',true)
on conflict(product_family_slug,tier_key) do update set
  preferred_margin_percent=95,
  target_margin_percent=90,
  minimum_margin_percent=85,
  custom_price_driven=excluded.custom_price_driven,
  topup_purchase_cents=1000,
  topup_usable_cents=900,
  recurring_topup_allowed=false,
  auto_refill_allowed=false,
  updated_at=now();

create table if not exists public.nxq_usage_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_key text not null,
  provider_payment_event_id text not null,
  amount_paid_cents integer not null check(amount_paid_cents=1000),
  usable_credit_cents integer not null check(usable_credit_cents=900),
  purchase_type text not null default 'one_time_usage_credit' check(purchase_type='one_time_usage_credit'),
  recurring boolean not null default false check(recurring=false),
  auto_refill boolean not null default false check(auto_refill=false),
  status text not null default 'credited' check(status in ('credited','partially_spent','spent','reversed')),
  purchased_at timestamptz not null default now(),
  reversed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique(provider_key,provider_payment_event_id)
);

create table if not exists public.nxq_usage_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  purchase_id uuid references public.nxq_usage_credit_purchases(id) on delete restrict,
  entry_type text not null check(entry_type in ('purchase_credit','usage_spend','reversal','adjustment')),
  amount_cents integer not null check(amount_cents<>0),
  idempotency_key text not null unique,
  resource_key text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check((entry_type='purchase_credit' and amount_cents>0) or entry_type<>'purchase_credit')
);
create index if not exists nxq_usage_credit_ledger_client_idx on public.nxq_usage_credit_ledger(client_id,created_at);

create table if not exists public.nxq_economic_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  idempotency_key text not null,
  estimated_provider_cost_cents integer not null check(estimated_provider_cost_cents>=0),
  included_budget_cents integer not null check(included_budget_cents>=0),
  hard_subscription_cost_ceiling_cents integer not null check(hard_subscription_cost_ceiling_cents>=included_budget_cents),
  paid_credit_spent_cents integer not null default 0 check(paid_credit_spent_cents>=0),
  target_margin_percent numeric(5,2) not null,
  minimum_margin_percent numeric(5,2) not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(client_id,idempotency_key)
);
create index if not exists nxq_economic_reservations_month_idx on public.nxq_economic_usage_reservations(client_id,occurred_at);

alter table public.nxq_tier_economic_policies enable row level security;
alter table public.nxq_usage_credit_purchases enable row level security;
alter table public.nxq_usage_credit_ledger enable row level security;
alter table public.nxq_economic_usage_reservations enable row level security;

revoke all on public.nxq_tier_economic_policies,public.nxq_usage_credit_purchases,public.nxq_usage_credit_ledger,public.nxq_economic_usage_reservations from public,anon,authenticated;
grant select on public.nxq_tier_economic_policies to authenticated;
grant select on public.nxq_usage_credit_purchases,public.nxq_usage_credit_ledger,public.nxq_economic_usage_reservations to authenticated;
grant select,insert,update,delete on public.nxq_tier_economic_policies,public.nxq_usage_credit_purchases,public.nxq_usage_credit_ledger,public.nxq_economic_usage_reservations to service_role;

create policy nxq_economic_policy_public_client_read on public.nxq_tier_economic_policies
for select to authenticated using(true);
create policy nxq_usage_purchase_client_read on public.nxq_usage_credit_purchases
for select to authenticated using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_usage_ledger_client_read on public.nxq_usage_credit_ledger
for select to authenticated using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_economic_reservation_client_read on public.nxq_economic_usage_reservations
for select to authenticated using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));

create or replace function public.nxq_usage_credit_balance(target_client_id uuid)
returns integer
language plpgsql stable security definer set search_path=public
as $$
declare result integer;
begin
  if not exists(select 1 from public.clients c where c.id=target_client_id and c.auth_user_id=auth.uid())
     and not exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()) then
    raise exception 'Access denied.';
  end if;
  select coalesce(sum(amount_cents),0)::integer into result from public.nxq_usage_credit_ledger where client_id=target_client_id;
  return greatest(result,0);
end;
$$;
revoke all on function public.nxq_usage_credit_balance(uuid) from public,anon;
grant execute on function public.nxq_usage_credit_balance(uuid) to authenticated;

create or replace function public.nxq_record_usage_credit_purchase(
  target_client_id uuid,
  target_provider_key text,
  target_provider_payment_event_id text,
  target_amount_paid_cents integer,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare purchase_row public.nxq_usage_credit_purchases%rowtype;
begin
  if target_amount_paid_cents<>1000 then raise exception 'NXQ usage top-up must be exactly 1000 cents.'; end if;
  if nullif(btrim(target_provider_key),'') is null or nullif(btrim(target_provider_payment_event_id),'') is null then raise exception 'Verified provider payment identity is required.'; end if;
  insert into public.nxq_usage_credit_purchases(client_id,provider_key,provider_payment_event_id,amount_paid_cents,usable_credit_cents,recurring,auto_refill,metadata)
  values(target_client_id,btrim(target_provider_key),btrim(target_provider_payment_event_id),1000,900,false,false,target_metadata)
  on conflict(provider_key,provider_payment_event_id) do nothing
  returning * into purchase_row;
  if purchase_row.id is null then
    select * into purchase_row from public.nxq_usage_credit_purchases where provider_key=btrim(target_provider_key) and provider_payment_event_id=btrim(target_provider_payment_event_id);
    return jsonb_build_object('ok',true,'idempotent',true,'purchase_id',purchase_row.id,'usable_credit_cents',purchase_row.usable_credit_cents,'recurring',false,'auto_refill',false);
  end if;
  insert into public.nxq_usage_credit_ledger(client_id,purchase_id,entry_type,amount_cents,idempotency_key,metadata)
  values(target_client_id,purchase_row.id,'purchase_credit',900,'usage-purchase:'||purchase_row.id::text,target_metadata);
  return jsonb_build_object('ok',true,'idempotent',false,'purchase_id',purchase_row.id,'amount_paid_cents',1000,'usable_credit_cents',900,'nxq_retained_cents',100,'recurring',false,'auto_refill',false,'carries_forward',true);
end;
$$;
revoke all on function public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb) to service_role;

create or replace function public.nxq_reserve_economic_usage(
  target_client_id uuid,
  target_estimated_provider_cost_cents integer,
  target_idempotency_key text,
  target_resource_key text default 'provider_cost_cents',
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  c record; policy public.nxq_tier_economic_policies%rowtype;
  spent_this_month integer; projected integer; included_budget integer; hard_ceiling integer;
  paid_balance integer; prior_overage integer; new_overage integer; paid_needed integer;
begin
  if target_estimated_provider_cost_cents<0 or length(coalesce(target_idempotency_key,''))<8 then raise exception 'Invalid economic reservation.'; end if;
  if exists(select 1 from public.nxq_economic_usage_reservations r where r.client_id=target_client_id and r.idempotency_key=target_idempotency_key) then
    return jsonb_build_object('ok',true,'allowed',true,'idempotent',true);
  end if;
  select cl.id,cl.monthly_price,coalesce(pf.slug,'business') family_slug,coalesce(pft.tier_key,'starter') tier_key
  into c from public.clients cl
  left join public.product_families pf on pf.id=cl.product_family_id
  left join public.product_family_tiers pft on pft.id=cl.product_tier_id
  where cl.id=target_client_id for update;
  if c.id is null then raise exception 'Client not found.'; end if;
  select * into policy from public.nxq_tier_economic_policies where product_family_slug=c.family_slug and tier_key=c.tier_key;
  if policy.tier_key is null then raise exception 'Economic policy missing; deny by default.'; end if;
  if c.monthly_price is null or c.monthly_price<=0 then raise exception 'Approved monthly price required for economic reservation.'; end if;
  included_budget:=floor(c.monthly_price*100*((100-policy.target_margin_percent)/100))::integer;
  hard_ceiling:=floor(c.monthly_price*100*((100-policy.minimum_margin_percent)/100))::integer;
  select coalesce(sum(estimated_provider_cost_cents),0)::integer into spent_this_month
  from public.nxq_economic_usage_reservations
  where client_id=target_client_id and occurred_at>=date_trunc('month',now()) and occurred_at<date_trunc('month',now())+interval '1 month';
  projected:=spent_this_month+target_estimated_provider_cost_cents;
  prior_overage:=greatest(spent_this_month-included_budget,0);
  new_overage:=greatest(projected-included_budget,0);
  paid_needed:=greatest(new_overage-prior_overage,0);
  select greatest(coalesce(sum(amount_cents),0),0)::integer into paid_balance from public.nxq_usage_credit_ledger where client_id=target_client_id;
  if paid_needed>paid_balance then
    return jsonb_build_object('ok',false,'allowed',false,'reason','usage_credit_required','included_budget_cents',included_budget,'hard_subscription_cost_ceiling_cents',hard_ceiling,'paid_credit_balance_cents',paid_balance,'paid_credit_needed_cents',paid_needed,'target_margin_percent',policy.target_margin_percent,'minimum_margin_percent',policy.minimum_margin_percent);
  end if;
  if paid_needed>0 then
    insert into public.nxq_usage_credit_ledger(client_id,entry_type,amount_cents,idempotency_key,resource_key,metadata)
    values(target_client_id,'usage_spend',-paid_needed,'usage-spend:'||target_idempotency_key,target_resource_key,target_metadata);
  end if;
  insert into public.nxq_economic_usage_reservations(client_id,idempotency_key,estimated_provider_cost_cents,included_budget_cents,hard_subscription_cost_ceiling_cents,paid_credit_spent_cents,target_margin_percent,minimum_margin_percent,metadata)
  values(target_client_id,target_idempotency_key,target_estimated_provider_cost_cents,included_budget,hard_ceiling,paid_needed,policy.target_margin_percent,policy.minimum_margin_percent,target_metadata);
  return jsonb_build_object('ok',true,'allowed',true,'idempotent',false,'included_budget_cents',included_budget,'hard_subscription_cost_ceiling_cents',hard_ceiling,'projected_provider_cost_cents',projected,'paid_credit_spent_cents',paid_needed,'paid_credit_balance_after_cents',greatest(paid_balance-paid_needed,0),'target_margin_percent',policy.target_margin_percent,'preferred_margin_percent',policy.preferred_margin_percent,'minimum_margin_percent',policy.minimum_margin_percent);
end;
$$;
revoke all on function public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb) to service_role;

-- Re-seed existing provider-cost policies around the 90% target / 85% floor instead of the old flat $40 contribution model.
create or replace function public.nxq_seed_client_resource_policies(target_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; tier text; policy public.nxq_tier_economic_policies%rowtype; target_cost_cap bigint; hard_cost_cap bigint; grant_cap bigint; seeded integer:=0;
begin
  select client.id,client.monthly_price,coalesce(client.qa_only,false) qa_only,coalesce(pft.tier_key,'starter') tier_key
  into c from public.clients client left join public.product_family_tiers pft on pft.id=client.product_tier_id where client.id=target_client_id;
  if c.id is null then raise exception 'Client not found.'; end if;
  tier:=case when c.tier_key in ('starter','growth','intelligence','enterprise') then c.tier_key else 'starter' end;
  select * into policy from public.nxq_tier_economic_policies where product_family_slug='business' and tier_key=tier;
  if policy.tier_key is null then raise exception 'Economic policy missing; deny by default.'; end if;
  if c.monthly_price is null or c.monthly_price<=0 then raise exception 'Approved monthly price required.'; end if;
  target_cost_cap:=floor(c.monthly_price*100*((100-policy.target_margin_percent)/100))::bigint;
  hard_cost_cap:=floor(c.monthly_price*100*((100-policy.minimum_margin_percent)/100))::bigint;
  select floor(monthly_nxq_cost_cap*100)::bigint into grant_cap from public.nxq_founding_grant_awards where client_id=c.id and status='active';
  insert into public.nxq_client_resource_policies(client_id,resource_key,monthly_limit,warning_percent,hard_stop,policy_source,updated_at)
  select c.id,d.resource_key,
    case
      when c.qa_only then 0
      when d.resource_key='provider_cost_cents' and grant_cap is not null then least(d.monthly_limit,grant_cap,hard_cost_cap)
      when d.resource_key='provider_cost_cents' then least(d.monthly_limit,hard_cost_cap)
      else d.monthly_limit
    end,
    d.warning_percent,true,case when grant_cap is not null then 'founding_grant' else 'tier_economic_policy' end,now()
  from public.nxq_tier_resource_defaults d where d.tier_key=tier
  on conflict(client_id,resource_key) do update set monthly_limit=excluded.monthly_limit,warning_percent=excluded.warning_percent,hard_stop=true,policy_source=excluded.policy_source,updated_at=now();
  get diagnostics seeded=row_count;
  return jsonb_build_object('ok',true,'client_id',c.id,'tier_key',tier,'policies_written',seeded,'target_provider_cost_budget_cents',case when c.qa_only then 0 else target_cost_cap end,'hard_provider_cost_ceiling_cents',case when c.qa_only then 0 when grant_cap is not null then least(grant_cap,hard_cost_cap) else hard_cost_cap end,'preferred_margin_percent',policy.preferred_margin_percent,'target_margin_percent',policy.target_margin_percent,'minimum_margin_percent',policy.minimum_margin_percent);
end;
$$;
revoke all on function public.nxq_seed_client_resource_policies(uuid) from public,anon,authenticated,service_role;
grant execute on function public.nxq_seed_client_resource_policies(uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Universal event, consent, behavior, optimization and experiment models
-- ---------------------------------------------------------------------------

create table if not exists public.nxq_consent_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  subject_key_hash text not null,
  consent_type text not null check(consent_type in ('essential','analytics','behavior','marketing')),
  status text not null check(status in ('granted','denied','withdrawn')),
  policy_version text not null,
  recorded_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists nxq_consent_client_subject_idx on public.nxq_consent_records(client_id,subject_key_hash,consent_type,recorded_at desc);

create table if not exists public.nxq_platform_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_key text not null,
  event_category text not null check(event_category in ('lifecycle','lead','conversion','seo','performance','maintenance','security','review','usage','billing','deployment','experiment','analytics','other')),
  source text not null,
  occurred_at timestamptz not null default now(),
  value_numeric numeric,
  metadata jsonb not null default '{}'::jsonb,
  sensitive_data_present boolean not null default false check(sensitive_data_present=false),
  idempotency_key text,
  unique(client_id,idempotency_key)
);
create index if not exists nxq_platform_events_timeline_idx on public.nxq_platform_events(client_id,occurred_at desc,event_category);

create table if not exists public.nxq_behavior_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  consent_record_id uuid not null references public.nxq_consent_records(id) on delete restrict,
  session_key_hash text not null,
  page_key text not null,
  event_type text not null check(event_type in ('click','scroll','mouse_sample','rage_click','dead_click','form_start','form_complete','form_abandon','page_exit','video','download')),
  x_ratio numeric check(x_ratio is null or (x_ratio>=0 and x_ratio<=1)),
  y_ratio numeric check(y_ratio is null or (y_ratio>=0 and y_ratio<=1)),
  scroll_ratio numeric check(scroll_ratio is null or (scroll_ratio>=0 and scroll_ratio<=1)),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  sensitive_field_capture boolean not null default false check(sensitive_field_capture=false)
);
create index if not exists nxq_behavior_events_analysis_idx on public.nxq_behavior_events(client_id,page_key,event_type,occurred_at);

create table if not exists public.nxq_optimization_findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  category text not null check(category in ('seo','conversion','performance','content','accessibility','security','maintenance','analytics','leads','reputation','behavior','other')),
  finding_key text not null,
  severity text not null default 'normal' check(severity in ('low','normal','high','urgent')),
  confidence numeric(5,4) check(confidence is null or (confidence>=0 and confidence<=1)),
  expected_impact text,
  evidence jsonb not null default '{}'::jsonb,
  proposed_change jsonb not null default '{}'::jsonb,
  safety_class text not null default 'review_required' check(safety_class in ('observe_only','auto_safe','review_required','owner_required')),
  status text not null default 'open' check(status in ('open','queued','testing','implemented','dismissed','expired','rolled_back')),
  provider_generated boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(client_id,finding_key,status)
);

create table if not exists public.nxq_experiments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  finding_id uuid references public.nxq_optimization_findings(id) on delete set null,
  experiment_key text not null,
  target_metric text not null,
  status text not null default 'draft' check(status in ('draft','approved','running','paused','completed','rolled_back','cancelled')),
  production_change_guard_required boolean not null default true,
  minimum_sample_size integer not null default 100 check(minimum_sample_size>=1),
  started_at timestamptz,
  ended_at timestamptz,
  winner_variant_key text,
  metadata jsonb not null default '{}'::jsonb,
  unique(client_id,experiment_key)
);

create table if not exists public.nxq_experiment_variants (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.nxq_experiments(id) on delete cascade,
  variant_key text not null,
  allocation_percent numeric(5,2) not null check(allocation_percent>0 and allocation_percent<=100),
  configuration jsonb not null default '{}'::jsonb,
  impressions bigint not null default 0 check(impressions>=0),
  conversions bigint not null default 0 check(conversions>=0),
  created_at timestamptz not null default now(),
  unique(experiment_id,variant_key)
);

-- ---------------------------------------------------------------------------
-- 4. Provider abstraction, jobs, feature flags and Enterprise overrides
-- ---------------------------------------------------------------------------

create table if not exists public.nxq_feature_flags (
  feature_key text primary key,
  globally_enabled boolean not null default false,
  staging_enabled boolean not null default false,
  production_enabled boolean not null default false,
  emergency_kill_switch boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.nxq_provider_adapter_registry (
  adapter_key text primary key,
  capability text not null,
  provider_name text,
  enabled boolean not null default false,
  staging_allowed boolean not null default false,
  production_allowed boolean not null default false,
  configuration_profile text,
  secret_values_stored_here boolean not null default false check(secret_values_stored_here=false),
  updated_at timestamptz not null default now()
);

create table if not exists public.nxq_automation_jobs_v2 (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','retrying','needs_review','cancelled','dead_letter')),
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check(attempt_count>=0),
  max_attempts integer not null default 3 check(max_attempts between 1 and 20),
  next_attempt_at timestamptz,
  timeout_seconds integer not null default 60 check(timeout_seconds between 1 and 3600),
  input_reference jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists nxq_automation_jobs_v2_queue_idx on public.nxq_automation_jobs_v2(status,next_attempt_at,created_at);

create table if not exists public.nxq_enterprise_account_policies (
  client_id uuid primary key references public.clients(id) on delete cascade,
  approved_monthly_price numeric(10,2) not null check(approved_monthly_price>=150),
  max_locations integer not null default 1 check(max_locations between 1 and 1000),
  max_sites integer not null default 1 check(max_sites between 1 and 100),
  custom_resource_policy jsonb not null default '{}'::jsonb,
  custom_integration_policy jsonb not null default '{}'::jsonb,
  custom_permissions_policy jsonb not null default '{}'::jsonb,
  owner_approved boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Default all external/high-risk capabilities OFF. Architecture exists without silently enabling providers.
insert into public.nxq_feature_flags(feature_key,globally_enabled,staging_enabled,production_enabled,emergency_kill_switch)
values
 ('behavior_tracking',false,false,false,false),
 ('ai_optimization',false,false,false,false),
 ('ab_testing',false,false,false,false),
 ('crm_sync',false,false,false,false),
 ('custom_ai_agents',false,false,false,false),
 ('predictive_analytics',false,false,false,false),
 ('paid_usage_topups',false,false,false,false)
on conflict(feature_key) do nothing;

insert into public.nxq_provider_adapter_registry(adapter_key,capability,enabled,staging_allowed,production_allowed,secret_values_stored_here)
values
 ('ai-model','structured_ai',false,false,false,false),
 ('notification','transactional_notification',false,false,false,false),
 ('malware','file_scanning',false,false,false,false),
 ('analytics-import','analytics_import',false,false,false,false),
 ('review-import','review_import',false,false,false,false),
 ('crm','crm_sync',false,false,false,false)
on conflict(adapter_key) do nothing;

-- RLS: raw intelligence/control-plane tables are not client-writable. Client-facing summaries should be exposed via narrow RPCs/views.
alter table public.nxq_consent_records enable row level security;
alter table public.nxq_platform_events enable row level security;
alter table public.nxq_behavior_events enable row level security;
alter table public.nxq_optimization_findings enable row level security;
alter table public.nxq_experiments enable row level security;
alter table public.nxq_experiment_variants enable row level security;
alter table public.nxq_feature_flags enable row level security;
alter table public.nxq_provider_adapter_registry enable row level security;
alter table public.nxq_automation_jobs_v2 enable row level security;
alter table public.nxq_enterprise_account_policies enable row level security;

revoke all on public.nxq_consent_records,public.nxq_platform_events,public.nxq_behavior_events,public.nxq_optimization_findings,public.nxq_experiments,public.nxq_experiment_variants,public.nxq_feature_flags,public.nxq_provider_adapter_registry,public.nxq_automation_jobs_v2,public.nxq_enterprise_account_policies from public,anon,authenticated;
grant select,insert,update,delete on public.nxq_consent_records,public.nxq_platform_events,public.nxq_behavior_events,public.nxq_optimization_findings,public.nxq_experiments,public.nxq_experiment_variants,public.nxq_feature_flags,public.nxq_provider_adapter_registry,public.nxq_automation_jobs_v2,public.nxq_enterprise_account_policies to service_role;

grant select on public.nxq_feature_flags to authenticated;
create policy nxq_feature_flags_authenticated_read on public.nxq_feature_flags for select to authenticated using(true);

-- Owner-only read access for raw control plane and intelligence evidence.
grant select on public.nxq_platform_events,public.nxq_optimization_findings,public.nxq_experiments,public.nxq_experiment_variants,public.nxq_provider_adapter_registry,public.nxq_automation_jobs_v2,public.nxq_enterprise_account_policies to authenticated;
create policy nxq_platform_events_owner_read on public.nxq_platform_events for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_optimization_owner_read on public.nxq_optimization_findings for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_experiments_owner_read on public.nxq_experiments for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_experiment_variants_owner_read on public.nxq_experiment_variants for select to authenticated using(exists(select 1 from public.nxq_experiments e join public.owner_users o on o.auth_user_id=auth.uid() where e.id=experiment_id));
create policy nxq_provider_registry_owner_read on public.nxq_provider_adapter_registry for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_jobs_owner_read on public.nxq_automation_jobs_v2 for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_enterprise_policy_owner_read on public.nxq_enterprise_account_policies for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));

comment on table public.nxq_usage_credit_purchases is 'One-time only NXQ usage top-ups. $10 paid creates $9 carryover usable usage credit; never a subscription or automatic refill.';
comment on table public.nxq_usage_credit_ledger is 'Usage-only carryover ledger. It is intentionally separate from tier entitlements and referral/billing credits.';
comment on function public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb) is 'Atomic pre-provider economic reservation: tier controls feature access, included monthly budget resets by month, paid usage credits carry forward, and missing policy fails closed.';
comment on table public.nxq_platform_events is 'Normalized non-sensitive NXQ account timeline for analytics, optimization and future AI context without unrestricted database access.';
comment on table public.nxq_behavior_events is 'Consent-linked behavior telemetry with database-enforced prohibition on sensitive-field capture.';
comment on table public.nxq_feature_flags is 'Global/environment emergency switches. High-risk/external capabilities default disabled.';
comment on table public.nxq_provider_adapter_registry is 'Provider-agnostic capability registry; secret values are explicitly forbidden from this table.';
comment on table public.nxq_automation_jobs_v2 is 'Idempotent queued job state model with retries, review and dead-letter states for autonomous NXQ operations.';
