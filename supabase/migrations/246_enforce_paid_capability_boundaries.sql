-- Launch-critical paid-capability enforcement.
-- Subscription tier remains feature authority. Usage credits extend metered usage only.
-- Every external worker transition is intercepted before provider work can begin.

alter table public.nxq_client_resource_reservations
  add column if not exists status text not null default 'reserved'
    check (status in ('reserved','consumed','released')),
  add column if not exists released_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.nxq_economic_usage_reservations
  add column if not exists status text not null default 'reserved'
    check (status in ('reserved','consumed','released','reconciled')),
  add column if not exists actual_provider_cost_cents integer
    check (actual_provider_cost_cents is null or actual_provider_cost_cents >= 0),
  add column if not exists released_at timestamptz,
  add column if not exists reconciled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.nxq_platform_cost_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  emergency_stop boolean not null default true,
  monthly_limit_cents integer not null default 0 check (monthly_limit_cents >= 0),
  updated_at timestamptz not null default now()
);

insert into public.nxq_platform_cost_settings(singleton)
values (true)
on conflict(singleton) do nothing;

create table if not exists public.nxq_platform_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null,
  idempotency_key text not null unique,
  estimated_cost_cents integer not null check (estimated_cost_cents >= 0),
  actual_cost_cents integer check (actual_cost_cents is null or actual_cost_cents >= 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released','reconciled')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz,
  reconciled_at timestamptz
);

create index if not exists nxq_platform_cost_reservations_month_idx
  on public.nxq_platform_cost_reservations(occurred_at,status);

alter table public.nxq_platform_cost_settings enable row level security;
alter table public.nxq_platform_cost_reservations enable row level security;
revoke all on public.nxq_platform_cost_settings,public.nxq_platform_cost_reservations
  from public,anon,authenticated;
grant select,insert,update,delete on public.nxq_platform_cost_settings,public.nxq_platform_cost_reservations
  to service_role;

create or replace function public.nxq_reserve_platform_usage(
  target_operation_key text,
  target_estimated_cost_cents integer,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare settings_row public.nxq_platform_cost_settings%rowtype;
  prior public.nxq_platform_cost_reservations%rowtype;
  used integer; reservation_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if nullif(btrim(target_operation_key),'') is null
     or length(coalesce(target_idempotency_key,''))<8
     or target_estimated_cost_cents<0 then
    raise exception 'Invalid platform cost reservation.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nxq-platform-cost-budget'));
  select * into prior from public.nxq_platform_cost_reservations
  where idempotency_key=target_idempotency_key;
  if prior.id is not null then
    return jsonb_build_object('ok',true,'allowed',prior.status<>'released','idempotent',true,'status',prior.status);
  end if;
  select * into settings_row from public.nxq_platform_cost_settings where singleton=true for update;
  if not found or not settings_row.enabled then raise exception 'PLATFORM_COST_BLOCKER: platform-paid operations are disabled.'; end if;
  if settings_row.emergency_stop then raise exception 'PLATFORM_COST_BLOCKER: platform emergency stop is active.'; end if;
  select coalesce(sum(coalesce(actual_cost_cents,estimated_cost_cents)),0)::integer into used
  from public.nxq_platform_cost_reservations
  where status<>'released' and occurred_at>=date_trunc('month',now())
    and occurred_at<date_trunc('month',now())+interval '1 month';
  if used+target_estimated_cost_cents>settings_row.monthly_limit_cents then
    raise exception 'PLATFORM_COST_BLOCKER: monthly platform cost limit reached.';
  end if;
  insert into public.nxq_platform_cost_reservations(operation_key,idempotency_key,estimated_cost_cents,metadata)
  values(btrim(target_operation_key),target_idempotency_key,target_estimated_cost_cents,coalesce(target_metadata,'{}'::jsonb))
  returning id into reservation_id;
  return jsonb_build_object('ok',true,'allowed',true,'idempotent',false,'reservation_id',reservation_id);
end;
$$;

create or replace function public.nxq_finalize_platform_usage(
  target_idempotency_key text,
  target_actual_cost_cents integer default null,
  target_release boolean default false
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare row_value public.nxq_platform_cost_reservations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into row_value from public.nxq_platform_cost_reservations
  where idempotency_key=target_idempotency_key for update;
  if not found then raise exception 'Platform reservation not found.'; end if;
  if row_value.status in ('released','reconciled','consumed') then
    return jsonb_build_object('ok',true,'idempotent',true,'status',row_value.status);
  end if;
  if target_release then
    update public.nxq_platform_cost_reservations set status='released',released_at=now(),updated_at=now()
    where id=row_value.id;
    return jsonb_build_object('ok',true,'released',true);
  end if;
  if target_actual_cost_cents is not null and target_actual_cost_cents>row_value.estimated_cost_cents then
    raise exception 'Actual platform cost exceeds its pre-authorized reservation.';
  end if;
  update public.nxq_platform_cost_reservations set
    status=case when target_actual_cost_cents is null then 'consumed' else 'reconciled' end,
    actual_cost_cents=coalesce(target_actual_cost_cents,estimated_cost_cents),
    reconciled_at=case when target_actual_cost_cents is null then null else now() end,
    updated_at=now()
  where id=row_value.id;
  return jsonb_build_object('ok',true,'released',false,'status',case when target_actual_cost_cents is null then 'consumed' else 'reconciled' end);
end;
$$;

revoke all on function public.nxq_reserve_platform_usage(text,integer,text,jsonb),
  public.nxq_finalize_platform_usage(text,integer,boolean) from public,anon,authenticated;
grant execute on function public.nxq_reserve_platform_usage(text,integer,text,jsonb),
  public.nxq_finalize_platform_usage(text,integer,boolean) to service_role;

-- Every catalog family uses the same standard tier economics. Enterprise remains price-driven.
insert into public.nxq_tier_economic_policies(product_family_slug,tier_key,custom_price_driven)
select family.slug,tier_key,tier_key='enterprise'
from public.product_families family
cross join (values('starter'),('growth'),('intelligence'),('enterprise')) tiers(tier_key)
on conflict(product_family_slug,tier_key) do update set
  preferred_margin_percent=95,target_margin_percent=90,minimum_margin_percent=85,
  custom_price_driven=excluded.custom_price_driven,topup_purchase_cents=1000,
  topup_usable_cents=900,recurring_topup_allowed=false,auto_refill_allowed=false,updated_at=now();

-- Commerce family membership is the canonical base storefront entitlement.
insert into public.nxq_tier_entitlements(product_family_slug,tier_key,feature_key,enabled,limits)
select 'commerce',tier_key,'commerce_storefront',true,'{}'::jsonb
from (values('starter'),('growth'),('intelligence'),('enterprise')) tiers(tier_key)
on conflict(product_family_slug,tier_key,feature_key) do update set
  enabled=excluded.enabled,limits=excluded.limits,updated_at=now();

create or replace function public.nxq_reserve_client_resource(
  target_client_id uuid,target_resource_key text,target_units bigint,
  target_idempotency_key text,target_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.nxq_client_resource_policies%rowtype; used bigint; projected bigint;
  prior_status text;
begin
  if auth.role()<>'service_role' and (target_client_id<>public.current_client_id() or auth.uid() is null) then raise exception 'Access denied.'; end if;
  if target_units<=0 or length(coalesce(target_idempotency_key,''))<8 then raise exception 'Invalid reservation.'; end if;
  select * into p from public.nxq_client_resource_policies
  where client_id=target_client_id and resource_key=target_resource_key for update;
  if not found then raise exception 'No server-side resource policy is configured.'; end if;
  select status into prior_status from public.nxq_client_resource_reservations
  where client_id=target_client_id and resource_key=target_resource_key and idempotency_key=target_idempotency_key;
  if prior_status is not null then
    return jsonb_build_object('ok',true,'allowed',prior_status<>'released','idempotent',true,'status',prior_status);
  end if;
  select coalesce(sum(units),0) into used from public.nxq_client_resource_reservations
  where client_id=target_client_id and resource_key=target_resource_key and status<>'released'
    and occurred_at>=date_trunc('month',now()) and occurred_at<date_trunc('month',now())+interval '1 month';
  projected:=used+target_units;
  if p.hard_stop and projected>p.monthly_limit then
    return jsonb_build_object('ok',false,'allowed',false,'reason','monthly_limit_reached','used',used,'limit',p.monthly_limit,'resets_at',date_trunc('month',now())+interval '1 month');
  end if;
  insert into public.nxq_client_resource_reservations(client_id,resource_key,units,idempotency_key,metadata)
  values(target_client_id,target_resource_key,target_units,target_idempotency_key,coalesce(target_metadata,'{}'::jsonb));
  return jsonb_build_object('ok',true,'allowed',true,'used',projected,'limit',p.monthly_limit,
    'warning',projected*100>=p.monthly_limit*p.warning_percent,'remaining',greatest(p.monthly_limit-projected,0),
    'resets_at',date_trunc('month',now())+interval '1 month');
end; $$;

create or replace function public.nxq_reserve_economic_usage(
  target_client_id uuid,target_estimated_provider_cost_cents integer,target_idempotency_key text,
  target_resource_key text default 'provider_cost_cents',target_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; policy public.nxq_tier_economic_policies%rowtype;
  spent_this_month integer; projected integer; included_budget integer; hard_ceiling integer;
  paid_balance integer; prior_overage integer; new_overage integer; paid_needed integer; prior_status text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if target_estimated_provider_cost_cents<0 or length(coalesce(target_idempotency_key,''))<8 then raise exception 'Invalid economic reservation.'; end if;
  select cl.id,cl.monthly_price,cl.status::text client_status,cl.billing_status::text billing_status,
    cl.pipeline_stopped_at,coalesce(cl.qa_only,false) qa_only,pf.slug family_slug,pft.tier_key
  into c from public.clients cl
  join public.product_families pf on pf.id=cl.product_family_id
  join public.product_family_tiers pft on pft.id=cl.product_tier_id and pft.product_family_id=pf.id
  where cl.id=target_client_id for update of cl;
  if c.id is null then raise exception 'Client, product family, or tier is missing.'; end if;
  if c.qa_only then raise exception 'QA-only cost must use the protected platform budget.'; end if;
  if c.pipeline_stopped_at is not null or c.client_status not in ('approved','active','overdue') then raise exception 'Client lifecycle does not permit paid usage.'; end if;
  if c.billing_status not in ('active','past_due') then raise exception 'Client billing state does not permit paid usage.'; end if;
  select status into prior_status from public.nxq_economic_usage_reservations
  where client_id=target_client_id and idempotency_key=target_idempotency_key;
  if prior_status is not null then
    return jsonb_build_object('ok',true,'allowed',prior_status<>'released','idempotent',true,'status',prior_status);
  end if;
  select * into policy from public.nxq_tier_economic_policies
  where product_family_slug=c.family_slug and tier_key=c.tier_key;
  if policy.tier_key is null then raise exception 'Economic policy missing; deny by default.'; end if;
  if c.monthly_price is null or c.monthly_price<=0 then raise exception 'Approved monthly price required for economic reservation.'; end if;
  included_budget:=floor(c.monthly_price*100*((100-policy.target_margin_percent)/100))::integer;
  hard_ceiling:=floor(c.monthly_price*100*((100-policy.minimum_margin_percent)/100))::integer;
  select coalesce(sum(coalesce(actual_provider_cost_cents,estimated_provider_cost_cents)),0)::integer into spent_this_month
  from public.nxq_economic_usage_reservations where client_id=target_client_id and status<>'released'
    and occurred_at>=date_trunc('month',now()) and occurred_at<date_trunc('month',now())+interval '1 month';
  projected:=spent_this_month+target_estimated_provider_cost_cents;
  prior_overage:=greatest(spent_this_month-included_budget,0); new_overage:=greatest(projected-included_budget,0);
  paid_needed:=greatest(new_overage-prior_overage,0);
  select greatest(coalesce(sum(amount_cents),0),0)::integer into paid_balance
  from public.nxq_usage_credit_ledger where client_id=target_client_id;
  if paid_needed>paid_balance then
    return jsonb_build_object('ok',false,'allowed',false,'reason','usage_credit_required',
      'included_budget_cents',included_budget,'hard_subscription_cost_ceiling_cents',hard_ceiling,
      'paid_credit_balance_cents',paid_balance,'paid_credit_needed_cents',paid_needed);
  end if;
  if paid_needed>0 then
    insert into public.nxq_usage_credit_ledger(client_id,entry_type,amount_cents,idempotency_key,resource_key,metadata)
    values(target_client_id,'usage_spend',-paid_needed,'usage-spend:'||target_idempotency_key,target_resource_key,coalesce(target_metadata,'{}'::jsonb));
  end if;
  insert into public.nxq_economic_usage_reservations(client_id,idempotency_key,estimated_provider_cost_cents,
    included_budget_cents,hard_subscription_cost_ceiling_cents,paid_credit_spent_cents,target_margin_percent,
    minimum_margin_percent,metadata)
  values(target_client_id,target_idempotency_key,target_estimated_provider_cost_cents,included_budget,hard_ceiling,
    paid_needed,policy.target_margin_percent,policy.minimum_margin_percent,coalesce(target_metadata,'{}'::jsonb));
  return jsonb_build_object('ok',true,'allowed',true,'idempotent',false,'included_budget_cents',included_budget,
    'hard_subscription_cost_ceiling_cents',hard_ceiling,'projected_provider_cost_cents',projected,
    'paid_credit_spent_cents',paid_needed,'paid_credit_balance_after_cents',greatest(paid_balance-paid_needed,0));
end; $$;

create or replace function public.nxq_finalize_economic_usage(
  target_client_id uuid,target_idempotency_key text,target_actual_provider_cost_cents integer default null,
  target_release boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.nxq_economic_usage_reservations%rowtype; refund integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into r from public.nxq_economic_usage_reservations
  where client_id=target_client_id and idempotency_key=target_idempotency_key for update;
  if not found then raise exception 'Economic reservation not found.'; end if;
  if r.status in ('released','reconciled','consumed') then return jsonb_build_object('ok',true,'idempotent',true,'status',r.status); end if;
  if target_release then refund:=r.paid_credit_spent_cents;
  elsif target_actual_provider_cost_cents is not null then
    if target_actual_provider_cost_cents>r.estimated_provider_cost_cents then raise exception 'Actual provider cost exceeds its pre-authorized reservation.'; end if;
    refund:=least(r.paid_credit_spent_cents,r.estimated_provider_cost_cents-target_actual_provider_cost_cents);
  end if;
  if refund>0 then
    insert into public.nxq_usage_credit_ledger(client_id,entry_type,amount_cents,idempotency_key,resource_key,metadata)
    values(target_client_id,'reversal',refund,'usage-refund:'||target_idempotency_key,
      coalesce(r.metadata->>'resource_key','provider_cost_cents'),jsonb_build_object('reservation_id',r.id));
  end if;
  update public.nxq_economic_usage_reservations set
    status=case when target_release then 'released' when target_actual_provider_cost_cents is null then 'consumed' else 'reconciled' end,
    actual_provider_cost_cents=case when target_release then 0 else coalesce(target_actual_provider_cost_cents,estimated_provider_cost_cents) end,
    released_at=case when target_release then now() else null end,
    reconciled_at=case when not target_release and target_actual_provider_cost_cents is not null then now() else null end,
    updated_at=now() where id=r.id;
  update public.nxq_client_resource_reservations set
    status=case when target_release then 'released' else 'consumed' end,
    released_at=case when target_release then now() else null end,
    updated_at=now()
  where client_id=target_client_id and idempotency_key like target_idempotency_key||':%'
    and status='reserved';
  return jsonb_build_object('ok',true,'released',target_release,'credit_refunded_cents',refund);
end; $$;

revoke all on function public.nxq_finalize_economic_usage(uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.nxq_finalize_economic_usage(uuid,text,integer,boolean) to service_role;

create or replace function public.nxq_record_usage_credit_purchase(
  target_client_id uuid,target_provider_key text,target_provider_payment_event_id text,
  target_amount_paid_cents integer,target_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare purchase_row public.nxq_usage_credit_purchases%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if target_amount_paid_cents<>1000 then raise exception 'NXQ usage top-up must be exactly 1000 cents.'; end if;
  if nullif(btrim(target_provider_key),'') is null or nullif(btrim(target_provider_payment_event_id),'') is null then
    raise exception 'Verified provider payment identity is required.';
  end if;
  if not exists(select 1 from public.clients where id=target_client_id and not coalesce(qa_only,false)) then
    raise exception 'A billable client is required.';
  end if;
  insert into public.nxq_usage_credit_purchases(client_id,provider_key,provider_payment_event_id,
    amount_paid_cents,usable_credit_cents,recurring,auto_refill,metadata)
  values(target_client_id,btrim(target_provider_key),btrim(target_provider_payment_event_id),1000,900,false,false,coalesce(target_metadata,'{}'::jsonb))
  on conflict(provider_key,provider_payment_event_id) do nothing returning * into purchase_row;
  if purchase_row.id is null then
    select * into purchase_row from public.nxq_usage_credit_purchases
    where provider_key=btrim(target_provider_key) and provider_payment_event_id=btrim(target_provider_payment_event_id);
    if purchase_row.client_id<>target_client_id then raise exception 'Payment event is already bound to another client.'; end if;
    return jsonb_build_object('ok',true,'idempotent',true,'purchase_id',purchase_row.id,
      'usable_credit_cents',purchase_row.usable_credit_cents,'recurring',false,'auto_refill',false);
  end if;
  insert into public.nxq_usage_credit_ledger(client_id,purchase_id,entry_type,amount_cents,idempotency_key,metadata)
  values(target_client_id,purchase_row.id,'purchase_credit',900,'usage-purchase:'||purchase_row.id::text,coalesce(target_metadata,'{}'::jsonb));
  return jsonb_build_object('ok',true,'idempotent',false,'purchase_id',purchase_row.id,
    'amount_paid_cents',1000,'usable_credit_cents',900,'nxq_retained_cents',100,
    'recurring',false,'auto_refill',false,'carries_forward',true);
end; $$;
revoke all on function public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb) to service_role;

create or replace function public.nxq_authorize_paid_capability(
  target_client_id uuid,target_feature_key text,target_resources jsonb,
  target_estimated_provider_cost_cents integer,target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; entitlement public.nxq_tier_entitlements%rowtype; item record; result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  if target_client_id is null or length(coalesce(target_idempotency_key,''))<8
     or jsonb_typeof(coalesce(target_resources,'{}'::jsonb))<>'object' then raise exception 'Invalid paid capability request.'; end if;
  select cl.id,cl.status::text client_status,cl.billing_status::text billing_status,cl.pipeline_stopped_at,
    coalesce(cl.qa_only,false) qa_only,pf.slug family_slug,pft.tier_key
  into c from public.clients cl
  join public.product_families pf on pf.id=cl.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=cl.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where cl.id=target_client_id for update of cl;
  if c.id is null then raise exception 'Paid capability denied: exact active family and tier are required.'; end if;
  if c.pipeline_stopped_at is not null or c.client_status not in ('approved','active','overdue') then raise exception 'Paid capability denied by client lifecycle.'; end if;
  if target_feature_key is not null then
    select * into entitlement from public.nxq_tier_entitlements
    where product_family_slug=c.family_slug and tier_key=c.tier_key and feature_key=target_feature_key;
    if entitlement.id is null or not entitlement.enabled then raise exception 'Paid capability denied by subscription tier.'; end if;
  end if;
  if c.qa_only then
    return public.nxq_reserve_platform_usage('qa:'||coalesce(target_feature_key,'metered'),target_estimated_provider_cost_cents,
      'qa:'||target_idempotency_key,coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('qa_only',true));
  end if;
  if c.billing_status not in ('active','past_due') then raise exception 'Paid capability denied by billing state.'; end if;
  for item in select key,value from jsonb_each_text(coalesce(target_resources,'{}'::jsonb)) loop
    if item.value::bigint<=0 then raise exception 'Resource units must be positive.'; end if;
    result:=public.nxq_reserve_client_resource(target_client_id,item.key,item.value::bigint,
      target_idempotency_key||':'||item.key,coalesce(target_metadata,'{}'::jsonb));
    if not coalesce((result->>'allowed')::boolean,false) then raise exception 'Paid capability denied by % resource limit.',item.key; end if;
  end loop;
  result:=public.nxq_reserve_economic_usage(target_client_id,target_estimated_provider_cost_cents,
    target_idempotency_key,'provider_cost_cents',coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('resource_key','provider_cost_cents'));
  if not coalesce((result->>'allowed')::boolean,false) then raise exception 'Paid capability denied: usage credit is required.'; end if;
  return jsonb_build_object('ok',true,'allowed',true,'feature_key',target_feature_key,'family',c.family_slug,'tier',c.tier_key);
end; $$;

revoke all on function public.nxq_authorize_paid_capability(uuid,text,jsonb,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.nxq_authorize_paid_capability(uuid,text,jsonb,integer,text,jsonb) to service_role;

-- Internal policy seeding is trigger-safe; the public wrapper remains owner/service-role only.
create or replace function public.nxq_seed_client_resource_policies_internal(target_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; policy public.nxq_tier_economic_policies%rowtype; hard_cost_cap bigint; grant_cap bigint; seeded integer:=0;
begin
  select client.id,client.monthly_price,coalesce(client.qa_only,false) qa_only,pf.slug family_slug,pft.tier_key
  into c from public.clients client
  join public.product_families pf on pf.id=client.product_family_id
  join public.product_family_tiers pft on pft.id=client.product_tier_id and pft.product_family_id=pf.id
  where client.id=target_client_id;
  if c.id is null then raise exception 'Client, product family, or tier not found.'; end if;
  select * into policy from public.nxq_tier_economic_policies where product_family_slug=c.family_slug and tier_key=c.tier_key;
  if policy.tier_key is null then raise exception 'Economic policy missing; deny by default.'; end if;
  if not c.qa_only and (c.monthly_price is null or c.monthly_price<=0) then raise exception 'Approved monthly price required.'; end if;
  hard_cost_cap:=case when c.qa_only then 0 else floor(c.monthly_price*100*((100-policy.minimum_margin_percent)/100))::bigint end;
  select floor(monthly_nxq_cost_cap*100)::bigint into grant_cap from public.nxq_founding_grant_awards where client_id=c.id and status='active';
  insert into public.nxq_client_resource_policies(client_id,resource_key,monthly_limit,warning_percent,hard_stop,policy_source,updated_at)
  select c.id,d.resource_key,case when c.qa_only then 0
    when d.resource_key='provider_cost_cents' and grant_cap is not null then least(d.monthly_limit,grant_cap,hard_cost_cap)
    when d.resource_key='provider_cost_cents' then least(d.monthly_limit,hard_cost_cap) else d.monthly_limit end,
    d.warning_percent,true,case when c.qa_only then 'qa_platform_budget' when grant_cap is not null then 'founding_grant' else 'tier_economic_policy' end,now()
  from public.nxq_tier_resource_defaults d where d.tier_key=c.tier_key
  on conflict(client_id,resource_key) do update set monthly_limit=excluded.monthly_limit,
    warning_percent=excluded.warning_percent,hard_stop=true,policy_source=excluded.policy_source,updated_at=now();
  get diagnostics seeded=row_count;
  return jsonb_build_object('ok',true,'policies_written',seeded,'family',c.family_slug,'tier',c.tier_key);
end; $$;

revoke all on function public.nxq_seed_client_resource_policies_internal(uuid) from public,anon,authenticated,service_role;

create or replace function public.nxq_seed_client_resource_policies(target_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' and not public.is_nxq_owner() then raise exception 'Owner or service-role access required.'; end if;
  return public.nxq_seed_client_resource_policies_internal(target_client_id);
end; $$;
revoke all on function public.nxq_seed_client_resource_policies(uuid) from public,anon,authenticated,service_role;
grant execute on function public.nxq_seed_client_resource_policies(uuid) to authenticated,service_role;

create or replace function public.nxq_sync_client_resource_policy()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status::text in ('approved','active','overdue')
     and new.product_family_id is not null and new.product_tier_id is not null
     and (new.qa_only or coalesce(new.monthly_price,0)>0) then
    if auth.role()<>'service_role' and not public.is_nxq_owner() then
      raise exception 'Only an owner or protected service may seed resource policies.';
    end if;
    perform public.nxq_seed_client_resource_policies_internal(new.id);
  end if;
  return new;
end; $$;
revoke all on function public.nxq_sync_client_resource_policy() from public,anon,authenticated,service_role;
drop trigger if exists nxq_sync_client_resource_policy on public.clients;
create trigger nxq_sync_client_resource_policy after insert or update of product_family_id,product_tier_id,monthly_price,qa_only,status
on public.clients for each row execute function public.nxq_sync_client_resource_policy();

do $$ declare client_row record; begin
  for client_row in select id from public.clients where product_family_id is not null and product_tier_id is not null and (qa_only or coalesce(monthly_price,0)>0)
  loop perform public.nxq_seed_client_resource_policies_internal(client_row.id); end loop;
end $$;

-- Canonical access is fail-closed and billing-aware. Past-due is the existing grace state.
create or replace function public.current_client_feature_access(target_feature_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare client_row record; entitlement public.nxq_tier_entitlements%rowtype;
begin
  if nullif(btrim(target_feature_key),'') is null then return jsonb_build_object('allowed',false,'reason','feature_key_required'); end if;
  select c.id,c.status::text client_status,c.billing_status::text billing_status,c.pipeline_stopped_at,
    pf.slug family_slug,pft.tier_key into client_row
  from public.clients c join public.product_families pf on pf.id=c.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=c.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where c.auth_user_id=auth.uid() order by c.created_at desc limit 1;
  if client_row.id is null then return jsonb_build_object('allowed',false,'reason','client_family_or_tier_missing'); end if;
  select * into entitlement from public.nxq_tier_entitlements where product_family_slug=client_row.family_slug
    and tier_key=client_row.tier_key and feature_key=target_feature_key;
  return jsonb_build_object('allowed',coalesce(entitlement.enabled,false)
      and client_row.client_status in ('approved','active','overdue')
      and client_row.billing_status in ('active','past_due') and client_row.pipeline_stopped_at is null,
    'reason',case when client_row.pipeline_stopped_at is not null then 'pipeline_stopped'
      when client_row.client_status not in ('approved','active','overdue') then 'client_not_active'
      when client_row.billing_status not in ('active','past_due') then 'billing_not_active'
      when entitlement.id is null then 'feature_not_entitled' when not entitlement.enabled then 'tier_not_entitled' else 'allowed' end,
    'product_family_slug',client_row.family_slug,'tier_key',client_row.tier_key,
    'feature_key',target_feature_key,'limits',coalesce(entitlement.limits,'{}'::jsonb));
end; $$;

create or replace function public.client_feature_access(target_client_id uuid,target_feature_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare client_row record; entitlement public.nxq_tier_entitlements%rowtype;
begin
  if auth.role()<>'service_role' and not public.is_nxq_owner() then raise exception 'Owner or service-role access required.'; end if;
  select c.id,c.status::text client_status,c.billing_status::text billing_status,c.pipeline_stopped_at,
    pf.slug family_slug,pft.tier_key into client_row
  from public.clients c join public.product_families pf on pf.id=c.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=c.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where c.id=target_client_id;
  if client_row.id is null then return jsonb_build_object('allowed',false,'reason','client_family_or_tier_missing'); end if;
  select * into entitlement from public.nxq_tier_entitlements where product_family_slug=client_row.family_slug
    and tier_key=client_row.tier_key and feature_key=target_feature_key;
  return jsonb_build_object('allowed',coalesce(entitlement.enabled,false)
      and client_row.client_status in ('approved','active','overdue')
      and client_row.billing_status in ('active','past_due') and client_row.pipeline_stopped_at is null,
    'reason',case when client_row.pipeline_stopped_at is not null then 'pipeline_stopped'
      when client_row.client_status not in ('approved','active','overdue') then 'client_not_active'
      when client_row.billing_status not in ('active','past_due') then 'billing_not_active'
      when entitlement.id is null then 'feature_not_entitled' when not entitlement.enabled then 'tier_not_entitled' else 'allowed' end,
    'product_family_slug',client_row.family_slug,'tier_key',client_row.tier_key,
    'feature_key',target_feature_key,'limits',coalesce(entitlement.limits,'{}'::jsonb));
end; $$;

revoke all on function public.current_client_feature_access(text),public.client_feature_access(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.current_client_feature_access(text) to authenticated;
grant execute on function public.client_feature_access(uuid,text) to authenticated,service_role;

create or replace function public.sync_client_analytics_entitlements()
returns trigger language plpgsql security definer set search_path=public as $$
declare family_slug text; tier_key_value text; eligible boolean; analytics_allowed boolean; mouse_allowed boolean;
begin
  select pf.slug,pft.tier_key into family_slug,tier_key_value
  from public.product_families pf join public.product_family_tiers pft
    on pft.product_family_id=pf.id and pft.id=new.product_tier_id
  where pf.id=new.product_family_id and pf.is_active=true and pft.is_active=true;
  eligible:=family_slug='business' and new.pipeline_stopped_at is null
    and new.status::text in ('approved','active','overdue')
    and new.billing_status::text in ('active','past_due');
  analytics_allowed:=eligible and tier_key_value in ('growth','intelligence','enterprise');
  mouse_allowed:=eligible and tier_key_value in ('intelligence','enterprise');
  update public.website_analytics_profiles set
    status=case when not analytics_allowed then 'disabled' when status='paused' then 'paused' else 'enabled' end,
    mouse_tracking_enabled=mouse_allowed,retention_days=case when mouse_allowed then 90 else 30 end,updated_at=now()
  where client_id=new.id;
  if found then
    insert into public.automation_audit_log(client_id,event_type,actor_type,details)
    values(new.id,'client_analytics_entitlements_synced','backend',jsonb_build_object(
      'family',family_slug,'tier_key',tier_key_value,'client_status',new.status::text,
      'billing_status',new.billing_status::text,'advanced_analytics_allowed',analytics_allowed,
      'mouse_tracking_allowed',mouse_allowed,'consent_required',true));
  end if;
  return new;
end; $$;
drop trigger if exists sync_client_analytics_entitlements on public.clients;
create trigger sync_client_analytics_entitlements
after update of product_family_id,product_tier_id,status,billing_status,pipeline_stopped_at on public.clients
for each row execute function public.sync_client_analytics_entitlements();
revoke all on function public.sync_client_analytics_entitlements() from public,anon,authenticated,service_role;

create or replace function public.nxq_enforce_enterprise_price_floor()
returns trigger language plpgsql security definer set search_path=public as $$
declare selected_tier text;
begin
  if new.product_tier_id is not null then select tier_key into selected_tier from public.product_family_tiers where id=new.product_tier_id; end if;
  if selected_tier='enterprise' and new.status::text in ('approved','active','overdue')
     and (new.monthly_price is null or new.monthly_price<150) then
    raise exception 'Enterprise monthly price must be at least $150.';
  end if;
  return new;
end; $$;
drop trigger if exists nxq_enforce_enterprise_price_floor on public.clients;
create trigger nxq_enforce_enterprise_price_floor before insert or update of product_tier_id,monthly_price,status
on public.clients for each row execute function public.nxq_enforce_enterprise_price_floor();
revoke all on function public.nxq_enforce_enterprise_price_floor() from public,anon,authenticated,service_role;

create or replace function public.nxq_enforce_location_entitlement()
returns trigger language plpgsql security definer set search_path=public as $$
declare c record; location_limit integer; current_count integer;
begin
  select cl.status::text client_status,cl.billing_status::text billing_status,cl.pipeline_stopped_at,
    pf.slug family_slug,pft.tier_key into c from public.clients cl
  join public.product_families pf on pf.id=cl.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=cl.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where cl.id=new.client_id;
  if c.family_slug is distinct from 'business' or c.pipeline_stopped_at is not null
     or c.client_status not in ('approved','active','overdue') or c.billing_status not in ('active','past_due') then
    raise exception 'Current subscription does not permit location creation.';
  end if;
  location_limit:=case when c.tier_key='enterprise' then
    coalesce((select (limits->>'max_locations')::integer from public.nxq_tier_entitlements
      where product_family_slug='business' and tier_key='enterprise' and feature_key='multi_location' and enabled),0)
    else 1 end;
  if location_limit<=0 then raise exception 'A positive server-side location limit is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('client-locations:'||new.client_id::text,0));
  select count(*) into current_count from public.client_locations where client_id=new.client_id and status<>'closed';
  if current_count>=location_limit then raise exception 'Current plan location limit reached (%).',location_limit; end if;
  return new;
end; $$;
drop trigger if exists nxq_enforce_location_entitlement on public.client_locations;
create trigger nxq_enforce_location_entitlement before insert on public.client_locations
for each row execute function public.nxq_enforce_location_entitlement();
revoke all on function public.nxq_enforce_location_entitlement() from public,anon,authenticated,service_role;

-- Job policy is server-owned. Missing policy blocks any external/AI job transition.
create table if not exists public.nxq_metered_job_policies (
  job_type text primary key,
  feature_key text,
  resources jsonb not null,
  estimated_provider_cost_cents integer not null check (estimated_provider_cost_cents>=0),
  billing_exempt boolean not null default false,
  exemption_reason text,
  check (not billing_exempt or length(coalesce(exemption_reason,''))>=12)
);
alter table public.nxq_metered_job_policies enable row level security;
revoke all on public.nxq_metered_job_policies from public,anon,authenticated;
grant select,insert,update,delete on public.nxq_metered_job_policies to service_role;

insert into public.nxq_metered_job_policies(job_type,feature_key,resources,estimated_provider_cost_cents,billing_exempt,exemption_reason)
values
 ('prepare_build_plan','managed_website','{"automation_jobs":1,"ai_tokens":10000}'::jsonb,10,false,null),
 ('classify_website_change_request','change_requests','{"automation_jobs":1,"ai_tokens":3000}'::jsonb,5,false,null),
 ('website_apply_change_request','change_requests','{"automation_jobs":1,"api_requests":10}'::jsonb,2,false,null),
 ('website_prepare_safe_branch','managed_website','{"automation_jobs":1,"api_requests":20}'::jsonb,5,false,null),
 ('website_check_preview','managed_website','{"automation_jobs":1,"api_requests":5}'::jsonb,1,false,null),
 ('website_promote_production','managed_website','{"automation_jobs":1,"api_requests":10}'::jsonb,2,false,null),
 ('website_check_production','managed_website','{"automation_jobs":1,"api_requests":5}'::jsonb,1,false,null),
 ('website_project_seo_refresh','basic_seo','{"automation_jobs":1,"api_requests":10}'::jsonb,2,false,null),
 ('website_project_seo_preview_check','basic_seo','{"automation_jobs":1,"api_requests":5}'::jsonb,1,false,null),
 ('website_project_seo_promote','basic_seo','{"automation_jobs":1,"api_requests":10}'::jsonb,2,false,null),
 ('website_project_seo_production_check','basic_seo','{"automation_jobs":1,"api_requests":5}'::jsonb,1,false,null),
 ('website_location_seo_refresh','multi_location','{"automation_jobs":1,"api_requests":10}'::jsonb,2,false,null),
 ('provision_project_infrastructure','managed_website','{"automation_jobs":1,"api_requests":20}'::jsonb,2,false,null),
 ('domain_reconcile','managed_website','{"automation_jobs":1,"api_requests":10}'::jsonb,2,false,null),
 ('scan_client_file','client_portal','{"automation_jobs":1,"api_requests":2}'::jsonb,3,false,null),
 ('process_data_subject_request',null,'{}'::jsonb,0,true,'Legally required privacy request processing must remain available.')
on conflict(job_type) do update set feature_key=excluded.feature_key,resources=excluded.resources,
  estimated_provider_cost_cents=excluded.estimated_provider_cost_cents,billing_exempt=excluded.billing_exempt,
  exemption_reason=excluded.exemption_reason;

create or replace function public.nxq_guard_external_job_transition()
returns trigger language plpgsql security definer set search_path=public as $$
declare policy public.nxq_metered_job_policies%rowtype;
begin
  if new.status='running' and old.status is distinct from 'running' and new.execution_target in ('edge','ai') then
    select * into policy from public.nxq_metered_job_policies where job_type=new.job_type;
    if not found then raise exception 'METERING_POLICY_BLOCKER: external job type has no paid-capability policy.'; end if;
    if not policy.billing_exempt then
      perform public.nxq_authorize_paid_capability(new.client_id,policy.feature_key,policy.resources,
        policy.estimated_provider_cost_cents,'job:'||new.id::text||':attempt:'||(old.attempts+1)::text,
        jsonb_build_object('job_id',new.id,'job_type',new.job_type,'execution_target',new.execution_target));
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists nxq_guard_external_job_transition on public.automation_jobs;
create trigger nxq_guard_external_job_transition before update of status on public.automation_jobs
for each row execute function public.nxq_guard_external_job_transition();
revoke all on function public.nxq_guard_external_job_transition() from public,anon,authenticated,service_role;

create or replace function public.nxq_guard_maintenance_transition()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='running' and old.status is distinct from 'running' then
    perform public.nxq_authorize_paid_capability(new.client_id,'technical_maintenance',
      jsonb_build_object('automation_jobs',1,'bandwidth_bytes',2097152),1,
      'maintenance:'||new.id::text||':attempt:'||(old.attempts+1)::text,
      jsonb_build_object('task_id',new.id,'task_type',new.task_type));
  end if;
  return new;
end; $$;
drop trigger if exists nxq_guard_maintenance_transition on public.website_maintenance_tasks;
create trigger nxq_guard_maintenance_transition before update of status on public.website_maintenance_tasks
for each row execute function public.nxq_guard_maintenance_transition();
revoke all on function public.nxq_guard_maintenance_transition() from public,anon,authenticated,service_role;

create or replace function public.nxq_guard_storefront_transition()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='processing' and old.status is distinct from 'processing' then
    if new.project_id is null then raise exception 'Commerce storefront project is required before provider work.'; end if;
    perform public.nxq_authorize_paid_capability(new.client_id,'commerce_storefront',
      jsonb_build_object('automation_jobs',1,'api_requests',30),5,
      'storefront:'||new.id::text||':attempt:'||(old.attempt_count+1)::text,
      jsonb_build_object('storefront_job_id',new.id));
  end if;
  return new;
end; $$;
drop trigger if exists nxq_guard_storefront_transition on public.commerce_storefront_provisioning;
create trigger nxq_guard_storefront_transition before update of status on public.commerce_storefront_provisioning
for each row execute function public.nxq_guard_storefront_transition();
revoke all on function public.nxq_guard_storefront_transition() from public,anon,authenticated,service_role;

create or replace function public.nxq_guard_notification_transition()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='sending' and old.status is distinct from 'sending' and new.channel<>'in_app' then
    if new.client_id is null or new.template_key ~ '^(billing|security|privacy|account_)' then
      perform public.nxq_reserve_platform_usage('notification:'||new.template_key,1,
        'notification:'||new.id::text||':attempt:'||(old.attempts+1)::text,jsonb_build_object('channel',new.channel));
    else
      perform public.nxq_authorize_paid_capability(new.client_id,null,jsonb_build_object('automation_jobs',1),1,
        'notification:'||new.id::text||':attempt:'||(old.attempts+1)::text,jsonb_build_object('channel',new.channel));
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists nxq_guard_notification_transition on public.notification_deliveries;
create trigger nxq_guard_notification_transition before update of status on public.notification_deliveries
for each row execute function public.nxq_guard_notification_transition();
revoke all on function public.nxq_guard_notification_transition() from public,anon,authenticated,service_role;

create or replace function public.nxq_authorize_preview_execution(target_preview_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare request_row public.preview_deployment_requests%rowtype; paid_result jsonb; netlify_result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into request_row from public.preview_deployment_requests where id=target_preview_request_id for update;
  if not found or request_row.status<>'approved_for_preview' or request_row.execution_status<>'prepared' then
    raise exception 'Preview request is not eligible for paid execution.';
  end if;
  paid_result:=public.nxq_authorize_paid_capability(request_row.client_id,'managed_website',
    jsonb_build_object('automation_jobs',1),1,'preview-execution:'||request_row.id::text,
    jsonb_build_object('preview_request_id',request_row.id));
  netlify_result:=public.nxq_reserve_netlify_build(request_row.client_id,request_row.project_id,'preview',
    'owner-preview:'||request_row.id::text,jsonb_build_object('preview_request_id',request_row.id));
  return jsonb_build_object('ok',true,'paid_capability',paid_result,'netlify_budget',netlify_result);
end; $$;
revoke all on function public.nxq_authorize_preview_execution(uuid) from public,anon,authenticated;
grant execute on function public.nxq_authorize_preview_execution(uuid) to service_role;

-- Billing freezes stop future claims without automatically resuming them after restoration.
create or replace function public.nxq_sync_billing_execution_state()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.billing_status::text in ('frozen','cancelled') and old.billing_status is distinct from new.billing_status then
    insert into public.client_automation_controls(client_id,automation_enabled,automation_paused,pause_reason,updated_at)
    values(new.id,true,true,'Billing state: '||new.billing_status::text,now())
    on conflict(client_id) do update set automation_paused=true,pause_reason=excluded.pause_reason,updated_at=now();
    update public.website_analytics_profiles set status='disabled',updated_at=now() where client_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists nxq_sync_billing_execution_state on public.clients;
create trigger nxq_sync_billing_execution_state after update of billing_status on public.clients
for each row execute function public.nxq_sync_billing_execution_state();
revoke all on function public.nxq_sync_billing_execution_state() from public,anon,authenticated,service_role;

-- Quota-reserved upload tickets prevent direct storage API bypasses.
create table if not exists public.nxq_storage_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bucket_id text not null check(bucket_id in ('client-files','commerce-product-media','commerce-product-images','commerce-website-content')),
  object_path text not null,
  file_size bigint not null check(file_size>0),
  mime_type text not null,
  status text not null default 'issued' check(status in ('issued','consumed','cancelled','expired')),
  resource_idempotency_key text not null unique,
  expires_at timestamptz not null default now()+interval '15 minutes',
  created_at timestamptz not null default now(),
  unique(bucket_id,object_path)
);
alter table public.nxq_storage_upload_tickets enable row level security;
revoke all on public.nxq_storage_upload_tickets from public,anon,authenticated;
grant select,insert,update,delete on public.nxq_storage_upload_tickets to service_role;

create or replace function public.nxq_authorize_storage_upload(
  target_bucket_id text,target_object_path text,target_file_size bigint,target_mime_type text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; max_size bigint; ticket_id uuid; key_value text; reserve_result jsonb;
begin
  if auth.role()<>'authenticated' or auth.uid() is null then raise exception 'Authenticated client access required.'; end if;
  select cl.id,cl.status::text client_status,cl.billing_status::text billing_status,cl.pipeline_stopped_at,
    pf.slug family_slug,pft.tier_key into c from public.clients cl
  join public.product_families pf on pf.id=cl.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=cl.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where cl.auth_user_id=auth.uid() order by cl.created_at desc limit 1 for update of cl;
  if c.id is null or c.pipeline_stopped_at is not null or c.client_status not in ('approved','active','overdue')
     or c.billing_status not in ('active','past_due') then raise exception 'Upload denied by account, tier, or billing state.'; end if;
  if split_part(target_object_path,'/',1)<>c.id::text or target_object_path like '%..%' or target_object_path like '/%' then raise exception 'Upload path is outside this client workspace.'; end if;
  if target_bucket_id='client-files' then max_size:=26214400;
  elsif target_bucket_id in ('commerce-product-media','commerce-product-images','commerce-website-content') then
    if c.family_slug<>'commerce' then raise exception 'Commerce storage requires a Commerce subscription.'; end if;
    max_size:=10485760;
  else raise exception 'Unsupported upload bucket.'; end if;
  if target_file_size<=0 or target_file_size>max_size or nullif(btrim(target_mime_type),'') is null then raise exception 'Upload size or type is invalid.'; end if;
  with expired as (
    update public.nxq_storage_upload_tickets
    set status='expired'
    where client_id=c.id and status='issued' and expires_at<=now()
    returning resource_idempotency_key
  )
  update public.nxq_client_resource_reservations reservation
  set status='released',released_at=now(),updated_at=now()
  where reservation.client_id=c.id and reservation.resource_key='storage_bytes'
    and reservation.status='reserved'
    and reservation.idempotency_key in (select resource_idempotency_key from expired);
  key_value:='storage-upload:'||encode(extensions.digest(target_bucket_id||':'||target_object_path,'sha256'),'hex');
  reserve_result:=public.nxq_reserve_client_resource(c.id,'storage_bytes',target_file_size,key_value,jsonb_build_object('bucket_id',target_bucket_id));
  if not coalesce((reserve_result->>'allowed')::boolean,false) then raise exception 'Upload denied by monthly storage limit.'; end if;
  insert into public.nxq_storage_upload_tickets(client_id,bucket_id,object_path,file_size,mime_type,resource_idempotency_key)
  values(c.id,target_bucket_id,target_object_path,target_file_size,btrim(target_mime_type),key_value)
  on conflict(bucket_id,object_path) do update set expires_at=now()+interval '15 minutes'
    where public.nxq_storage_upload_tickets.client_id=c.id and public.nxq_storage_upload_tickets.status='issued'
  returning id into ticket_id;
  if ticket_id is null then raise exception 'Upload ticket could not be issued.'; end if;
  return jsonb_build_object('ok',true,'ticket_id',ticket_id,'expires_in_seconds',900);
end; $$;

create or replace function public.nxq_complete_storage_upload_ticket(target_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket public.nxq_storage_upload_tickets%rowtype;
begin
  if auth.role()<>'authenticated' or auth.uid() is null then raise exception 'Authenticated client access required.'; end if;
  select t.* into ticket from public.nxq_storage_upload_tickets t join public.clients c on c.id=t.client_id
  where t.id=target_ticket_id and c.auth_user_id=auth.uid() for update of t;
  if not found then raise exception 'Upload ticket not found.'; end if;
  if ticket.status='issued' then
    if ticket.expires_at<=now() then raise exception 'Upload ticket expired before completion.'; end if;
    update public.nxq_storage_upload_tickets set status='consumed' where id=ticket.id;
    update public.nxq_client_resource_reservations set status='consumed',updated_at=now()
    where client_id=ticket.client_id and resource_key='storage_bytes'
      and idempotency_key=ticket.resource_idempotency_key and status='reserved';
  elsif ticket.status<>'consumed' then
    raise exception 'Upload ticket is not eligible for completion.';
  end if;
  return jsonb_build_object('ok',true,'completed',true,'idempotent',ticket.status='consumed');
end; $$;

create or replace function public.nxq_cancel_storage_upload_ticket(target_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket public.nxq_storage_upload_tickets%rowtype;
begin
  if auth.role()<>'authenticated' or auth.uid() is null then raise exception 'Authenticated client access required.'; end if;
  select t.* into ticket from public.nxq_storage_upload_tickets t join public.clients c on c.id=t.client_id
  where t.id=target_ticket_id and c.auth_user_id=auth.uid() for update of t;
  if not found then raise exception 'Upload ticket not found.'; end if;
  if ticket.status in ('issued','consumed') then
    if ticket.status='consumed' and exists(
      select 1 from storage.objects where bucket_id=ticket.bucket_id and name=ticket.object_path
    ) then raise exception 'A stored object must be removed before its consumed upload reservation can be released.'; end if;
    update public.nxq_storage_upload_tickets set status='cancelled' where id=ticket.id;
    update public.nxq_client_resource_reservations set status='released',released_at=now(),updated_at=now()
    where client_id=ticket.client_id and resource_key='storage_bytes'
      and idempotency_key=ticket.resource_idempotency_key and status in ('reserved','consumed');
  end if;
  return jsonb_build_object('ok',true,'cancelled',true);
end; $$;

create or replace function public.nxq_storage_upload_ticket_valid(target_bucket_id text,target_object_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.nxq_storage_upload_tickets t join public.clients c on c.id=t.client_id
    where t.bucket_id=target_bucket_id and t.object_path=target_object_path and t.status='issued'
      and t.expires_at>now() and c.auth_user_id=auth.uid());
$$;

revoke all on function public.nxq_authorize_storage_upload(text,text,bigint,text),
  public.nxq_complete_storage_upload_ticket(uuid),public.nxq_cancel_storage_upload_ticket(uuid),
  public.nxq_storage_upload_ticket_valid(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.nxq_authorize_storage_upload(text,text,bigint,text),
  public.nxq_complete_storage_upload_ticket(uuid),public.nxq_cancel_storage_upload_ticket(uuid) to authenticated;
grant execute on function public.nxq_storage_upload_ticket_valid(text,text) to authenticated;

drop policy if exists "commerce product images client insert" on storage.objects;
drop policy if exists "commerce product images client update" on storage.objects;
drop policy if exists client_upload_own_commerce_product_media_objects on storage.objects;
drop policy if exists client_update_own_commerce_product_media_objects on storage.objects;
drop policy if exists "commerce website content client image insert" on storage.objects;
drop policy if exists "commerce website content client image update" on storage.objects;
drop policy if exists nxq_ticketed_client_file_insert on storage.objects;
drop policy if exists nxq_ticketed_paid_storage_insert on storage.objects;
drop policy if exists nxq_ticketed_paid_storage_update on storage.objects;
create policy nxq_ticketed_paid_storage_insert on storage.objects for insert to authenticated
with check(public.nxq_storage_upload_ticket_valid(bucket_id,name));
create policy nxq_ticketed_paid_storage_update on storage.objects for update to authenticated
using(public.nxq_storage_upload_ticket_valid(bucket_id,name))
with check(public.nxq_storage_upload_ticket_valid(bucket_id,name));

comment on function public.nxq_authorize_paid_capability(uuid,text,jsonb,integer,text,jsonb) is
  'Atomic fail-closed authorization for exact tier entitlement, billing state, resource allowance, usage credits, and margin before paid execution.';
comment on table public.nxq_storage_upload_tickets is
  'Short-lived exact-path tickets issued only after monthly storage capacity is atomically reserved.';
