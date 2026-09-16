-- Harden live direct-payment orders.
-- Prices remain server-authoritative, inventory is reserved atomically when an order is created,
-- physical stock is not reduced until fulfillment, and abandoned unpaid reservations expire.
-- Adds basic per-email and per-store abuse limits for the anonymous public order RPC.

create or replace function public.guard_public_direct_payment_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_email_count integer;
  recent_store_count integer;
begin
  if coalesce(new.metadata ->> 'checkout_source', '') <> 'public_direct_payment' then
    return new;
  end if;

  if new.is_test is true or new.payment_provider <> 'direct_link_manual_confirmation' then
    raise exception 'Direct-payment checkout configuration is invalid.';
  end if;

  select count(*) into recent_email_count
  from public.commerce_orders o
  where o.storefront_id = new.storefront_id
    and lower(coalesce(o.customer_email, '')) = lower(coalesce(new.customer_email, ''))
    and coalesce(o.metadata ->> 'checkout_source', '') = 'public_direct_payment'
    and o.created_at >= now() - interval '1 hour';

  if recent_email_count >= 5 then
    raise exception 'Too many recent order attempts for this email. Please wait before trying again.';
  end if;

  select count(*) into recent_store_count
  from public.commerce_orders o
  where o.storefront_id = new.storefront_id
    and coalesce(o.metadata ->> 'checkout_source', '') = 'public_direct_payment'
    and o.created_at >= now() - interval '10 minutes';

  if recent_store_count >= 40 then
    raise exception 'This store is receiving too many order attempts right now. Please try again shortly.';
  end if;

  new.reservation_expires_at := coalesce(new.reservation_expires_at, now() + interval '2 hours');
  return new;
end;
$$;

drop trigger if exists guard_public_direct_payment_order_trigger on public.commerce_orders;
create trigger guard_public_direct_payment_order_trigger
before insert on public.commerce_orders
for each row execute function public.guard_public_direct_payment_order();

create or replace function public.create_public_direct_payment_order(
  store_slug_value text,
  items_payload jsonb,
  customer_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  storefront_row public.commerce_storefronts%rowtype;
  order_uuid uuid;
  item jsonb;
  variant_row public.commerce_product_variants%rowtype;
  product_row public.commerce_products%rowtype;
  variant_uuid uuid;
  qty integer;
  available_qty integer;
  unit_amount numeric(12,2);
  subtotal_amount numeric(12,2) := 0;
  line_amount numeric(12,2);
  order_code text;
  customer_name_value text;
  customer_email_value text;
  customer_phone_value text;
  customer_note_value text;
  shipping_address_value jsonb;
  item_count integer;
begin
  if store_slug_value is null or length(trim(store_slug_value)) < 1 or length(trim(store_slug_value)) > 120 then
    raise exception 'Storefront is not available.';
  end if;

  if customer_payload is null or jsonb_typeof(customer_payload) <> 'object' then
    raise exception 'Customer details are invalid.';
  end if;

  if items_payload is null or jsonb_typeof(items_payload) <> 'array' then
    raise exception 'Your cart is invalid.';
  end if;

  item_count := jsonb_array_length(items_payload);
  if item_count < 1 or item_count > 25 then
    raise exception 'Your cart must contain between 1 and 25 different items.';
  end if;

  if (
    select count(*) from jsonb_array_elements(items_payload)
  ) <> (
    select count(distinct value ->> 'variant_id') from jsonb_array_elements(items_payload)
  ) then
    raise exception 'Combine duplicate product options into one cart line before placing the order.';
  end if;

  customer_name_value := nullif(trim(coalesce(customer_payload->>'name', '')), '');
  customer_email_value := nullif(lower(trim(coalesce(customer_payload->>'email', ''))), '');
  customer_phone_value := nullif(trim(coalesce(customer_payload->>'phone', '')), '');
  customer_note_value := nullif(trim(coalesce(customer_payload->>'note', '')), '');
  shipping_address_value := coalesce(customer_payload->'shipping_address', '{}'::jsonb);

  if customer_name_value is null or length(customer_name_value) > 160 then
    raise exception 'Customer name is required and must be 160 characters or fewer.';
  end if;
  if customer_email_value is null
     or length(customer_email_value) > 320
     or customer_email_value !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid customer email is required.';
  end if;
  if customer_phone_value is not null and length(customer_phone_value) > 80 then
    raise exception 'Customer phone must be 80 characters or fewer.';
  end if;
  if customer_note_value is not null and length(customer_note_value) > 2000 then
    raise exception 'Order note must be 2000 characters or fewer.';
  end if;
  if jsonb_typeof(shipping_address_value) <> 'object' or length(shipping_address_value::text) > 5000 then
    raise exception 'Shipping address is invalid or too large.';
  end if;

  select * into storefront_row
  from public.commerce_storefronts
  where store_slug = trim(store_slug_value)
    and status = 'active'
  limit 1;

  if storefront_row.id is null then
    raise exception 'Storefront is not available.';
  end if;

  if nullif(storefront_row.settings->>'paypal_url', '') is null
     and nullif(storefront_row.settings->>'venmo_url', '') is null then
    raise exception 'This storefront does not have a direct payment method available.';
  end if;

  -- Validate, price, and lock every requested variant before creating records.
  for item in select * from jsonb_array_elements(items_payload)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'A cart item is invalid.';
    end if;

    begin
      variant_uuid := (item->>'variant_id')::uuid;
      qty := coalesce((item->>'quantity')::integer, 1);
    exception when others then
      raise exception 'A cart item has an invalid product option or quantity.';
    end;

    if qty < 1 or qty > 99 then
      raise exception 'Each cart quantity must be between 1 and 99.';
    end if;

    select * into variant_row
    from public.commerce_product_variants
    where id = variant_uuid
      and storefront_id = storefront_row.id
      and is_active = true
    for update;

    if variant_row.id is null then
      raise exception 'A cart item is no longer available.';
    end if;

    select * into product_row
    from public.commerce_products
    where id = variant_row.product_id
      and storefront_id = storefront_row.id
      and status = 'active';

    if product_row.id is null then
      raise exception 'A cart product is no longer available.';
    end if;

    available_qty := variant_row.inventory_quantity - variant_row.reserved_quantity;
    if product_row.track_inventory
       and variant_row.inventory_policy = 'deny'
       and available_qty < qty then
      raise exception '% does not have enough available stock.', product_row.name;
    end if;

    unit_amount := variant_row.price;
    if unit_amount < 0 then
      raise exception 'A product price is invalid.';
    end if;

    subtotal_amount := subtotal_amount + (unit_amount * qty);
  end loop;

  order_code := 'NXQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.commerce_orders (
    client_id, storefront_id, order_number, status, payment_status, fulfillment_status,
    fulfillment_stage, currency_code, customer_email, customer_name, customer_phone,
    shipping_address, payment_provider, customer_note, placed_at, is_test,
    reservation_expires_at, metadata
  ) values (
    storefront_row.client_id, storefront_row.id, order_code, 'pending', 'pending', 'unfulfilled',
    'new', storefront_row.currency_code, customer_email_value, customer_name_value,
    customer_phone_value, shipping_address_value, 'direct_link_manual_confirmation',
    customer_note_value, now(), false, now() + interval '2 hours',
    jsonb_build_object(
      'checkout_source', 'public_direct_payment',
      'payment_instruction', 'Customer pays merchant directly and merchant confirms receipt.',
      'nxq_holds_funds', false
    )
  ) returning id into order_uuid;

  -- Locks from the validation pass are held through this transaction.
  for item in select * from jsonb_array_elements(items_payload)
  loop
    variant_uuid := (item->>'variant_id')::uuid;
    qty := coalesce((item->>'quantity')::integer, 1);

    select * into variant_row
    from public.commerce_product_variants
    where id = variant_uuid
      and storefront_id = storefront_row.id
    for update;

    select * into product_row
    from public.commerce_products
    where id = variant_row.product_id
      and storefront_id = storefront_row.id;

    unit_amount := variant_row.price;
    line_amount := unit_amount * qty;

    insert into public.commerce_order_items (
      client_id, storefront_id, order_id, product_id, variant_id, product_name, variant_name,
      sku, quantity, unit_price, line_total, product_snapshot
    ) values (
      storefront_row.client_id, storefront_row.id, order_uuid, product_row.id, variant_row.id,
      product_row.name, variant_row.title, variant_row.sku, qty, unit_amount, line_amount,
      jsonb_build_object('product_slug', product_row.slug, 'variant_title', variant_row.title)
    );

    if product_row.track_inventory then
      update public.commerce_product_variants
      set reserved_quantity = reserved_quantity + qty,
          updated_at = now()
      where id = variant_row.id;

      insert into public.commerce_inventory_movements (
        client_id, storefront_id, product_id, variant_id, movement_type,
        quantity_delta, quantity_after, reference_type, reference_id, note
      ) values (
        storefront_row.client_id, storefront_row.id, product_row.id, variant_row.id,
        'reservation', -qty,
        variant_row.inventory_quantity - variant_row.reserved_quantity - qty,
        'commerce_order', order_uuid,
        'Inventory reserved for a pending direct-payment order. Physical stock is unchanged until fulfillment.'
      );
    end if;
  end loop;

  update public.commerce_orders
  set subtotal = subtotal_amount,
      grand_total = subtotal_amount,
      updated_at = now()
  where id = order_uuid;

  insert into public.commerce_order_events (
    client_id, storefront_id, order_id, event_type, to_status, note
  ) values (
    storefront_row.client_id, storefront_row.id, order_uuid,
    'order_created', 'new',
    'Direct-payment order created. Inventory is reserved until payment confirmation or reservation expiry.'
  );

  return jsonb_build_object(
    'order_id', order_uuid,
    'order_number', order_code,
    'total', subtotal_amount,
    'currency', storefront_row.currency_code,
    'paypal_url', nullif(storefront_row.settings->>'paypal_url', ''),
    'venmo_url', nullif(storefront_row.settings->>'venmo_url', ''),
    'payment_note', coalesce(storefront_row.public_payment_note, 'Include your order number in the payment note.'),
    'reservation_expires_at', now() + interval '2 hours'
  );
end;
$$;

create or replace function public.confirm_my_direct_payment_order(order_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  order_row public.commerce_orders%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select * into order_row
  from public.commerce_orders
  where id = order_uuid and client_id = client_uuid
  for update;

  if order_row.id is null then
    raise exception 'Order was not found.';
  end if;
  if order_row.payment_provider <> 'direct_link_manual_confirmation' then
    raise exception 'This order is not a direct-payment order.';
  end if;
  if order_row.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'order_number', order_row.order_number);
  end if;
  if order_row.reservation_released_at is not null
     or order_row.fulfillment_stage = 'cancelled'
     or order_row.status = 'cancelled' then
    raise exception 'This order reservation was already released. Review the order before confirming payment.';
  end if;

  update public.commerce_orders
  set payment_status = 'paid',
      status = 'confirmed',
      paid_at = now(),
      reservation_expires_at = null,
      updated_at = now()
  where id = order_uuid;

  insert into public.commerce_order_events (
    client_id, storefront_id, order_id, event_type, from_status, to_status, note
  ) values (
    client_uuid, order_row.storefront_id, order_uuid,
    'payment_confirmed', order_row.payment_status, 'paid',
    'Direct payment confirmed by the client. Reserved inventory remains reserved until fulfillment.'
  );

  return jsonb_build_object('ok', true, 'order_number', order_row.order_number);
end;
$$;

-- Recreate reservation cleanup so trusted backend/cron execution can release abandoned orders.
create or replace function public.release_expired_commerce_reservations(target_storefront_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released_orders integer := 0;
  order_record record;
  item_record record;
  backend_allowed boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
  owner_allowed boolean := public.is_nxq_owner();
  client_uuid uuid := public.current_client_id();
begin
  if not backend_allowed and not owner_allowed and client_uuid is null then
    raise exception 'Authorized workspace required.';
  end if;

  for order_record in
    select o.*
    from public.commerce_orders o
    where o.reservation_expires_at is not null
      and o.reservation_expires_at <= now()
      and o.reservation_released_at is null
      and o.payment_status <> 'paid'
      and o.fulfillment_stage in ('new','processing')
      and (target_storefront_id is null or o.storefront_id = target_storefront_id)
      and (backend_allowed or owner_allowed or o.client_id = client_uuid)
    for update
  loop
    for item_record in
      select * from public.commerce_order_items where order_id = order_record.id
    loop
      if item_record.variant_id is not null then
        update public.commerce_product_variants
        set reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0),
            updated_at = now()
        where id = item_record.variant_id;

        insert into public.commerce_inventory_movements (
          client_id, storefront_id, product_id, variant_id, movement_type,
          quantity_delta, reference_type, reference_id, note
        ) values (
          order_record.client_id, order_record.storefront_id, item_record.product_id,
          item_record.variant_id, 'release', item_record.quantity,
          'commerce_order', order_record.id,
          'Expired unpaid reservation released automatically.'
        );
      end if;
    end loop;

    update public.commerce_orders
    set reservation_released_at = now(),
        fulfillment_stage = 'cancelled',
        fulfillment_status = 'cancelled',
        status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        fulfillment_note = coalesce(fulfillment_note, 'Reservation expired before payment confirmation.'),
        updated_at = now()
    where id = order_record.id;

    insert into public.commerce_order_events (
      client_id, storefront_id, order_id, event_type, from_status, to_status, note
    ) values (
      order_record.client_id, order_record.storefront_id, order_record.id,
      'reservation_expired', order_record.fulfillment_stage, 'cancelled',
      'Expired unpaid reservation released automatically.'
    );

    released_orders := released_orders + 1;
  end loop;

  return released_orders;
end;
$$;

-- Run cleanup regularly. Re-scheduling by name keeps this migration idempotent in repaired environments.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-release-expired-commerce-reservations') then
    perform cron.unschedule('nxq-release-expired-commerce-reservations');
  end if;

  perform cron.schedule(
    'nxq-release-expired-commerce-reservations',
    '*/15 * * * *',
    'select public.release_expired_commerce_reservations(null);'
  );
end;
$$;

revoke all on function public.guard_public_direct_payment_order() from public, anon, authenticated;
revoke all on function public.create_public_direct_payment_order(text,jsonb,jsonb) from public;
revoke all on function public.confirm_my_direct_payment_order(uuid) from public, anon;
revoke all on function public.release_expired_commerce_reservations(uuid) from public;

grant execute on function public.create_public_direct_payment_order(text,jsonb,jsonb) to anon, authenticated;
grant execute on function public.confirm_my_direct_payment_order(uuid) to authenticated;
grant execute on function public.release_expired_commerce_reservations(uuid) to authenticated, service_role;
