-- Client-owned Commerce orders foundation.
-- Routine order management does not require NXQ owner approval.

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  order_number text not null,
  customer_name text not null,
  customer_email text,
  currency text not null default 'USD',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  payment_status text not null default 'test_pending'
    check (payment_status in ('test_pending','pending','paid','failed','refunded','partially_refunded')),
  fulfillment_status text not null default 'new'
    check (fulfillment_status in ('new','processing','ready_for_pickup','shipped','delivered','cancelled','refunded')),
  tracking_number text,
  fulfillment_note text,
  is_test boolean not null default false,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, order_number)
);

create table if not exists public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  product_id uuid references public.commerce_products(id) on delete set null,
  variant_id uuid references public.commerce_product_variants(id) on delete set null,
  product_name text not null,
  variant_title text,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.commerce_order_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists commerce_orders_storefront_idx
  on public.commerce_orders(storefront_id, placed_at desc);
create index if not exists commerce_order_items_order_idx
  on public.commerce_order_items(order_id);
create index if not exists commerce_order_events_order_idx
  on public.commerce_order_events(order_id, created_at desc);

alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.commerce_order_events enable row level security;

revoke all on table public.commerce_orders from public, anon;
revoke all on table public.commerce_order_items from public, anon;
revoke all on table public.commerce_order_events from public, anon;
grant select on table public.commerce_orders to authenticated;
grant select on table public.commerce_order_items to authenticated;
grant select on table public.commerce_order_events to authenticated;

drop policy if exists client_view_own_commerce_orders on public.commerce_orders;
create policy client_view_own_commerce_orders on public.commerce_orders
for select to authenticated using (client_id = public.current_client_id());

drop policy if exists owner_view_commerce_orders on public.commerce_orders;
create policy owner_view_commerce_orders on public.commerce_orders
for select to authenticated using (public.is_nxq_owner());

drop policy if exists client_view_own_commerce_order_items on public.commerce_order_items;
create policy client_view_own_commerce_order_items on public.commerce_order_items
for select to authenticated using (client_id = public.current_client_id());

drop policy if exists owner_view_commerce_order_items on public.commerce_order_items;
create policy owner_view_commerce_order_items on public.commerce_order_items
for select to authenticated using (public.is_nxq_owner());

drop policy if exists client_view_own_commerce_order_events on public.commerce_order_events;
create policy client_view_own_commerce_order_events on public.commerce_order_events
for select to authenticated using (client_id = public.current_client_id());

drop policy if exists owner_view_commerce_order_events on public.commerce_order_events;
create policy owner_view_commerce_order_events on public.commerce_order_events
for select to authenticated using (public.is_nxq_owner());

create or replace function public.get_my_commerce_orders()
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
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid),
      'new_orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid and o.fulfillment_status = 'new'),
      'open_orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid and o.fulfillment_status in ('new','processing','ready_for_pickup','shipped')),
      'completed_orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid and o.fulfillment_status = 'delivered')
    ),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'customer_name', o.customer_name,
        'customer_email', o.customer_email,
        'currency', o.currency,
        'subtotal', o.subtotal,
        'total', o.total,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status,
        'tracking_number', o.tracking_number,
        'fulfillment_note', o.fulfillment_note,
        'is_test', o.is_test,
        'placed_at', o.placed_at,
        'updated_at', o.updated_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'product_name', i.product_name,
          'variant_title', i.variant_title,
          'sku', i.sku,
          'quantity', i.quantity,
          'unit_price', i.unit_price,
          'line_total', i.line_total
        ) order by i.created_at) from public.commerce_order_items i where i.order_id = o.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'event_type', e.event_type,
          'from_status', e.from_status,
          'to_status', e.to_status,
          'note', e.note,
          'created_at', e.created_at
        ) order by e.created_at desc) from public.commerce_order_events e where e.order_id = o.id), '[]'::jsonb)
      ) order by o.placed_at desc)
      from public.commerce_orders o
      where o.storefront_id = storefront_uuid
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_my_commerce_test_order()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  selected_variant public.commerce_product_variants%rowtype;
  selected_product public.commerce_products%rowtype;
  order_uuid uuid;
  generated_number text;
  available_units integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  select v.* into selected_variant
  from public.commerce_product_variants v
  where v.storefront_id = storefront_uuid and v.is_active = true
  order by (v.inventory_quantity - v.reserved_quantity) desc, v.created_at
  limit 1;

  if selected_variant.id is null then raise exception 'Add a product variant before creating a test order.'; end if;
  available_units := selected_variant.inventory_quantity - selected_variant.reserved_quantity;
  if available_units < 1 then raise exception 'A test order needs at least one available unit.'; end if;

  select p.* into selected_product from public.commerce_products p where p.id = selected_variant.product_id;
  generated_number := 'TEST-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS');

  insert into public.commerce_orders (
    client_id, storefront_id, order_number, customer_name, customer_email,
    subtotal, total, payment_status, fulfillment_status, is_test
  ) values (
    client_uuid, storefront_uuid, generated_number, 'Protected Test Customer', 'test@example.com',
    selected_variant.price, selected_variant.price, 'test_pending', 'new', true
  ) returning id into order_uuid;

  insert into public.commerce_order_items (
    client_id, storefront_id, order_id, product_id, variant_id, product_name,
    variant_title, sku, quantity, unit_price, line_total
  ) values (
    client_uuid, storefront_uuid, order_uuid, selected_product.id, selected_variant.id,
    selected_product.name, selected_variant.title, selected_variant.sku, 1,
    selected_variant.price, selected_variant.price
  );

  update public.commerce_product_variants
  set reserved_quantity = reserved_quantity + 1
  where id = selected_variant.id;

  insert into public.commerce_order_events (
    client_id, storefront_id, order_id, event_type, to_status, note
  ) values (
    client_uuid, storefront_uuid, order_uuid, 'order_created', 'new',
    'Protected test order created. No payment was charged and no customer was contacted.'
  );

  return jsonb_build_object('order_id', order_uuid, 'order_number', generated_number);
end;
$$;

create or replace function public.update_my_commerce_order(
  order_uuid uuid,
  next_fulfillment_status text,
  tracking_value text default null,
  fulfillment_note_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  existing_order public.commerce_orders%rowtype;
  item_record record;
  allowed boolean := false;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  select * into existing_order from public.commerce_orders
  where id = order_uuid and storefront_id = storefront_uuid for update;
  if existing_order.id is null then raise exception 'Order not found.'; end if;

  allowed := case existing_order.fulfillment_status
    when 'new' then next_fulfillment_status in ('new','processing','cancelled')
    when 'processing' then next_fulfillment_status in ('processing','ready_for_pickup','shipped','cancelled')
    when 'ready_for_pickup' then next_fulfillment_status in ('ready_for_pickup','delivered','cancelled')
    when 'shipped' then next_fulfillment_status in ('shipped','delivered')
    when 'delivered' then next_fulfillment_status in ('delivered','refunded')
    when 'cancelled' then next_fulfillment_status = 'cancelled'
    when 'refunded' then next_fulfillment_status = 'refunded'
    else false end;
  if not allowed then raise exception 'That order status change is not allowed.'; end if;

  if existing_order.fulfillment_status not in ('cancelled','delivered','refunded')
     and next_fulfillment_status = 'cancelled' then
    for item_record in select * from public.commerce_order_items where order_id = order_uuid loop
      if item_record.variant_id is not null then
        update public.commerce_product_variants
        set reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0)
        where id = item_record.variant_id;
      end if;
    end loop;
  end if;

  if existing_order.fulfillment_status <> 'delivered' and next_fulfillment_status = 'delivered' then
    for item_record in select * from public.commerce_order_items where order_id = order_uuid loop
      if item_record.variant_id is not null then
        update public.commerce_product_variants
        set inventory_quantity = greatest(inventory_quantity - item_record.quantity, 0),
            reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0)
        where id = item_record.variant_id;
      end if;
    end loop;
  end if;

  update public.commerce_orders
  set fulfillment_status = next_fulfillment_status,
      tracking_number = nullif(trim(coalesce(tracking_value, '')), ''),
      fulfillment_note = nullif(trim(coalesce(fulfillment_note_value, '')), ''),
      payment_status = case when next_fulfillment_status = 'refunded' then 'refunded' else payment_status end,
      updated_at = now()
  where id = order_uuid;

  insert into public.commerce_order_events (
    client_id, storefront_id, order_id, event_type, from_status, to_status, note
  ) values (
    client_uuid, storefront_uuid, order_uuid, 'fulfillment_status_changed',
    existing_order.fulfillment_status, next_fulfillment_status,
    nullif(trim(coalesce(fulfillment_note_value, '')), '')
  );

  return jsonb_build_object('order_id', order_uuid, 'status', next_fulfillment_status);
end;
$$;

revoke all on function public.get_my_commerce_orders() from public;
revoke all on function public.create_my_commerce_test_order() from public;
revoke all on function public.update_my_commerce_order(uuid,text,text,text) from public;
grant execute on function public.get_my_commerce_orders() to authenticated;
grant execute on function public.create_my_commerce_test_order() to authenticated;
grant execute on function public.update_my_commerce_order(uuid,text,text,text) to authenticated;
