-- Restore the signup contract without changing the approval boundary.
-- A new account remains a lead until the client submits intake; the submitted
-- intake creates the one website_setup_review decision that starts automation.

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
  selected_family public.product_families%rowtype;
  selected_tier public.product_family_tiers%rowtype;
begin
  signup_business_name := nullif(trim(new.raw_user_meta_data ->> 'business_name'), '');
  signup_contact_name := nullif(trim(new.raw_user_meta_data ->> 'contact_name'), '');
  signup_family_slug := coalesce(nullif(trim(new.raw_user_meta_data ->> 'product_family_slug'), ''), 'business');
  signup_tier_key := coalesce(nullif(trim(new.raw_user_meta_data ->> 'product_tier_key'), ''), 'starter');

  -- Supabase dashboard users and owner accounts do not become clients.
  if signup_business_name is null then
    return new;
  end if;

  select * into selected_family
  from public.product_families family
  where family.slug = signup_family_slug
    and family.is_active = true
    and family.public_status in ('available', 'beta')
  limit 1;

  if selected_family.id is null then
    select * into selected_family
    from public.product_families family
    where family.slug = 'business'
      and family.is_active = true
      and family.public_status in ('available', 'beta')
    limit 1;
  end if;

  if selected_family.id is null then
    raise exception 'No publicly available NXQ product family is configured.';
  end if;

  select * into selected_tier
  from public.product_family_tiers tier
  where tier.product_family_id = selected_family.id
    and tier.tier_key = signup_tier_key
    and tier.is_active = true
    and tier.public_status in ('available', 'beta')
  limit 1;

  if selected_tier.id is null then
    select * into selected_tier
    from public.product_family_tiers tier
    where tier.product_family_id = selected_family.id
      and tier.tier_key = 'starter'
      and tier.is_active = true
      and tier.public_status in ('available', 'beta')
    limit 1;
  end if;

  if selected_tier.id is null then
    raise exception 'No publicly available tier is configured for this product family.';
  end if;

  insert into public.clients (
    business_name,
    contact_name,
    contact_email,
    auth_user_id,
    product_family_id,
    product_tier_id,
    monthly_price
  ) values (
    signup_business_name,
    signup_contact_name,
    new.email,
    new.id,
    selected_family.id,
    selected_tier.id,
    coalesce(selected_tier.monthly_price, 0)
  )
  on conflict (auth_user_id) where auth_user_id is not null
  do nothing;

  return new;
end;
$$;

-- Repair only pre-approval lead accounts created through the signup form. This
-- fixes the staging QA account's missing Growth price without rewriting any
-- approved client's negotiated plan or historical billing state.
with signup_selection as (
  select
    client.id as client_id,
    family.id as family_id,
    tier.id as tier_id,
    tier.monthly_price
  from public.clients client
  join auth.users auth_user on auth_user.id = client.auth_user_id
  join public.product_families family
    on family.slug = coalesce(
      nullif(trim(auth_user.raw_user_meta_data ->> 'product_family_slug'), ''),
      'business'
    )
   and family.is_active = true
   and family.public_status in ('available', 'beta')
  join public.product_family_tiers tier
    on tier.product_family_id = family.id
   and tier.tier_key = coalesce(
      nullif(trim(auth_user.raw_user_meta_data ->> 'product_tier_key'), ''),
      'starter'
    )
   and tier.is_active = true
   and tier.public_status in ('available', 'beta')
  where client.status::text = 'lead'
    and nullif(trim(auth_user.raw_user_meta_data ->> 'business_name'), '') is not null
)
update public.clients client
set
  product_family_id = signup_selection.family_id,
  product_tier_id = signup_selection.tier_id,
  monthly_price = coalesce(signup_selection.monthly_price, client.monthly_price),
  updated_at = now()
from signup_selection
where client.id = signup_selection.client_id
  and (
    client.product_family_id is distinct from signup_selection.family_id
    or client.product_tier_id is distinct from signup_selection.tier_id
    or client.monthly_price is distinct from coalesce(signup_selection.monthly_price, client.monthly_price)
  );

comment on function public.handle_new_client_signup() is
  'Creates a lead from signup metadata and captures its selected public family, tier, and monthly price. Intake submission remains the approval-creation boundary.';
