-- Restore all saved Commerce product fields to the client catalog RPC.
-- The save RPC already persists these columns; the catalog RPC previously omitted them,
-- causing the edit form to appear blank and risk overwriting saved values.

create or replace function public.get_my_commerce_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  storefront_uuid := public.ensure_my_commerce_storefront();

  return jsonb_build_object(
    'storefront', (
      select jsonb_build_object(
        'id', s.id,
        'store_name', s.store_name,
        'status', s.status,
        'inventory_tracking_enabled', s.inventory_tracking_enabled
      )
      from public.commerce_storefronts s
      where s.id = storefront_uuid
    ),
    'summary', jsonb_build_object(
      'products', (select count(*) from public.commerce_products p where p.storefront_id = storefront_uuid),
      'draft_products', (select count(*) from public.commerce_products p where p.storefront_id = storefront_uuid and p.status = 'draft'),
      'low_stock_variants', (
        select count(*)
        from public.commerce_product_variants v
        where v.storefront_id = storefront_uuid
          and v.is_active = true
          and (v.inventory_quantity - v.reserved_quantity) <= v.low_stock_threshold
      ),
      'out_of_stock_variants', (
        select count(*)
        from public.commerce_product_variants v
        where v.storefront_id = storefront_uuid
          and v.is_active = true
          and (v.inventory_quantity - v.reserved_quantity) <= 0
      )
    ),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'slug', p.slug,
          'status', p.status,
          'short_description', p.short_description,
          'description', p.description,
          'product_type', p.product_type,
          'base_price', p.base_price,
          'compare_at_price', p.compare_at_price,
          'sku', p.sku,
          'track_inventory', p.track_inventory,
          'requires_shipping', p.requires_shipping,
          'taxable', p.taxable,
          'featured', p.featured,
          'seo_title', p.seo_title,
          'seo_description', p.seo_description,
          'updated_at', p.updated_at,
          'attributes', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', a.id,
              'key', a.attribute_key,
              'label', a.attribute_label,
              'value', a.attribute_value,
              'sort_order', a.sort_order
            ) order by a.sort_order, a.created_at)
            from public.commerce_product_attributes a
            where a.product_id = p.id
          ), '[]'::jsonb),
          'variants', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', v.id,
              'title', v.title,
              'sku', v.sku,
              'price', v.price,
              'inventory_quantity', v.inventory_quantity,
              'reserved_quantity', v.reserved_quantity,
              'incoming_quantity', v.incoming_quantity,
              'available_quantity', greatest(v.inventory_quantity - v.reserved_quantity, 0),
              'low_stock_threshold', v.low_stock_threshold,
              'reorder_point', v.reorder_point,
              'inventory_location', v.inventory_location,
              'inventory_policy', v.inventory_policy,
              'is_default', v.is_default,
              'is_active', v.is_active
            ) order by v.created_at)
            from public.commerce_product_variants v
            where v.product_id = p.id
          ), '[]'::jsonb)
        ) order by p.updated_at desc
      )
      from public.commerce_products p
      where p.storefront_id = storefront_uuid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_commerce_catalog() from public, anon;
grant execute on function public.get_my_commerce_catalog() to authenticated;
