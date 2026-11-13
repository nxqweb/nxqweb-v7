-- DRAFT (not a real migration; needs the owner's approval to promote and apply).
-- Fixes a known bug from the handoff list: a product whose stock is NOT tracked showed "Sold out" on the
-- public store page, although the order function accepts it (create_public_direct_payment_order only checks
-- stock when track_inventory is true). The listing reported such a product's variants with the "deny" policy
-- and 0 available, so the page disabled the button.
-- Change: one line. For a product with track_inventory = false the listing now reports the variant policy as
-- 'continue' (the value the page already treats as "can always be ordered"). Tracked products are unchanged.
-- No front-end change is needed. Function text otherwise identical to the definition in force (migration 107);
-- create or replace keeps the existing grants.

create or replace function public.get_public_commerce_storefront(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'name', s.store_name,
      'slug', s.store_slug,
      'currency', s.currency_code,
      'paypal_url', nullif(s.settings->>'paypal_url', ''),
      'venmo_url', nullif(s.settings->>'venmo_url', ''),
      'payment_note', s.public_payment_note
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'slug', p.slug,
        'short_description', p.short_description,
        'description', p.description,
        'base_price', p.base_price,
        'compare_at_price', p.compare_at_price,
        'image_url', p.image_urls->>0,
        'image_urls', coalesce(p.image_urls, '[]'::jsonb),
        'attributes', '[]'::jsonb,
        'requires_shipping', p.requires_shipping,
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', v.id,
            'title', v.title,
            'price', v.price,
            'available_quantity', greatest(v.inventory_quantity - v.reserved_quantity, 0),
            'inventory_policy', case when p.track_inventory then v.inventory_policy else 'continue' end
          ) order by v.is_default desc, v.created_at)
          from public.commerce_product_variants v
          where v.product_id = p.id and v.is_active = true
        ), '[]'::jsonb)
      ) order by p.featured desc, p.updated_at desc)
      from public.commerce_products p
      where p.storefront_id = s.id and p.status = 'active'
    ), '[]'::jsonb)
  )
  from public.commerce_storefronts s
  where s.store_slug = store_slug_value and s.status = 'active'
$function$;
