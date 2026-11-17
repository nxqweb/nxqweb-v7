-- Draft 09: "the money arrived late" (added 2026-11-17). ADDITIVE ONLY: one new function. Nothing existing is changed.
--
-- Today an unpaid direct-payment order is cancelled automatically two hours after it is placed (migration 115: the items go back on
-- sale). The shopper may well have paid in time; the shop owner just did not press "Confirm payment received" within those two hours
-- (asleep, at work, at a market). After that the normal confirm function refuses the order for good, so the owner is holding the
-- customer's money for an order the system calls cancelled.
--
-- This function lets the shop owner confirm such an order afterwards, safely:
--   * only the order's own shop, only a direct-payment order, never a practice order;
--   * only an order the SYSTEM cancelled for running out of time (never one the owner cancelled by hand), placed in the last 30 days;
--   * the items are taken from stock again first; if something has sold out in the meantime the whole thing is refused, nothing is
--     changed, and the owner is told which item (refund the customer or restock);
--   * the order then becomes a normal paid order waiting to be sent, with both steps written into its history.
-- The two-hour hold itself is NOT changed here; how long to hold stock is a separate owner decision.

create or replace function public.confirm_my_late_direct_payment(order_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  order_row public.commerce_orders%rowtype;
  item_record record;
  variant_row public.commerce_product_variants%rowtype;
  product_row public.commerce_products%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  select * into order_row
  from public.commerce_orders
  where id = order_uuid and client_id = client_uuid
  for update;

  if order_row.id is null then raise exception 'Order was not found.'; end if;
  if order_row.payment_provider <> 'direct_link_manual_confirmation' or order_row.is_test then
    raise exception 'This order is not a direct-payment order.';
  end if;
  if order_row.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'order_number', order_row.order_number);
  end if;
  if order_row.reservation_released_at is null and order_row.fulfillment_stage <> 'cancelled' then
    raise exception 'This order is still being held. Use Confirm payment received.';
  end if;
  if order_row.fulfillment_stage <> 'cancelled'
     or not exists (select 1 from public.commerce_order_events e where e.order_id = order_row.id and e.event_type = 'reservation_expired')
     or exists (select 1 from public.commerce_order_events e where e.order_id = order_row.id and e.event_type = 'fulfillment_status_changed' and e.to_status = 'cancelled') then
    raise exception 'Only an order that was cancelled automatically for running out of time can be confirmed late.';
  end if;
  if coalesce(order_row.placed_at, order_row.created_at) < now() - interval '30 days' then
    raise exception 'This order is too old to confirm late. Contact the customer instead.';
  end if;

  -- Take the items from stock again. Every line is checked and locked before anything is written; one sold-out item refuses it all.
  for item_record in
    select * from public.commerce_order_items where order_id = order_row.id order by variant_id
  loop
    if item_record.variant_id is null then
      raise exception '% is no longer in your store. Refund the customer or add it again first.', item_record.product_name;
    end if;
    select * into variant_row from public.commerce_product_variants
    where id = item_record.variant_id and storefront_id = order_row.storefront_id
    for update;
    if variant_row.id is null then
      raise exception '% is no longer in your store. Refund the customer or add it again first.', item_record.product_name;
    end if;
    select * into product_row from public.commerce_products where id = variant_row.product_id and storefront_id = order_row.storefront_id;
    if product_row.id is not null and product_row.track_inventory and variant_row.inventory_policy = 'deny'
       and variant_row.inventory_quantity - variant_row.reserved_quantity < item_record.quantity then
      raise exception '% has sold out since this order was cancelled. Refund the customer or add stock first.', item_record.product_name;
    end if;
  end loop;

  for item_record in
    select * from public.commerce_order_items where order_id = order_row.id order by variant_id
  loop
    select * into variant_row from public.commerce_product_variants where id = item_record.variant_id for update;
    select * into product_row from public.commerce_products where id = variant_row.product_id;
    if product_row.id is not null and product_row.track_inventory then
      update public.commerce_product_variants
      set reserved_quantity = reserved_quantity + item_record.quantity, updated_at = now()
      where id = variant_row.id;
      insert into public.commerce_inventory_movements (
        client_id, storefront_id, product_id, variant_id, movement_type,
        quantity_delta, quantity_after, reference_type, reference_id, note
      ) values (
        order_row.client_id, order_row.storefront_id, variant_row.product_id, variant_row.id,
        'reservation', -item_record.quantity,
        variant_row.inventory_quantity - variant_row.reserved_quantity - item_record.quantity,
        'commerce_order', order_row.id,
        'Inventory reserved again: the client confirmed a payment that arrived after the hold ended.'
      );
    end if;
  end loop;

  update public.commerce_orders
  set payment_status = 'paid',
      status = 'confirmed',
      paid_at = now(),
      fulfillment_stage = 'new',
      fulfillment_status = 'unfulfilled',
      cancelled_at = null,
      reservation_released_at = null,
      reservation_expires_at = null,
      fulfillment_note = case when fulfillment_note = 'Reservation expired before payment confirmation.' then null else fulfillment_note end,
      updated_at = now()
  where id = order_row.id;

  insert into public.commerce_order_events (client_id, storefront_id, order_id, event_type, from_status, to_status, note)
  values
    (client_uuid, order_row.storefront_id, order_row.id, 'reservation_reopened', 'cancelled', 'new',
     'The client reopened this automatically cancelled order. Inventory was reserved again.'),
    (client_uuid, order_row.storefront_id, order_row.id, 'payment_confirmed', order_row.payment_status, 'paid',
     'Direct payment confirmed by the client after the hold had ended.');

  return jsonb_build_object('ok', true, 'late', true, 'order_number', order_row.order_number);
end;
$$;

revoke all on function public.confirm_my_late_direct_payment(uuid) from public, anon;
grant execute on function public.confirm_my_late_direct_payment(uuid) to authenticated;
