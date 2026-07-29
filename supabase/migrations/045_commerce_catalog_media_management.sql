-- NXQ Commerce catalog presentation management.
-- Adds client-safe catalog detail loading plus guarded media primary/delete actions.
-- Product publishing remains disabled.

create or replace function public.get_my_commerce_catalog_manager()
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
    'client_id', client_uuid,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'parent_category_id', c.parent_category_id,
        'is_visible', c.is_visible,
        'sort_order', c.sort_order
      ) order by c.sort_order, lower(c.name))
      from public.commerce_categories c
      where c.client_id = client_uuid
        and c.storefront_id = storefront_uuid
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'status', p.status,
        'category_id', p.category_id,
        'category_name', c.name,
        'media', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id,
            'storage_path', m.storage_path,
            'file_name', m.file_name,
            'mime_type', m.mime_type,
            'file_size', m.file_size,
            'alt_text', m.alt_text,
            'sort_order', m.sort_order,
            'is_primary', m.is_primary
          ) order by m.is_primary desc, m.sort_order, m.created_at)
          from public.commerce_product_media m
          where m.product_id = p.id
        ), '[]'::jsonb)
      ) order by lower(p.name))
      from public.commerce_products p
      left join public.commerce_categories c on c.id = p.category_id
      where p.client_id = client_uuid
        and p.storefront_id = storefront_uuid
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_my_commerce_product_media(
  media_uuid uuid,
  new_alt_text text default null,
  new_sort_order integer default null,
  make_primary boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  media_row public.commerce_product_media%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select * into media_row
  from public.commerce_product_media
  where id = media_uuid
    and client_id = client_uuid
  for update;

  if media_row.id is null then
    raise exception 'Product image was not found in this Commerce workspace.';
  end if;

  if make_primary then
    update public.commerce_product_media
    set is_primary = false, updated_at = now()
    where product_id = media_row.product_id
      and client_id = client_uuid;
  end if;

  update public.commerce_product_media
  set alt_text = case when new_alt_text is null then alt_text else nullif(trim(new_alt_text), '') end,
      sort_order = coalesce(new_sort_order, sort_order),
      is_primary = case when make_primary then true else is_primary end,
      updated_at = now()
  where id = media_uuid
  returning * into media_row;

  return jsonb_build_object(
    'id', media_row.id,
    'is_primary', media_row.is_primary,
    'message', 'Product image updated.'
  );
end;
$$;

create or replace function public.delete_my_commerce_product_media(media_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  media_row public.commerce_product_media%rowtype;
  next_primary uuid;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select * into media_row
  from public.commerce_product_media
  where id = media_uuid
    and client_id = client_uuid
  for update;

  if media_row.id is null then
    raise exception 'Product image was not found in this Commerce workspace.';
  end if;

  delete from public.commerce_product_media where id = media_uuid;

  if media_row.is_primary then
    select id into next_primary
    from public.commerce_product_media
    where product_id = media_row.product_id
      and client_id = client_uuid
    order by sort_order, created_at
    limit 1;

    if next_primary is not null then
      update public.commerce_product_media
      set is_primary = true, updated_at = now()
      where id = next_primary;
    end if;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'storage_path', media_row.storage_path,
    'message', 'Product image record deleted.'
  );
end;
$$;

revoke all on function public.get_my_commerce_catalog_manager() from public, anon;
revoke all on function public.update_my_commerce_product_media(uuid, text, integer, boolean) from public, anon;
revoke all on function public.delete_my_commerce_product_media(uuid) from public, anon;

grant execute on function public.get_my_commerce_catalog_manager() to authenticated;
grant execute on function public.update_my_commerce_product_media(uuid, text, integer, boolean) to authenticated;
grant execute on function public.delete_my_commerce_product_media(uuid) to authenticated;
