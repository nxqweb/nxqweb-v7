-- Migration 274: close an oversell hole in public checkout (found by an independent review, 2026-10-17; promoted the same day on the owner's choice 'A': apply with 272, 273 and 275 on deploy day). NOT yet applied.
--
-- THE BUG (migration 115, create_public_direct_payment_order): the duplicate-cart-line guard compares the variant ids as TEXT, but the stock check and the stock
-- reservation use the id cast to uuid, and the uuid cast accepts upper case, curly braces and hyphen-less forms. An anonymous caller can therefore send the same
-- variant several times in different spellings, pass the guard, and have the stock reserved once per spelling: reserved_quantity ends up far above the stock,
-- the store shows the item as sold out, and the owner has to cancel orders by hand. (Up to 25 lines of up to 99 units each.)
--
-- THE FIX: this is migration 115's function body, character for character, with ONE addition: inside the validation loop the cast uuid of each line is remembered,
-- and a second line for the same uuid is refused with the existing "Combine duplicate product options..." message. Nothing else changes: same signature, same
-- grants (restated below), same pricing, same stock rules, same errors. The Stripe-ready wrapper from 227 calls this function and is untouched.
--

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
  seen_variants uuid[] := '{}'::uuid[];
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

    -- The text-based duplicate check above cannot see the same variant written in a different spelling (upper case, braces, no hyphens), which the uuid cast accepts.
    -- Compare the CAST ids so one variant can only appear once, otherwise its stock would be reserved once per spelling.
    if variant_uuid = any(seen_variants) then
      raise exception 'Combine duplicate product options into one cart line before placing the order.';
    end if;
    seen_variants := seen_variants || variant_uuid;

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

revoke all on function public.create_public_direct_payment_order(text,jsonb,jsonb) from public;
grant execute on function public.create_public_direct_payment_order(text,jsonb,jsonb) to anon, authenticated;
