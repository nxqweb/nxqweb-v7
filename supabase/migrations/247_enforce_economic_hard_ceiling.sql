-- Keep purchased usage credits subordinate to the subscription's minimum-margin ceiling.
-- Credits may fund eligible overage, but cannot authorize economically unsafe execution.

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
  prior_overage:=greatest(spent_this_month-included_budget,0);
  new_overage:=greatest(projected-included_budget,0);
  paid_needed:=greatest(new_overage-prior_overage,0);
  if projected>hard_ceiling then
    return jsonb_build_object(
      'ok',false,
      'allowed',false,
      'reason','minimum_margin_ceiling_exceeded',
      'included_budget_cents',included_budget,
      'hard_subscription_cost_ceiling_cents',hard_ceiling,
      'projected_provider_cost_cents',projected
    );
  end if;
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

revoke all on function public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)
  to service_role;

comment on function public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb) is
  'Atomically rejects provider cost above the subscription minimum-margin ceiling before usage-credit spend or reservation creation.';
