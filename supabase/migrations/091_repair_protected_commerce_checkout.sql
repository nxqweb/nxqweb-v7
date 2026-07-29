-- Forward-only repair for the protected Commerce checkout.
-- Aligns public test checkout orders with the active Commerce order schema and
-- reserves inventory without subtracting physical stock before fulfillment.

create or replace function public.create_public_protected_commerce_checkout(
  store_slug_input text,
  checkout_payload jsonb,
  idempotency_key_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_storefront public.commerce_storefronts%rowtype;
  existing_order public.commerce_orders%rowtype;
  created_order public.commerce_orders%rowtype;
  customer_record public.commerce_customers%rowtype;
  item jsonb;
  product_record public.commerce_products%rowtype;
  variant_record public.commerce_product_variants%rowtype;
  requested_quantity integer;
  available_quantity integer;
  effective_price numeric(12,2);
  line_total_value numeric(12,2);
  subtotal_value numeric(12,2) := 0;
  order_number_value text;
  customer_name_value text := trim(coalesce(checkout_payload ->> 'customer_name', ''));
  customer_email_value text := lower(trim(coalesce(checkout_payload ->> 'customer_email', '')));
  customer_phone_value text := nullif(trim(coalesce(checkout_payload ->> 'customer_phone', '')), '');
  shipping_address_value jsonb := coalesce(checkout_payload -> 'shipping_address', '{}'::jsonb);
  shipping_method_value text := nullif(trim(coalesce(checkout_payload ->> 'shipping_method', 'standard')), '');
  customer_note_value text := nullif(trim(coalesce(checkout_payload ->> 'customer_note', '')), '');
  items_value jsonb := coalesce(checkout_payload -> 'items', '[]'::jsonb);
  item_count integer;
begin
  if idempotency_key_input is null or length(trim(idempotency_key_input)) < 12 then
    raise exception 'Checkout session is invalid. Please refresh and try again.';
  end if;

  if customer_name_value = '' or customer_email_value = '' then
    raise exception 'Customer name and email are required.';
  end if;

  if customer_email_value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid customer email address.';
  end if;

  select * into target_storefront
  from public.commerce_storefronts
  where store_slug = lower(trim(store_slug_input))
    and status <> 'disabled'
  limit 1;

  if target_storefront.id is null then
    raise exception 'Storefront not found';
  end if;

  select * into existing_order
  from public.commerce_orders
  where storefront_id = target_storefront.id
    and metadata ->> 'checkout_idempotency_key' = trim(idempotency_key_input)
  limit 1;

  if existing_order.id is not null then
    return jsonb_build_object(
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'total', existing_order.grand_total,
      'currency', existing_order.currency_code,
      'already_created', true,
      'test_mode', true
    );
  end if;

  if jsonb_typeof(items_value) <> 'array' then
    raise exception 'Checkout items are invalid.';
  end if;

  item_count := jsonb_array_length(items_value);
  if item_count < 1 or item_count > 25 then
    raise exception 'Your cart must contain between 1 and 25 different items.';
  end if;

  -- Validate, price, and lock every variant before creating any records.
  for item in select * from jsonb_array_elements(items_value)
  loop
    begin
      requested_quantity := (item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Every cart quantity must be a whole number.';
    end;

    if requested_quantity < 1 or requested_quantity > 99 then
      raise exception 'Each cart quantity must be between 1 and 99.';
    end if;

    select * into product_record
    from public.commerce_products
    where id = (item ->> 'product_id')::uuid
      and storefront_id = target_storefront.id
      and status <> 'archived'
    limit 1;

    if product_record.id is null then
      raise exception 'A product in this cart is no longer available.';
    end if;

    select * into variant_record
    from public.commerce_product_variants
    where id = (item ->> 'variant_id')::uuid
      and product_id = product_record.id
      and storefront_id = target_storefront.id
      and is_active = true
    for update;

    if variant_record.id is null then
      raise exception 'A selected product option is no longer available.';
    end if;

    available_quantity := variant_record.inventory_quantity - variant_record.reserved_quantity;
    if product_record.track_inventory
      and variant_record.inventory_policy = 'deny'
      and available_quantity < requested_quantity then
      raise exception '% does not have enough available stock for the requested quantity.', product_record.name;
    end if;

    effective_price := case when variant_record.price > 0 then variant_record.price else product_record.base_price end;
    if effective_price < 0 then
      raise exception 'A product price is invalid.';
    end if;

    subtotal_value := subtotal_value + (effective_price * requested_quantity);
  end loop;

  insert into public.commerce_customers (
    client_id, storefront_id, email, first_name, phone,
    default_shipping_address, metadata
  ) values (
    target_storefront.client_id, target_storefront.id, customer_email_value,
    customer_name_value, customer_phone_value, shipping_address_value,
    jsonb_build_object('source', 'protected_test_checkout')
  )
  on conflict (storefront_id, lower(email)) where email is not null
  do update set
    first_name = excluded.first_name,
    phone = excluded.phone,
    default_shipping_address = excluded.default_shipping_address,
    updated_at = now()
  returning * into customer_record;

  order_number_value := 'TEST-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISSMS');

  insert into public.commerce_orders (
    client_id, storefront_id, customer_id, order_number,
    status, payment_status, fulfillment_status, fulfillment_stage,
    currency_code, subtotal, discount_total, tax_total, shipping_total, grand_total,
    customer_email, customer_name, customer_phone,
    shipping_address, billing_address, shipping_method,
    payment_provider, payment_reference, customer_note,
    metadata, placed_at, paid_at, is_test
  ) values (
    target_storefront.client_id, target_storefront.id, customer_record.id, order_number_value,
    'pending', 'pending', 'unfulfilled', 'new',
    target_storefront.currency_code, subtotal_value, 0, 0, 0, subtotal_value,
    customer_email_value, customer_name_value, customer_phone_value,
    shipping_address_value, shipping_address_value, shipping_method_value,
    'protected_test', 'protected-test-' || replace(gen_random_uuid()::text, '-', ''), customer_note_value,
    jsonb_build_object(
      'is_test', true,
      'checkout_source', 'public_protected_checkout',
      'checkout_idempotency_key', trim(idempotency_key_input),
      'no_real_payment', true,
      'no_customer_contact', true
    ),
    now(), null, true
  ) returning * into created_order;

  for item in select * from jsonb_array_elements(items_value)
  loop
    requested_quantity := (item ->> 'quantity')::integer;

    select * into product_record
    from public.commerce_products
    where id = (item ->> 'product_id')::uuid
      and storefront_id = target_storefront.id;

    select * into variant_record
    from public.commerce_product_variants
    where id = (item ->> 'variant_id')::uuid
      and product_id = product_record.id
      and storefront_id = target_storefront.id
    for update;

    effective_price := case when variant_record.price > 0 then variant_record.price else product_record.base_price end;
    line_total_value := effective_price * requested_quantity;

    insert into public.commerce_order_items (
      client_id, storefront_id, order_id, product_id, variant_id,
      product_name, variant_name, sku, quantity, unit_price, line_total, product_snapshot
    ) values (
      target_storefront.client_id, target_storefront.id, created_order.id,
      product_record.id, variant_record.id, product_record.name, variant_record.title,
      variant_record.sku, requested_quantity, effective_price, line_total_value,
      jsonb_build_object(
        'product_name', product_record.name,
        'variant_title', variant_record.title,
        'sku', variant_record.sku,
        'unit_price', effective_price
      )
    );

    if product_record.track_inventory then
      update public.commerce_product_variants
      set reserved_quantity = reserved_quantity + requested_quantity,
          updated_at = now()
      where id = variant_record.id;

      insert into public.commerce_inventory_movements (
        client_id, storefront_id, product_id, variant_id,
        movement_type, quantity_delta, quantity_after,
        reference_type, reference_id, note
      ) values (
        target_storefront.client_id, target_storefront.id,
        product_record.id, variant_record.id,
        'reservation', -requested_quantity,
        variant_record.inventory_quantity - variant_record.reserved_quantity - requested_quantity,
        'commerce_order', created_order.id,
        'Inventory reserved automatically by protected checkout. Physical stock is unchanged until fulfillment.'
      );
    end if;
  end loop;

  insert into public.commerce_order_events (
    client_id, storefront_id, order_id, event_type, to_status, note
  ) values (
    target_storefront.client_id, target_storefront.id, created_order.id,
    'order_created', 'new',
    'Protected test checkout created. No payment was charged and no customer was contacted.'
  );

  return jsonb_build_object(
    'order_id', created_order.id,
    'order_number', created_order.order_number,
    'total', created_order.grand_total,
    'currency', created_order.currency_code,
    'already_created', false,
    'test_mode', true,
    'message', 'Protected test checkout completed. No real payment was charged and no customer was contacted.'
  );
end;
$$;

revoke all on function public.create_public_protected_commerce_checkout(text, jsonb, text) from public;
grant execute on function public.create_public_protected_commerce_checkout(text, jsonb, text) to anon, authenticated;

comment on function public.create_public_protected_commerce_checkout(text, jsonb, text) is
  'Creates a server-priced test order, records order history, and reserves available inventory without marking payment as paid or reducing physical stock.';
