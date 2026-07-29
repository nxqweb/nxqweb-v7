-- Repair owner Commerce readiness review inventory calculations.
-- Commerce variants use inventory_quantity as the on-hand source of truth.

create or replace function public.get_owner_commerce_reviews()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'client_id', c.id,
        'business_name', c.business_name,
        'contact_email', c.contact_email,
        'monthly_price', c.monthly_price,
        'intake', to_jsonb(i),
        'storefront_status', s.status,
        'product_count', (
          select count(*)
          from public.commerce_products p
          where p.client_id = c.id
        ),
        'missing_image_count', (
          select count(*)
          from public.commerce_products p
          where p.client_id = c.id
            and not exists (
              select 1
              from public.commerce_product_media m
              where m.product_id = p.id
            )
        ),
        'missing_category_count', (
          select count(*)
          from public.commerce_products p
          where p.client_id = c.id
            and p.category_id is null
        ),
        'low_stock_count', (
          select count(*)
          from public.commerce_product_variants v
          where v.client_id = c.id
            and v.is_active = true
            and greatest(v.inventory_quantity - v.reserved_quantity, 0) <= v.low_stock_threshold
        ),
        'out_of_stock_count', (
          select count(*)
          from public.commerce_product_variants v
          where v.client_id = c.id
            and v.is_active = true
            and greatest(v.inventory_quantity - v.reserved_quantity, 0) <= 0
        )
      )
      order by coalesce(i.submitted_at, i.updated_at) desc nulls last
    )
    from public.clients c
    join public.product_families f
      on f.id = c.product_family_id
     and f.slug = 'commerce'
    left join public.commerce_intakes i
      on i.client_id = c.id
    left join public.commerce_storefronts s
      on s.client_id = c.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_owner_commerce_reviews() from public, anon;
grant execute on function public.get_owner_commerce_reviews() to authenticated;

comment on function public.get_owner_commerce_reviews() is
  'Owner-only Commerce readiness summary using inventory_quantity for active variant stock calculations.';
