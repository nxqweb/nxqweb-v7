-- Enable NXQ Commerce for owner-reviewed plan changes without opening public signup.
-- Commerce remains publicly planned; only the guarded existing-client plan-change flow may target it.

alter table public.product_families
  add column if not exists plan_change_enabled boolean not null default false;

alter table public.product_family_tiers
  add column if not exists plan_change_enabled boolean not null default false;

update public.product_families
set plan_change_enabled = case
      when slug in ('business', 'commerce') then true
      else false
    end,
    updated_at = now();

update public.product_family_tiers tier
set plan_change_enabled = case
      when family.slug in ('business', 'commerce') then true
      else false
    end,
    updated_at = now()
from public.product_families family
where family.id = tier.product_family_id;

create or replace function public.request_client_plan_change(
  requested_family_slug text,
  requested_tier_key text,
  client_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_client public.clients%rowtype;
  target_family public.product_families%rowtype;
  target_tier public.product_family_tiers%rowtype;
  new_request_id uuid;
  approval_id uuid;
  summary_text text;
begin
  select * into current_client
  from public.clients
  where auth_user_id = auth.uid()
  limit 1;

  if current_client.id is null then
    raise exception 'Client workspace not found.';
  end if;

  if exists (
    select 1 from public.client_plan_change_requests
    where client_id = current_client.id
      and status = 'pending_owner_review'
  ) then
    raise exception 'A plan change request is already awaiting owner review.';
  end if;

  select * into target_family
  from public.product_families
  where slug = requested_family_slug
    and is_active = true
    and (
      public_status in ('available', 'beta')
      or plan_change_enabled = true
    )
  limit 1;

  if target_family.id is null then
    raise exception 'Requested product family is not available for plan changes yet.';
  end if;

  select * into target_tier
  from public.product_family_tiers
  where product_family_id = target_family.id
    and tier_key = requested_tier_key
    and is_active = true
    and (
      public_status in ('available', 'beta')
      or plan_change_enabled = true
    )
  limit 1;

  if target_tier.id is null then
    raise exception 'Requested tier is unavailable for plan changes.';
  end if;

  if current_client.product_family_id = target_family.id
     and current_client.product_tier_id = target_tier.id then
    raise exception 'That is already the current plan.';
  end if;

  summary_text := format(
    'Client requested a guarded plan change to %s %s. New monthly price: %s. One-time website change or migration fee must be confirmed by the owner before approval.',
    target_family.name,
    target_tier.name,
    coalesce(target_tier.price_label, 'Custom')
  );

  insert into public.owner_approval_requests (
    client_id,
    request_type,
    title,
    summary,
    recommended_action,
    risk_level,
    options
  ) values (
    current_client.id,
    'client_plan_change',
    'Client plan change request',
    summary_text,
    'Open Review plan changes to confirm pricing, migration scope, fees, and approve or deny atomically.',
    case when current_client.product_family_id is distinct from target_family.id
      then 'high'::public.risk_level
      else 'medium'::public.risk_level
    end,
    '["review_plan_change"]'::jsonb
  ) returning id into approval_id;

  insert into public.client_plan_change_requests (
    client_id,
    current_product_family_id,
    current_product_tier_id,
    requested_product_family_id,
    requested_product_tier_id,
    requested_monthly_price,
    client_note,
    owner_approval_request_id
  ) values (
    current_client.id,
    current_client.product_family_id,
    current_client.product_tier_id,
    target_family.id,
    target_tier.id,
    target_tier.monthly_price,
    nullif(trim(client_note), ''),
    approval_id
  ) returning id into new_request_id;

  return new_request_id;
end;
$$;

create or replace function public.resolve_client_plan_change(
  target_approval_id uuid,
  decision_status text,
  owner_response_text text,
  one_time_fee numeric default null,
  approved_monthly_price numeric default null
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
  final_monthly_price numeric;
begin
  select exists (
    select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()
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
    raise exception 'The requested family or tier no longer exists.';
  end if;

  if clean_decision = 'accepted' then
    if family_row.is_active is distinct from true
       or not (family_row.public_status in ('available', 'beta') or family_row.plan_change_enabled = true) then
      raise exception 'This product family is not currently enabled for approval.';
    end if;

    if tier_row.is_active is distinct from true
       or not (tier_row.public_status in ('available', 'beta') or tier_row.plan_change_enabled = true) then
      raise exception 'This product tier is not currently enabled for approval.';
    end if;

    if tier_row.tier_key = 'enterprise' then
      if approved_monthly_price is null or approved_monthly_price <= 0 then
        raise exception 'Enterprise approval requires a positive monthly price.';
      end if;
      final_monthly_price := approved_monthly_price;
    else
      if tier_row.monthly_price is null then
        raise exception 'The selected tier does not have an active monthly price.';
      end if;
      final_monthly_price := tier_row.monthly_price;
    end if;

    update public.clients
    set product_family_id = request_row.requested_product_family_id,
        product_tier_id = request_row.requested_product_tier_id,
        monthly_price = final_monthly_price,
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

    insert into public.activity_logs (client_id, actor_type, action, details)
    values (
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
        'owner_note', clean_note,
        'guarded_plan_change', true
      )
    );

    return jsonb_build_object(
      'status', 'completed',
      'monthly_price', final_monthly_price,
      'message', format(
        'Plan changed to %s %s. Monthly price is now $%s/month.',
        family_row.name,
        tier_row.name,
        trim(to_char(final_monthly_price, 'FM999999990.00'))
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

  insert into public.activity_logs (client_id, actor_type, action, details)
  values (
    request_row.client_id,
    'owner',
    'client_plan_change_denied',
    jsonb_build_object(
      'approval_id', approval_row.id,
      'plan_change_request_id', request_row.id,
      'one_time_fee', one_time_fee,
      'owner_note', clean_note
    )
  );

  return jsonb_build_object(
    'status', 'denied',
    'message', 'Plan-change request denied. The current client plan was not changed.'
  );
end;
$$;

revoke all on function public.request_client_plan_change(text, text, text) from public, anon;
grant execute on function public.request_client_plan_change(text, text, text) to authenticated;

revoke all on function public.resolve_client_plan_change(uuid, text, text, numeric, numeric)
  from public, anon;
grant execute on function public.resolve_client_plan_change(uuid, text, text, numeric, numeric)
  to authenticated;

comment on column public.product_families.plan_change_enabled is
  'Allows guarded owner-reviewed changes into a family without making that family publicly selectable.';

comment on column public.product_family_tiers.plan_change_enabled is
  'Allows guarded owner-reviewed changes into a tier without making that tier publicly selectable.';