-- Keep standard NXQ monthly pricing synchronized across every product family.
-- Starter, Growth, and Intelligence use the shared monthly service prices.
-- Enterprise remains custom-priced and is not assigned an automatic monthly amount.

update public.product_family_tiers
set monthly_price = case tier_key
      when 'starter' then 50::numeric
      when 'growth' then 100::numeric
      when 'intelligence' then 150::numeric
      when 'enterprise' then null::numeric
    end,
    price_label = case tier_key
      when 'starter' then '$50/mo'
      when 'growth' then '$100/mo'
      when 'intelligence' then '$150/mo'
      when 'enterprise' then 'Custom'
    end,
    updated_at = now()
where tier_key in ('starter', 'growth', 'intelligence', 'enterprise');

-- Repair clients whose selected standard tier already changed while the tier catalog
-- still had null placeholder pricing. Enterprise/custom pricing is intentionally left alone.
update public.clients
set monthly_price = tier.monthly_price,
    updated_at = now()
from public.product_family_tiers tier
where clients.product_tier_id = tier.id
  and tier.monthly_price is not null
  and clients.monthly_price is distinct from tier.monthly_price;

-- Keep unresolved request previews aligned with the authoritative tier catalog.
update public.client_plan_change_requests request
set requested_monthly_price = tier.monthly_price
from public.product_family_tiers tier
where request.requested_product_tier_id = tier.id
  and request.status = 'pending_owner_review'
  and request.requested_monthly_price is distinct from tier.monthly_price;

create or replace function public.resolve_client_plan_change(
  target_approval_id uuid,
  decision_status text,
  owner_response_text text,
  one_time_fee numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_is_authorized boolean;
  approval_row public.owner_approval_requests%rowtype;
  request_row public.client_plan_change_requests%rowtype;
  family_row public.product_families%rowtype;
  tier_row public.product_family_tiers%rowtype;
  clean_note text;
  clean_decision text;
  final_monthly_price numeric(10,2);
begin
  select exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  ) into owner_is_authorized;

  if not owner_is_authorized then
    raise exception 'Owner access is required.';
  end if;

  clean_decision := lower(trim(coalesce(decision_status, '')));
  clean_note := trim(coalesce(owner_response_text, ''));

  if clean_decision not in ('accepted', 'denied') then
    raise exception 'Decision must be accepted or denied.';
  end if;

  if clean_note = '' then
    raise exception 'An owner note is required.';
  end if;

  if one_time_fee is not null and one_time_fee < 0 then
    raise exception 'One-time fee cannot be negative.';
  end if;

  select * into approval_row
  from public.owner_approval_requests
  where id = target_approval_id
  for update;

  if approval_row.id is null then
    raise exception 'Approval request was not found.';
  end if;

  if approval_row.request_type <> 'client_plan_change' then
    raise exception 'This approval is not a client plan-change request.';
  end if;

  if approval_row.status <> 'pending' then
    raise exception 'This approval has already been resolved.';
  end if;

  select * into request_row
  from public.client_plan_change_requests
  where owner_approval_request_id = approval_row.id
  for update;

  if request_row.id is null then
    raise exception 'The linked plan-change request was not found.';
  end if;

  if request_row.status <> 'pending_owner_review' then
    raise exception 'This plan-change request is no longer pending owner review.';
  end if;

  select * into family_row
  from public.product_families
  where id = request_row.requested_product_family_id;

  select * into tier_row
  from public.product_family_tiers
  where id = request_row.requested_product_tier_id
    and product_family_id = request_row.requested_product_family_id;

  if family_row.id is null or tier_row.id is null then
    raise exception 'The requested family or tier is no longer available.';
  end if;

  final_monthly_price := tier_row.monthly_price;

  if clean_decision = 'accepted' then
    update public.clients
    set product_family_id = request_row.requested_product_family_id,
        product_tier_id = request_row.requested_product_tier_id,
        monthly_price = case
          when final_monthly_price is not null then final_monthly_price
          else monthly_price
        end,
        updated_at = now()
    where id = request_row.client_id;

    update public.projects
    set product_family_id = request_row.requested_product_family_id,
        product_tier_id = request_row.requested_product_tier_id,
        updated_at = now()
    where client_id = request_row.client_id;

    update public.client_plan_change_requests
    set status = 'completed',
        requested_monthly_price = final_monthly_price,
        one_time_change_fee = one_time_fee,
        owner_note = clean_note,
        resolved_at = now()
    where id = request_row.id;

    update public.owner_approval_requests
    set status = 'accepted',
        owner_response = clean_note,
        resolved_at = now()
    where id = approval_row.id;

    insert into public.activity_logs (
      client_id,
      actor_type,
      action,
      details
    ) values (
      request_row.client_id,
      'owner',
      'client_plan_change_approved',
      jsonb_build_object(
        'approval_id', approval_row.id,
        'plan_change_request_id', request_row.id,
        'product_family', family_row.slug,
        'tier', tier_row.tier_key,
        'monthly_price', final_monthly_price,
        'one_time_fee', one_time_fee,
        'owner_note', clean_note
      )
    );

    return jsonb_build_object(
      'status', 'completed',
      'monthly_price', final_monthly_price,
      'message', format(
        'Plan changed to %s %s. Monthly price is now %s.',
        family_row.name,
        tier_row.name,
        coalesce(tier_row.price_label, 'Custom')
      )
    );
  end if;

  update public.client_plan_change_requests
  set status = 'denied',
      one_time_change_fee = one_time_fee,
      owner_note = clean_note,
      resolved_at = now()
  where id = request_row.id;

  update public.owner_approval_requests
  set status = 'denied',
      owner_response = clean_note,
      resolved_at = now()
  where id = approval_row.id;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  ) values (
    request_row.client_id,
    'owner',
    'client_plan_change_denied',
    jsonb_build_object(
      'approval_id', approval_row.id,
      'plan_change_request_id', request_row.id,
      'owner_note', clean_note
    )
  );

  return jsonb_build_object(
    'status', 'denied',
    'message', 'Plan-change request denied. The current client plan was not changed.'
  );
end;
$$;

revoke all on function public.resolve_client_plan_change(uuid, text, text, numeric) from public, anon;
grant execute on function public.resolve_client_plan_change(uuid, text, text, numeric) to authenticated;

comment on function public.resolve_client_plan_change(uuid, text, text, numeric) is
  'Owner-only atomic resolver for client plan changes. Standard monthly pricing is always derived from the authoritative selected tier.';
