-- Migration 033 may be skipped on projects where version 033 already exists in remote history.
-- Reapply the catalog repair under a new version and harden the plan-change RPC.

update public.product_families
set public_status = case
      when slug = 'business' then 'available'
      when slug = 'enterprise-systems' then 'private'
      else 'planned'
    end,
    is_active = true,
    updated_at = now()
where slug in (
  'business',
  'booking',
  'commerce',
  'menu',
  'property',
  'multi-location',
  'membership',
  'enterprise-systems'
);

update public.product_family_tiers tier
set public_status = case
      when family.slug = 'business' then 'available'
      when family.slug = 'enterprise-systems' then 'private'
      else 'planned'
    end,
    is_active = true,
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
      (slug = 'business' and public_status in ('available', 'beta'))
      or (slug <> 'business' and public_status in ('available', 'beta'))
    )
  limit 1;

  if target_family.id is null then
    raise exception 'Requested product family is not available for signup or plan changes yet.';
  end if;

  select * into target_tier
  from public.product_family_tiers
  where product_family_id = target_family.id
    and tier_key = requested_tier_key
    and is_active = true
    and public_status in ('available', 'beta')
  limit 1;

  if target_tier.id is null then
    raise exception 'Requested tier is unavailable.';
  end if;

  if current_client.product_family_id = target_family.id
     and current_client.product_tier_id = target_tier.id then
    raise exception 'That is already the current plan.';
  end if;

  summary_text := format(
    'Client requested a plan change to %s %s. New monthly price: %s. One-time website change fee must be confirmed by the owner before approval.',
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
    'Open Review plan changes to set pricing, fees, and approve or deny atomically.',
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

revoke all on function public.request_client_plan_change(text, text, text) from public, anon;
grant execute on function public.request_client_plan_change(text, text, text) to authenticated;

do $$
declare
  business_family_id uuid;
  available_tier_count integer;
begin
  select id into business_family_id
  from public.product_families
  where slug = 'business'
    and public_status = 'available'
    and is_active = true;

  if business_family_id is null then
    raise exception 'NXQ Business catalog repair failed.';
  end if;

  select count(*) into available_tier_count
  from public.product_family_tiers
  where product_family_id = business_family_id
    and tier_key in ('starter', 'growth', 'intelligence', 'enterprise')
    and public_status = 'available'
    and is_active = true;

  if available_tier_count <> 4 then
    raise exception 'NXQ Business must have exactly four available tiers; found %.', available_tier_count;
  end if;
end;
$$;
