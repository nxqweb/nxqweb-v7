-- NXQ Commerce catalog-management foundation.
-- Adds protected product media, category management, and a unified inventory overview.
-- This migration does not publish products or make product media public.

create table if not exists public.commerce_product_media (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  variant_id uuid references public.commerce_product_variants(id) on delete cascade,
  bucket_id text not null default 'commerce-product-media',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, storage_path)
);

create index if not exists commerce_product_media_product_idx
  on public.commerce_product_media(product_id, sort_order, created_at);

create unique index if not exists commerce_product_media_one_primary_idx
  on public.commerce_product_media(product_id)
  where is_primary = true;

alter table public.commerce_product_media enable row level security;
revoke all on table public.commerce_product_media from public, anon;
grant select, insert, update, delete on table public.commerce_product_media to authenticated;

drop policy if exists owner_manage_commerce_product_media on public.commerce_product_media;
create policy owner_manage_commerce_product_media
on public.commerce_product_media
for all to authenticated
using (public.is_nxq_owner())
with check (public.is_nxq_owner());

drop policy if exists client_view_own_commerce_product_media on public.commerce_product_media;
create policy client_view_own_commerce_product_media
on public.commerce_product_media
for select to authenticated
using (client_id = public.current_client_id());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'commerce-product-media',
  'commerce-product-media',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths are always: <client_id>/<product_id>/<generated-file-name>
drop policy if exists client_read_own_commerce_product_media_objects on storage.objects;
create policy client_read_own_commerce_product_media_objects
on storage.objects
for select to authenticated
using (
  bucket_id = 'commerce-product-media'
  and (storage.foldername(name))[1] = public.current_client_id()::text
);

drop policy if exists client_upload_own_commerce_product_media_objects on storage.objects;
create policy client_upload_own_commerce_product_media_objects
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'commerce-product-media'
  and (storage.foldername(name))[1] = public.current_client_id()::text
);

drop policy if exists client_update_own_commerce_product_media_objects on storage.objects;
create policy client_update_own_commerce_product_media_objects
on storage.objects
for update to authenticated
using (
  bucket_id = 'commerce-product-media'
  and (storage.foldername(name))[1] = public.current_client_id()::text
)
with check (
  bucket_id = 'commerce-product-media'
  and (storage.foldername(name))[1] = public.current_client_id()::text
);

drop policy if exists client_delete_own_commerce_product_media_objects on storage.objects;
create policy client_delete_own_commerce_product_media_objects
on storage.objects
for delete to authenticated
using (
  bucket_id = 'commerce-product-media'
  and (storage.foldername(name))[1] = public.current_client_id()::text
);

create or replace function public.get_my_commerce_categories()
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

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'parent_category_id', c.parent_category_id,
        'name', c.name,
        'slug', c.slug,
        'description', c.description,
        'sort_order', c.sort_order,
        'is_visible', c.is_visible,
        'product_count', (
          select count(*) from public.commerce_products p where p.category_id = c.id
        )
      ) order by c.sort_order, lower(c.name)
    )
    from public.commerce_categories c
    where c.client_id = client_uuid
      and c.storefront_id = storefront_uuid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.save_my_commerce_category(category_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  category_uuid uuid;
  parent_uuid uuid;
  clean_name text;
  clean_slug text;
  saved_row public.commerce_categories%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  if category_payload is null or jsonb_typeof(category_payload) <> 'object' then
    raise exception 'Category payload must be an object.';
  end if;

  storefront_uuid := public.ensure_my_commerce_storefront();
  clean_name := nullif(trim(coalesce(category_payload->>'name','')), '');
  if clean_name is null then
    raise exception 'Category name is required.';
  end if;

  clean_slug := lower(regexp_replace(clean_name, '[^a-zA-Z0-9]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  if clean_slug = '' then
    raise exception 'Category name must include letters or numbers.';
  end if;

  if nullif(category_payload->>'parent_category_id','') is not null then
    parent_uuid := (category_payload->>'parent_category_id')::uuid;
    if not exists (
      select 1 from public.commerce_categories
      where id = parent_uuid and client_id = client_uuid and storefront_id = storefront_uuid
    ) then
      raise exception 'Parent category was not found in this Commerce workspace.';
    end if;
  end if;

  if nullif(category_payload->>'id','') is not null then
    category_uuid := (category_payload->>'id')::uuid;

    if parent_uuid = category_uuid then
      raise exception 'A category cannot be its own parent.';
    end if;

    update public.commerce_categories
    set parent_category_id = parent_uuid,
        name = clean_name,
        slug = clean_slug,
        description = nullif(trim(coalesce(category_payload->>'description','')), ''),
        sort_order = coalesce(nullif(category_payload->>'sort_order','')::integer, 0),
        is_visible = coalesce((category_payload->>'is_visible')::boolean, true),
        updated_at = now()
    where id = category_uuid
      and client_id = client_uuid
      and storefront_id = storefront_uuid
    returning * into saved_row;

    if saved_row.id is null then
      raise exception 'Category was not found in this Commerce workspace.';
    end if;
  else
    insert into public.commerce_categories (
      client_id, storefront_id, parent_category_id, name, slug,
      description, sort_order, is_visible
    ) values (
      client_uuid, storefront_uuid, parent_uuid, clean_name,
      clean_slug || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6),
      nullif(trim(coalesce(category_payload->>'description','')), ''),
      coalesce(nullif(category_payload->>'sort_order','')::integer, 0),
      coalesce((category_payload->>'is_visible')::boolean, true)
    ) returning * into saved_row;
  end if;

  return jsonb_build_object(
    'id', saved_row.id,
    'message', 'Category saved.'
  );
end;
$$;

create or replace function public.delete_my_commerce_category(category_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  assigned_count integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  if not exists (
    select 1 from public.commerce_categories
    where id = category_uuid and client_id = client_uuid and storefront_id = storefront_uuid
  ) then
    raise exception 'Category was not found in this Commerce workspace.';
  end if;

  select count(*) into assigned_count
  from public.commerce_products
  where category_id = category_uuid;

  if assigned_count > 0 then
    raise exception 'Move the assigned products before deleting this category.';
  end if;

  update public.commerce_categories
  set parent_category_id = null, updated_at = now()
  where parent_category_id = category_uuid
    and client_id = client_uuid
    and storefront_id = storefront_uuid;

  delete from public.commerce_categories where id = category_uuid;
  return jsonb_build_object('deleted', true, 'message', 'Category deleted.');
end;
$$;

create or replace function public.assign_my_commerce_product_category(
  product_uuid uuid,
  category_uuid uuid default null
)
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

  if category_uuid is not null and not exists (
    select 1 from public.commerce_categories
    where id = category_uuid and client_id = client_uuid and storefront_id = storefront_uuid
  ) then
    raise exception 'Category was not found in this Commerce workspace.';
  end if;

  update public.commerce_products
  set category_id = category_uuid, updated_at = now()
  where id = product_uuid
    and client_id = client_uuid
    and storefront_id = storefront_uuid;

  if not found then
    raise exception 'Product was not found in this Commerce workspace.';
  end if;

  return jsonb_build_object('updated', true, 'message', 'Product category updated.');
end;
$$;

create or replace function public.register_my_commerce_product_media(media_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  product_uuid uuid;
  variant_uuid uuid;
  media_row public.commerce_product_media%rowtype;
  make_primary boolean;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  product_uuid := nullif(media_payload->>'product_id','')::uuid;
  if product_uuid is null or not exists (
    select 1 from public.commerce_products
    where id = product_uuid and client_id = client_uuid and storefront_id = storefront_uuid
  ) then
    raise exception 'Product was not found in this Commerce workspace.';
  end if;

  if nullif(media_payload->>'variant_id','') is not null then
    variant_uuid := (media_payload->>'variant_id')::uuid;
    if not exists (
      select 1 from public.commerce_product_variants
      where id = variant_uuid and product_id = product_uuid and client_id = client_uuid
    ) then
      raise exception 'Variant was not found for this product.';
    end if;
  end if;

  if nullif(trim(coalesce(media_payload->>'storage_path','')), '') is null then
    raise exception 'Storage path is required.';
  end if;

  if split_part(media_payload->>'storage_path', '/', 1) <> client_uuid::text
     or split_part(media_payload->>'storage_path', '/', 2) <> product_uuid::text then
    raise exception 'Product media path does not match this client and product.';
  end if;

  make_primary := coalesce((media_payload->>'is_primary')::boolean, false);
  if not exists (select 1 from public.commerce_product_media where product_id = product_uuid) then
    make_primary := true;
  end if;

  if make_primary then
    update public.commerce_product_media set is_primary = false, updated_at = now()
    where product_id = product_uuid;
  end if;

  insert into public.commerce_product_media (
    client_id, storefront_id, product_id, variant_id, storage_path,
    file_name, mime_type, file_size, alt_text, sort_order, is_primary
  ) values (
    client_uuid, storefront_uuid, product_uuid, variant_uuid,
    media_payload->>'storage_path',
    coalesce(nullif(trim(media_payload->>'file_name'), ''), 'product-image'),
    nullif(trim(coalesce(media_payload->>'mime_type','')), ''),
    nullif(media_payload->>'file_size','')::bigint,
    nullif(trim(coalesce(media_payload->>'alt_text','')), ''),
    coalesce(nullif(media_payload->>'sort_order','')::integer, 0),
    make_primary
  ) returning * into media_row;

  return jsonb_build_object('id', media_row.id, 'is_primary', media_row.is_primary, 'message', 'Product image registered.');
end;
$$;

create or replace function public.get_my_commerce_inventory()
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
    'summary', jsonb_build_object(
      'variants', (select count(*) from public.commerce_product_variants where storefront_id = storefront_uuid and is_active = true),
      'available_units', (select coalesce(sum(greatest(inventory_quantity - reserved_quantity, 0)), 0) from public.commerce_product_variants where storefront_id = storefront_uuid and is_active = true),
      'low_stock', (select count(*) from public.commerce_product_variants where storefront_id = storefront_uuid and is_active = true and greatest(inventory_quantity - reserved_quantity, 0) <= low_stock_threshold),
      'needs_reorder', (select count(*) from public.commerce_product_variants where storefront_id = storefront_uuid and is_active = true and greatest(inventory_quantity - reserved_quantity, 0) <= reorder_point)
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', p.id,
        'product_name', p.name,
        'variant_id', v.id,
        'variant_title', v.title,
        'sku', v.sku,
        'on_hand', v.inventory_quantity,
        'reserved', v.reserved_quantity,
        'incoming', v.incoming_quantity,
        'available', greatest(v.inventory_quantity - v.reserved_quantity, 0),
        'low_stock_threshold', v.low_stock_threshold,
        'reorder_point', v.reorder_point,
        'inventory_location', v.inventory_location,
        'inventory_policy', v.inventory_policy,
        'is_low_stock', greatest(v.inventory_quantity - v.reserved_quantity, 0) <= v.low_stock_threshold,
        'needs_reorder', greatest(v.inventory_quantity - v.reserved_quantity, 0) <= v.reorder_point
      ) order by lower(p.name), lower(v.title))
      from public.commerce_product_variants v
      join public.commerce_products p on p.id = v.product_id
      where v.storefront_id = storefront_uuid and v.is_active = true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adjust_my_commerce_inventory(
  variant_uuid uuid,
  quantity_delta integer,
  adjustment_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  variant_row public.commerce_product_variants%rowtype;
  next_quantity integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  if quantity_delta = 0 then
    raise exception 'Inventory adjustment must not be zero.';
  end if;

  select * into variant_row
  from public.commerce_product_variants
  where id = variant_uuid
    and client_id = client_uuid
    and storefront_id = storefront_uuid
  for update;

  if variant_row.id is null then
    raise exception 'Inventory variant was not found in this Commerce workspace.';
  end if;

  next_quantity := variant_row.inventory_quantity + quantity_delta;
  if next_quantity < 0 then
    raise exception 'Inventory cannot be adjusted below zero.';
  end if;

  update public.commerce_product_variants
  set inventory_quantity = next_quantity, updated_at = now()
  where id = variant_uuid;

  insert into public.commerce_inventory_movements (
    client_id, storefront_id, product_id, variant_id, movement_type,
    quantity_delta, quantity_after, reference_type, note, actor_user_id
  ) values (
    client_uuid, storefront_uuid, variant_row.product_id, variant_row.id,
    case when quantity_delta > 0 then 'restock' else 'adjustment' end,
    quantity_delta, next_quantity, 'client_portal',
    nullif(trim(coalesce(adjustment_note,'')), ''), auth.uid()
  );

  return jsonb_build_object(
    'variant_id', variant_uuid,
    'inventory_quantity', next_quantity,
    'available_quantity', greatest(next_quantity - variant_row.reserved_quantity, 0),
    'message', 'Inventory adjusted.'
  );
end;
$$;

revoke all on function public.get_my_commerce_categories() from public, anon;
revoke all on function public.save_my_commerce_category(jsonb) from public, anon;
revoke all on function public.delete_my_commerce_category(uuid) from public, anon;
revoke all on function public.assign_my_commerce_product_category(uuid, uuid) from public, anon;
revoke all on function public.register_my_commerce_product_media(jsonb) from public, anon;
revoke all on function public.get_my_commerce_inventory() from public, anon;
revoke all on function public.adjust_my_commerce_inventory(uuid, integer, text) from public, anon;

grant execute on function public.get_my_commerce_categories() to authenticated;
grant execute on function public.save_my_commerce_category(jsonb) to authenticated;
grant execute on function public.delete_my_commerce_category(uuid) to authenticated;
grant execute on function public.assign_my_commerce_product_category(uuid, uuid) to authenticated;
grant execute on function public.register_my_commerce_product_media(jsonb) to authenticated;
grant execute on function public.get_my_commerce_inventory() to authenticated;
grant execute on function public.adjust_my_commerce_inventory(uuid, integer, text) to authenticated;

comment on table public.commerce_product_media is
  'Private client-isolated product images. Media remains unpublished until the storefront publishing workflow is approved.';
