-- Guarded client-only storefront preview data.

create or replace function public.get_my_commerce_storefront_preview()
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
        'status', s.status
      )
      from public.commerce_storefronts s
      where s.id = storefront_uuid
    ),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'short_description', p.short_description,
          'base_price', p.base_price,
          'compare_at_price', p.compare_at_price,
          'featured', p.featured,
          'category_name', c.name,
          'available_quantity', coalesce((
            select sum(greatest(v.inventory_quantity - v.reserved_quantity, 0))
            from public.commerce_product_variants v
            where v.product_id = p.id and v.is_active = true
          ), 0),
          'primary_image_path', (
            select m.storage_path
            from public.commerce_product_media m
            where m.product_id = p.id
            order by m.is_primary desc, m.sort_order asc, m.created_at asc
            limit 1
          ),
          'primary_image_alt', (
            select m.alt_text
            from public.commerce_product_media m
            where m.product_id = p.id
            order by m.is_primary desc, m.sort_order asc, m.created_at asc
            limit 1
          )
        ) order by p.featured desc, p.updated_at desc
      )
      from public.commerce_products p
      left join public.commerce_categories c on c.id = p.category_id
      where p.storefront_id = storefront_uuid
        and p.status = 'draft'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_commerce_storefront_preview() from public, anon;
grant execute on function public.get_my_commerce_storefront_preview() to authenticated;
