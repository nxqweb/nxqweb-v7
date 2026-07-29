-- Forward-only repair for protected checkout availability.
-- Public checkout must display sellable units, not raw on-hand inventory.

create or replace function public.get_public_protected_commerce_checkout(store_slug_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_storefront public.commerce_storefronts%rowtype;
  products_payload jsonb;
begin
  select *
  into target_storefront
  from public.commerce_storefronts
  where store_slug = lower(trim(store_slug_input))
    and status <> 'disabled'
  limit 1;

  if target_storefront.id is null then
    raise exception 'Storefront not found';
  end if;

  select coalesce(jsonb_agg(product_row order by (product_row ->> 'name')), '[]'::jsonb)
  into products_payload
  from (
    select jsonb_build_object(
      'id', product.id,
      'name', product.name,
      'short_description', product.short_description,
      'base_price', product.base_price,
      'currency', product.currency_code,
      'category_name', category.name,
      'requires_shipping', product.requires_shipping,
      'track_inventory', product.track_inventory,
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', variant.id,
          'title', variant.title,
          'sku', variant.sku,
          'price', case when variant.price > 0 then variant.price else product.base_price end,
          'available_quantity', case
            when product.track_inventory then greatest(variant.inventory_quantity - variant.reserved_quantity, 0)
            else greatest(variant.inventory_quantity, 0)
          end,
          'inventory_policy', variant.inventory_policy,
          'is_default', variant.is_default
        ) order by variant.is_default desc, variant.title)
        from public.commerce_product_variants variant
        where variant.product_id = product.id
          and variant.storefront_id = target_storefront.id
          and variant.is_active = true
      ), '[]'::jsonb)
    ) as product_row
    from public.commerce_products product
    left join public.commerce_categories category on category.id = product.category_id
    where product.storefront_id = target_storefront.id
      and product.status <> 'archived'
  ) products;

  return jsonb_build_object(
    'storefront', jsonb_build_object(
      'id', target_storefront.id,
      'store_name', target_storefront.store_name,
      'store_slug', target_storefront.store_slug,
      'currency', target_storefront.currency_code,
      'locale', target_storefront.locale,
      'payment_mode', target_storefront.payment_mode,
      'guest_checkout_enabled', target_storefront.guest_checkout_enabled
    ),
    'products', products_payload,
    'checkout_mode', 'protected_test'
  );
end;
$$;

revoke all on function public.get_public_protected_commerce_checkout(text) from public;
grant execute on function public.get_public_protected_commerce_checkout(text) to anon, authenticated;

comment on function public.get_public_protected_commerce_checkout(text) is
  'Returns protected test checkout products with available inventory calculated as on-hand minus reserved units.';
