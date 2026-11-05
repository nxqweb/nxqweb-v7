-- Harden client-managed fulfillment transitions for live direct-payment orders.
-- Prevents unpaid direct-payment fulfillment and surfaces inventory conflicts instead of silently hiding oversells.

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
  variant_record public.commerce_product_variants%rowtype;
  allowed boolean := false;
  base_fulfillment_status text;
  base_order_status text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  storefront_uuid := public.ensure_my_commerce_storefront();

  select * into existing_order
  from public.commerce_orders
  where id = order_uuid and storefront_id = storefront_uuid
  for update;

  if existing_order.id is null then
    raise exception 'Order not found.';
  end if;

  allowed := case existing_order.fulfillment_stage
    when 'new' then next_fulfillment_status in ('new','processing','cancelled')
    when 'processing' then next_fulfillment_status in ('processing','ready_for_pickup','shipped','cancelled')
    when 'ready_for_pickup' then next_fulfillment_status in ('ready_for_pickup','delivered','cancelled')
    when 'shipped' then next_fulfillment_status in ('shipped','delivered')
    when 'delivered' then next_fulfillment_status in ('delivered','refunded')
    when 'cancelled' then next_fulfillment_status = 'cancelled'
    when 'refunded' then next_fulfillment_status = 'refunded'
    else false
  end;

  if not allowed then
    raise exception 'That order status change is not allowed.';
  end if;

  if existing_order.is_test is distinct from true
     and existing_order.payment_provider = 'direct_link_manual_confirmation'
     and existing_order.payment_status <> 'paid'
     and next_fulfillment_status not in ('new', 'cancelled') then
    raise exception 'Confirm the direct payment before processing or fulfilling this order.';
  end if;

  if existing_order.fulfillment_stage not in ('cancelled','delivered','refunded')
     and next_fulfillment_status = 'cancelled'
     and existing_order.reservation_released_at is null then
    for item_record in
      select * from public.commerce_order_items where order_id = order_uuid
    loop
      if item_record.variant_id is not null then
        select * into variant_record
        from public.commerce_product_variants
        where id = item_record.variant_id and client_id = client_uuid
        for update;

        if variant_record.id is not null then
          update public.commerce_product_variants
          set reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0),
              updated_at = now()
          where id = variant_record.id;

          if variant_record.reserved_quantity > 0 then
            insert into public.commerce_inventory_movements (
              client_id, storefront_id, product_id, variant_id, movement_type,
              quantity_delta, quantity_after, reference_type, reference_id, note, actor_user_id
            ) values (
              client_uuid, storefront_uuid, item_record.product_id, variant_record.id,
              'release', item_record.quantity,
              variant_record.inventory_quantity - greatest(variant_record.reserved_quantity - item_record.quantity, 0),
              'commerce_order', order_uuid,
              'Order cancelled; reserved inventory released.', auth.uid()
            );
          end if;
        end if;
      end if;
    end loop;
  end if;

  if existing_order.fulfillment_stage <> 'delivered'
     and next_fulfillment_status = 'delivered' then
    for item_record in
      select * from public.commerce_order_items where order_id = order_uuid
    loop
      if item_record.variant_id is not null then
        select * into variant_record
        from public.commerce_product_variants
        where id = item_record.variant_id and client_id = client_uuid
        for update;

        if variant_record.id is not null then
          if variant_record.inventory_policy = 'deny'
             and variant_record.inventory_quantity < item_record.quantity then
            raise exception 'Inventory conflict for order %. Restore stock or resolve the order before marking it delivered.', existing_order.order_number;
          end if;

          update public.commerce_product_variants
          set inventory_quantity = inventory_quantity - item_record.quantity,
              reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0),
              updated_at = now()
          where id = variant_record.id;

          insert into public.commerce_inventory_movements (
            client_id, storefront_id, product_id, variant_id, movement_type,
            quantity_delta, quantity_after, reference_type, reference_id, note, actor_user_id
          ) values (
            client_uuid, storefront_uuid, item_record.product_id, variant_record.id,
            'sale', -item_record.quantity,
            variant_record.inventory_quantity - item_record.quantity,
            'commerce_order', order_uuid,
            'Inventory reduced when the order was marked delivered.', auth.uid()
          );
        end if;
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
      reservation_released_at = case
        when next_fulfillment_status in ('cancelled','delivered') then coalesce(reservation_released_at, now())
        else reservation_released_at
      end,
      reservation_expires_at = case
        when next_fulfillment_status in ('cancelled','delivered') then null
        else reservation_expires_at
      end,
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

revoke all on function public.update_my_commerce_order(uuid,text,text,text) from public;
grant execute on function public.update_my_commerce_order(uuid,text,text,text) to authenticated;
