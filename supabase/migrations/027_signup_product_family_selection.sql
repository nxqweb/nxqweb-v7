-- Persist the selected NXQ product family and tier when a client signs up.
-- Reads product_family_slug and product_tier_key from auth user metadata,
-- validates them against the active catalog, and falls back to NXQ Business Starter.

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

  -- Ignore auth users that were not created through the client signup flow.
  if signup_business_name is null then
    return new;
  end if;

  select family.id
  into selected_family_id
  from public.product_families family
  where family.slug = signup_family_slug
    and family.is_active = true
    and family.public_status <> 'private'
  limit 1;

  if selected_family_id is null then
    select family.id
    into selected_family_id
    from public.product_families family
    where family.slug = 'business'
    limit 1;
  end if;

  select tier.id
  into selected_tier_id
  from public.product_family_tiers tier
  where tier.product_family_id = selected_family_id
    and tier.tier_key = signup_tier_key
    and tier.is_active = true
  limit 1;

  if selected_tier_id is null then
    select tier.id
    into selected_tier_id
    from public.product_family_tiers tier
    where tier.product_family_id = selected_family_id
      and tier.tier_key = 'starter'
    limit 1;
  end if;

  insert into public.clients (
    business_name,
    contact_name,
    contact_email,
    auth_user_id,
    product_family_id,
    product_tier_id
  )
  values (
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

comment on function public.handle_new_client_signup() is
  'Creates a client workspace from signup metadata and persists the selected NXQ product family and tier.';
