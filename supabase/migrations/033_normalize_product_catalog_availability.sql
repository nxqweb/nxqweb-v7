-- Repair catalog availability after partial or repeated product-family foundation runs.
-- Migration 026 intentionally inserted Business as available, but its conflict update
-- did not overwrite public_status on a pre-existing row.

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

-- Fail loudly if the only currently sellable family is still not configured correctly.
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

comment on table public.product_families is
  'NXQ product-family catalog. Only available or beta families may be selected publicly.';
