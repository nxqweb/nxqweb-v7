-- Repair Orders RPCs to use the Commerce schema established in migration 036.
-- Forward-only: preserves all existing Commerce records.

alter table public.commerce_orders
  add column if not exists fulfillment_stage text not null default 'new'
    check (fulfillment_stage in ('new','processing','ready_for_pickup','shipped','delivered','cancelled','refunded')),
  add column if not exists tracking_number text,
  add column if not exists fulfillment_note text,
  add column if not exists is_test boolean not null default false;

update public.commerce_orders
set placed_at = coalesce(placed_at, created_at)
where placed_at is null;

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

create index if not exists commerce_order_events_order_idx
  on public.commerce_order_events(order_id, created_at desc);

alter table public.commerce_order_events enable row level security;
revoke all on table public.commerce_order_events from public, anon;
grant select on table public.commerce_order_events to authenticated;

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
      'new_orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid and o.fulfillment_stage = 'new'),
      'open_orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid and o.fulfillment_stage in ('new','processing','ready_for_pickup','shipped')),
      'completed_orders', (select count(*) from public.commerce_orders o where o.storefront_id = storefront_uuid and o.fulfillment_stage = 'delivered')
    ),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'customer_name', coalesce(o.customer_name, 'Customer'),
        'customer_email', o.customer_email,
        'currency', o.currency_code,
        'subtotal', o.subtotal,
        'total', o.grand_total,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_stage,
        'tracking_number', o.tracking_number,
        'fulfillment_note', o.fulfillment_note,
        'is_test', o.is_test,
        'placed_at', coalesce(o.placed_at, o.created_at),
        'updated_at', o.updated_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'product_name', i.product_name,
          'variant_title', i.variant_name,
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
      ) order by coalesce(o.placed_at, o.created_at) desc)
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
    client_id, storefront_id, order_number, status, payment_status, fulfillment_status,
    fulfillment_stage, currency_code, subtotal, grand_total, customer_name, customer_email,
    placed_at, is_test, metadata
  ) values (
    client_uuid, storefront_uuid, generated_number, 'pending', 'pending', 'unfulfilled',
    'new', coalesce(selected_product.currency_code, 'USD'), selected_variant.price,
    selected_variant.price, 'Protected Test Customer', 'test@example.com', now(), true,
    jsonb_build_object('protected_test', true, 'no_payment_charged', true)
  ) returning id into order_uuid;

  insert into public.commerce_order_items (
    client_id, storefront_id, order_id, product_id, variant_id, product_name,
    variant_name, sku, quantity, unit_price, line_total, product_snapshot
  ) values (
    client_uuid, storefront_uuid, order_uuid, selected_product.id, selected_variant.id,
    selected_product.name, selected_variant.title, selected_variant.sku, 1,
    selected_variant.price, selected_variant.price,
    jsonb_build_object('product_name', selected_product.name, 'variant_name', selected_variant.title)
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
  base_fulfillment_status text;
  base_order_status text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  select * into existing_order from public.commerce_orders
  where id = order_uuid and storefront_id = storefront_uuid for update;
  if existing_order.id is null then raise exception 'Order not found.'; end if;

  allowed := case existing_order.fulfillment_stage
    when 'new' then next_fulfillment_status in ('new','processing','cancelled')
    when 'processing' then next_fulfillment_status in ('processing','ready_for_pickup','shipped','cancelled')
    when 'ready_for_pickup' then next_fulfillment_status in ('ready_for_pickup','delivered','cancelled')
    when 'shipped' then next_fulfillment_status in ('shipped','delivered')
    when 'delivered' then next_fulfillment_status in ('delivered','refunded')
    when 'cancelled' then next_fulfillment_status = 'cancelled'
    when 'refunded' then next_fulfillment_status = 'refunded'
    else false end;
  if not allowed then raise exception 'That order status change is not allowed.'; end if;

  if existing_order.fulfillment_stage not in ('cancelled','delivered','refunded')
     and next_fulfillment_status = 'cancelled' then
    for item_record in select * from public.commerce_order_items where order_id = order_uuid loop
      if item_record.variant_id is not null then
        update public.commerce_product_variants
        set reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0)
        where id = item_record.variant_id;
      end if;
    end loop;
  end if;

  if existing_order.fulfillment_stage <> 'delivered' and next_fulfillment_status = 'delivered' then
    for item_record in select * from public.commerce_order_items where order_id = order_uuid loop
      if item_record.variant_id is not null then
        update public.commerce_product_variants
        set inventory_quantity = greatest(inventory_quantity - item_record.quantity, 0),
            reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0)
        where id = item_record.variant_id;
      end if;
    end loop;
  end if;

  base_fulfillment_status := case
    when next_fulfillment_status in ('delivered','refunded') then 'fulfilled'
    when next_fulfillment_status = 'cancelled' then 'cancelled'
    else 'unfulfilled'
  end;
  base_order_status := case
    when next_fulfillment_status = 'processing' then 'processing'
    when next_fulfillment_status in ('ready_for_pickup','shipped') then 'confirmed'
    when next_fulfillment_status = 'delivered' then 'completed'
    when next_fulfillment_status = 'cancelled' then 'cancelled'
    when next_fulfillment_status = 'refunded' then 'refunded'
    else existing_order.status
  end;

  update public.commerce_orders
  set fulfillment_stage = next_fulfillment_status,
      fulfillment_status = base_fulfillment_status,
      status = base_order_status,
      tracking_number = nullif(trim(coalesce(tracking_value, '')), ''),
      fulfillment_note = nullif(trim(coalesce(fulfillment_note_value, '')), ''),
      payment_status = case when next_fulfillment_status = 'refunded' then 'refunded' else payment_status end,
      fulfilled_at = case when next_fulfillment_status = 'delivered' then coalesce(fulfilled_at, now()) else fulfilled_at end,
      cancelled_at = case when next_fulfillment_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      updated_at = now()
  where id = order_uuid;

  insert into public.commerce_order_events (
    client_id, storefront_id, order_id, event_type, from_status, to_status, note
  ) values (
    client_uuid, storefront_uuid, order_uuid, 'fulfillment_status_changed',
    existing_order.fulfillment_stage, next_fulfillment_status,
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
