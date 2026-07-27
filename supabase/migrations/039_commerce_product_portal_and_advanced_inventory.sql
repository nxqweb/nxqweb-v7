-- Commerce product portal and advanced inventory controls.
-- Client writes are validated through RPCs and remain draft-only.

alter table public.commerce_product_variants
  add column if not exists reserved_quantity integer not null default 0
    check (reserved_quantity >= 0),
  add column if not exists incoming_quantity integer not null default 0
    check (incoming_quantity >= 0),
  add column if not exists low_stock_threshold integer not null default 5
    check (low_stock_threshold >= 0),
  add column if not exists reorder_point integer not null default 5
    check (reorder_point >= 0),
  add column if not exists inventory_location text;

create table if not exists public.commerce_product_attributes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  attribute_key text not null,
  attribute_label text not null,
  attribute_value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, attribute_key),
  check (attribute_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  check (length(trim(attribute_label)) > 0),
  check (length(trim(attribute_value)) > 0)
);

create index if not exists commerce_product_attributes_product_idx
  on public.commerce_product_attributes(product_id, sort_order);

alter table public.commerce_product_attributes enable row level security;
revoke all on table public.commerce_product_attributes from public, anon;
grant select, insert, update, delete on table public.commerce_product_attributes to authenticated;

drop policy if exists owner_manage_commerce_product_attributes
  on public.commerce_product_attributes;
create policy owner_manage_commerce_product_attributes
on public.commerce_product_attributes
for all to authenticated
using (public.is_nxq_owner())
with check (public.is_nxq_owner());

drop policy if exists client_view_own_commerce_product_attributes
  on public.commerce_product_attributes;
create policy client_view_own_commerce_product_attributes
on public.commerce_product_attributes
for select to authenticated
using (client_id = public.current_client_id());

create or replace function public.ensure_my_commerce_storefront()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  existing_storefront uuid;
  client_name text;
  clean_slug text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select id into existing_storefront
  from public.commerce_storefronts
  where client_id = client_uuid;

  if existing_storefront is not null then
    return existing_storefront;
  end if;

  select business_name into client_name
  from public.clients
  where id = client_uuid;

  clean_slug := lower(regexp_replace(coalesce(client_name, 'nxq-store'), '[^a-zA-Z0-9]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  if clean_slug = '' then
    clean_slug := 'nxq-store';
  end if;
  clean_slug := left(clean_slug, 42) || '-' || left(replace(client_uuid::text, '-', ''), 8);

  insert into public.commerce_storefronts (
    client_id,
    store_name,
    store_slug,
    status,
    payment_mode
  ) values (
    client_uuid,
    coalesce(nullif(trim(client_name), ''), 'NXQ Commerce Store'),
    clean_slug,
    'setup_pending',
    'not_connected'
  )
  returning id into existing_storefront;

  return existing_storefront;
end;
$$;

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
          'product_type', p.product_type,
          'base_price', p.base_price,
          'sku', p.sku,
          'featured', p.featured,
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

create or replace function public.save_my_commerce_product(product_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  product_uuid uuid;
  saved_product public.commerce_products%rowtype;
  product_name text;
  product_slug text;
  product_price numeric;
  attribute_item jsonb;
  variant_item jsonb;
  attribute_position integer := 0;
  variant_position integer := 0;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  if product_payload is null or jsonb_typeof(product_payload) <> 'object' then
    raise exception 'Product payload must be an object.';
  end if;

  storefront_uuid := public.ensure_my_commerce_storefront();
  product_name := nullif(trim(coalesce(product_payload->>'name', '')), '');
  if product_name is null then
    raise exception 'Product name is required.';
  end if;

  product_slug := lower(regexp_replace(product_name, '[^a-zA-Z0-9]+', '-', 'g'));
  product_slug := trim(both '-' from product_slug);
  if product_slug = '' then
    raise exception 'Product name must include letters or numbers.';
  end if;

  begin
    product_price := coalesce(nullif(product_payload->>'base_price', '')::numeric, 0);
  exception when invalid_text_representation then
    raise exception 'Product price must be a valid number.';
  end;
  if product_price < 0 then
    raise exception 'Product price cannot be negative.';
  end if;

  if nullif(product_payload->>'id', '') is not null then
    product_uuid := (product_payload->>'id')::uuid;
    select * into saved_product
    from public.commerce_products
    where id = product_uuid
      and client_id = client_uuid
      and storefront_id = storefront_uuid
    for update;

    if saved_product.id is null then
      raise exception 'Product was not found in this client workspace.';
    end if;

    update public.commerce_products
    set name = product_name,
        slug = product_slug,
        short_description = nullif(trim(coalesce(product_payload->>'short_description','')), ''),
        description = nullif(trim(coalesce(product_payload->>'description','')), ''),
        product_type = coalesce(nullif(product_payload->>'product_type',''), 'physical'),
        status = 'draft',
        base_price = product_price,
        compare_at_price = nullif(product_payload->>'compare_at_price','')::numeric,
        sku = nullif(trim(coalesce(product_payload->>'sku','')), ''),
        track_inventory = coalesce((product_payload->>'track_inventory')::boolean, true),
        requires_shipping = coalesce((product_payload->>'requires_shipping')::boolean, true),
        taxable = coalesce((product_payload->>'taxable')::boolean, true),
        featured = coalesce((product_payload->>'featured')::boolean, false),
        seo_title = nullif(trim(coalesce(product_payload->>'seo_title','')), ''),
        seo_description = nullif(trim(coalesce(product_payload->>'seo_description','')), ''),
        updated_at = now()
    where id = product_uuid
    returning * into saved_product;

    delete from public.commerce_product_attributes where product_id = product_uuid;
    delete from public.commerce_product_variants where product_id = product_uuid;
  else
    product_slug := product_slug || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6);

    insert into public.commerce_products (
      client_id, storefront_id, name, slug, short_description, description,
      product_type, status, base_price, compare_at_price, sku, track_inventory,
      requires_shipping, taxable, featured, seo_title, seo_description
    ) values (
      client_uuid,
      storefront_uuid,
      product_name,
      product_slug,
      nullif(trim(coalesce(product_payload->>'short_description','')), ''),
      nullif(trim(coalesce(product_payload->>'description','')), ''),
      coalesce(nullif(product_payload->>'product_type',''), 'physical'),
      'draft',
      product_price,
      nullif(product_payload->>'compare_at_price','')::numeric,
      nullif(trim(coalesce(product_payload->>'sku','')), ''),
      coalesce((product_payload->>'track_inventory')::boolean, true),
      coalesce((product_payload->>'requires_shipping')::boolean, true),
      coalesce((product_payload->>'taxable')::boolean, true),
      coalesce((product_payload->>'featured')::boolean, false),
      nullif(trim(coalesce(product_payload->>'seo_title','')), ''),
      nullif(trim(coalesce(product_payload->>'seo_description','')), '')
    ) returning * into saved_product;
    product_uuid := saved_product.id;
  end if;

  if jsonb_typeof(coalesce(product_payload->'attributes', '[]'::jsonb)) <> 'array' then
    raise exception 'Product attributes must be an array.';
  end if;

  for attribute_item in select * from jsonb_array_elements(coalesce(product_payload->'attributes', '[]'::jsonb))
  loop
    if nullif(trim(coalesce(attribute_item->>'label','')), '') is not null
       and nullif(trim(coalesce(attribute_item->>'value','')), '') is not null then
      attribute_position := attribute_position + 1;
      insert into public.commerce_product_attributes (
        client_id, storefront_id, product_id, attribute_key,
        attribute_label, attribute_value, sort_order
      ) values (
        client_uuid,
        storefront_uuid,
        product_uuid,
        coalesce(
          nullif(trim(coalesce(attribute_item->>'key','')), ''),
          'detail_' || attribute_position::text
        ),
        trim(attribute_item->>'label'),
        trim(attribute_item->>'value'),
        attribute_position
      );
    end if;
  end loop;

  if jsonb_typeof(coalesce(product_payload->'variants', '[]'::jsonb)) <> 'array' then
    raise exception 'Product variants must be an array.';
  end if;

  for variant_item in select * from jsonb_array_elements(coalesce(product_payload->'variants', '[]'::jsonb))
  loop
    variant_position := variant_position + 1;
    insert into public.commerce_product_variants (
      client_id, storefront_id, product_id, title, sku, option_values,
      price, inventory_quantity, reserved_quantity, incoming_quantity,
      low_stock_threshold, reorder_point, inventory_location,
      inventory_policy, is_default, is_active
    ) values (
      client_uuid,
      storefront_uuid,
      product_uuid,
      coalesce(nullif(trim(variant_item->>'title'), ''), case when variant_position = 1 then 'Default' else 'Variant ' || variant_position end),
      nullif(trim(coalesce(variant_item->>'sku','')), ''),
      coalesce(variant_item->'option_values', '{}'::jsonb),
      coalesce(nullif(variant_item->>'price','')::numeric, product_price),
      greatest(coalesce(nullif(variant_item->>'inventory_quantity','')::integer, 0), 0),
      greatest(coalesce(nullif(variant_item->>'reserved_quantity','')::integer, 0), 0),
      greatest(coalesce(nullif(variant_item->>'incoming_quantity','')::integer, 0), 0),
      greatest(coalesce(nullif(variant_item->>'low_stock_threshold','')::integer, 5), 0),
      greatest(coalesce(nullif(variant_item->>'reorder_point','')::integer, 5), 0),
      nullif(trim(coalesce(variant_item->>'inventory_location','')), ''),
      coalesce(nullif(variant_item->>'inventory_policy',''), 'deny'),
      variant_position = 1,
      true
    );
  end loop;

  if variant_position = 0 then
    insert into public.commerce_product_variants (
      client_id, storefront_id, product_id, title, sku, price,
      inventory_quantity, low_stock_threshold, reorder_point, is_default
    ) values (
      client_uuid,
      storefront_uuid,
      product_uuid,
      'Default',
      saved_product.sku,
      saved_product.base_price,
      0,
      5,
      5,
      true
    );
  end if;

  insert into public.activity_logs (client_id, actor_type, action, details)
  values (
    client_uuid,
    'client',
    'commerce_product_saved',
    jsonb_build_object('product_id', product_uuid, 'product_name', product_name, 'status', 'draft')
  );

  return jsonb_build_object(
    'id', product_uuid,
    'status', 'draft',
    'message', 'Product draft saved.'
  );
end;
$$;

create or replace function public.adjust_my_commerce_inventory(
  target_variant_id uuid,
  quantity_delta integer,
  movement_type text,
  movement_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  variant_row public.commerce_product_variants%rowtype;
  new_quantity integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  if quantity_delta = 0 then
    raise exception 'Inventory adjustment cannot be zero.';
  end if;

  if movement_type not in ('initial','adjustment','return','restock','damage') then
    raise exception 'This inventory movement type is not available for client adjustments.';
  end if;

  select * into variant_row
  from public.commerce_product_variants
  where id = target_variant_id
    and client_id = client_uuid
  for update;

  if variant_row.id is null then
    raise exception 'Inventory variant was not found in this client workspace.';
  end if;

  new_quantity := variant_row.inventory_quantity + quantity_delta;
  if new_quantity < 0 then
    raise exception 'Inventory cannot be reduced below zero.';
  end if;

  update public.commerce_product_variants
  set inventory_quantity = new_quantity,
      updated_at = now()
  where id = variant_row.id;

  insert into public.commerce_inventory_movements (
    client_id, storefront_id, product_id, variant_id, movement_type,
    quantity_delta, quantity_after, note, actor_user_id
  ) values (
    client_uuid,
    variant_row.storefront_id,
    variant_row.product_id,
    variant_row.id,
    movement_type,
    quantity_delta,
    new_quantity,
    nullif(trim(coalesce(movement_note, '')), ''),
    auth.uid()
  );

  return jsonb_build_object(
    'variant_id', variant_row.id,
    'inventory_quantity', new_quantity,
    'available_quantity', greatest(new_quantity - variant_row.reserved_quantity, 0),
    'message', 'Inventory updated.'
  );
end;
$$;

revoke all on function public.ensure_my_commerce_storefront() from public, anon;
revoke all on function public.get_my_commerce_catalog() from public, anon;
revoke all on function public.save_my_commerce_product(jsonb) from public, anon;
revoke all on function public.adjust_my_commerce_inventory(uuid, integer, text, text) from public, anon;

grant execute on function public.ensure_my_commerce_storefront() to authenticated;
grant execute on function public.get_my_commerce_catalog() to authenticated;
grant execute on function public.save_my_commerce_product(jsonb) to authenticated;
grant execute on function public.adjust_my_commerce_inventory(uuid, integer, text, text) to authenticated;

comment on table public.commerce_product_attributes is
  'Flexible per-product facts such as burn time, materials, ingredients, care instructions, scent notes, or specifications.';
