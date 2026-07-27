-- Prevent unsafe generic plan-change decisions and keep unfinished product families non-sellable.

-- Public/client selection is limited to families and tiers explicitly marked available or beta.
create or replace function public.handle_new_client_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_business_name text;
  signup_contact_name text;
  signup_family_slug text;
  signup_tier_key text;
  selected_family_id uuid;
  selected_tier_id uuid;
begin
  signup_business_name := nullif(trim(new.raw_user_meta_data ->> 'business_name'), '');
  signup_contact_name := nullif(trim(new.raw_user_meta_data ->> 'contact_name'), '');
  signup_family_slug := coalesce(nullif(trim(new.raw_user_meta_data ->> 'product_family_slug'), ''), 'business');
  signup_tier_key := coalesce(nullif(trim(new.raw_user_meta_data ->> 'product_tier_key'), ''), 'starter');

  if signup_business_name is null then
    return new;
  end if;

  select family.id into selected_family_id
  from public.product_families family
  where family.slug = signup_family_slug
    and family.is_active = true
    and family.public_status in ('available', 'beta')
  limit 1;

  if selected_family_id is null then
    select family.id into selected_family_id
    from public.product_families family
    where family.slug = 'business'
      and family.is_active = true
      and family.public_status in ('available', 'beta')
    limit 1;
  end if;

  if selected_family_id is null then
    raise exception 'No publicly available NXQ product family is configured.';
  end if;

  select tier.id into selected_tier_id
  from public.product_family_tiers tier
  where tier.product_family_id = selected_family_id
    and tier.tier_key = signup_tier_key
    and tier.is_active = true
    and tier.public_status in ('available', 'beta')
  limit 1;

  if selected_tier_id is null then
    select tier.id into selected_tier_id
    from public.product_family_tiers tier
    where tier.product_family_id = selected_family_id
      and tier.tier_key = 'starter'
      and tier.is_active = true
      and tier.public_status in ('available', 'beta')
    limit 1;
  end if;

  if selected_tier_id is null then
    raise exception 'No publicly available tier is configured for this product family.';
  end if;

  insert into public.clients (
    business_name,
    contact_name,
    contact_email,
    auth_user_id,
    product_family_id,
    product_tier_id
  ) values (
    signup_business_name,
    signup_contact_name,
    new.email,
    new.id,
    selected_family_id,
    selected_tier_id
  )
  on conflict (auth_user_id) where auth_user_id is not null
  do nothing;

  return new;
end;
$$;

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
    and public_status in ('available', 'beta')
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
    case when current_client.product_family_id is distinct from target_family.id then 'high'::public.risk_level else 'medium'::public.risk_level end,
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

-- Generic direct updates may not resolve client plan-change approvals.
-- The dedicated SECURITY DEFINER resolver runs as the migration owner and remains allowed.
create or replace function public.guard_client_plan_change_approval_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.request_type = 'client_plan_change'
     and new.status is distinct from old.status
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Client plan changes must be resolved through resolve_client_plan_change.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_client_plan_change_approval_update
  on public.owner_approval_requests;
create trigger guard_client_plan_change_approval_update
before update of status on public.owner_approval_requests
for each row execute function public.guard_client_plan_change_approval_update();

comment on function public.guard_client_plan_change_approval_update() is
  'Prevents generic approval updates from bypassing the atomic client plan-change resolver.';
