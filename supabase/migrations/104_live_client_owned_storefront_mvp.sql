-- Client-owned Commerce storefront MVP.
-- Clients publish their own products and receive payment directly through public PayPal/Venmo links.
-- NXQ does not hold funds or approve routine product changes.

alter table public.commerce_storefronts
  add column if not exists public_payment_note text;

create or replace function public.get_my_live_storefront_settings()
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

  return (
    select jsonb_build_object(
      'id', s.id,
      'store_name', s.store_name,
      'store_slug', s.store_slug,
      'status', s.status,
      'currency_code', s.currency_code,
      'paypal_url', nullif(s.settings->>'paypal_url', ''),
      'venmo_url', nullif(s.settings->>'venmo_url', ''),
      'payment_note', s.public_payment_note,
      'public_url', '/store/' || s.store_slug,
      'products', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'status', p.status,
          'base_price', p.base_price,
          'image_url', p.image_urls->>0
        ) order by lower(p.name))
        from public.commerce_products p
        where p.storefront_id = s.id
      ), '[]'::jsonb)
    )
    from public.commerce_storefronts s
    where s.id = storefront_uuid
  );
end;
$$;

create or replace function public.save_my_live_storefront_settings(
  store_name_value text,
  paypal_url_value text default null,
  venmo_url_value text default null,
  payment_note_value text default null,
  make_live boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  next_status text;
  clean_paypal text;
  clean_venmo text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  storefront_uuid := public.ensure_my_commerce_storefront();

  if nullif(trim(store_name_value), '') is null then raise exception 'Store name is required.'; end if;
  clean_paypal := nullif(trim(coalesce(paypal_url_value, '')), '');
  clean_venmo := nullif(trim(coalesce(venmo_url_value, '')), '');

  if clean_paypal is not null and clean_paypal !~* '^https://(www\.)?(paypal\.me|paypal\.com)/' then
    raise exception 'Enter a public PayPal or PayPal.Me link.';
  end if;
  if clean_venmo is not null and clean_venmo !~* '^https://(www\.)?venmo\.com/' then
    raise exception 'Enter a public Venmo business profile link.';
  end if;
  if make_live and clean_paypal is null and clean_venmo is null then
    raise exception 'Add at least one direct payment link before opening the store.';
  end if;

  next_status := case when make_live then 'active' else 'draft' end;
  update public.commerce_storefronts
  set store_name = trim(store_name_value),
      status = next_status,
      payment_mode = case when clean_paypal is not null or clean_venmo is not null then 'live' else 'not_connected' end,
      payment_provider = case when clean_paypal is not null and clean_venmo is not null then 'paypal_venmo_links' when clean_paypal is not null then 'paypal_link' when clean_venmo is not null then 'venmo_link' else null end,
      settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('paypal_url', clean_paypal, 'venmo_url', clean_venmo),
      public_payment_note = nullif(trim(coalesce(payment_note_value, '')), ''),
      updated_at = now()
  where id = storefront_uuid;

  return jsonb_build_object('ok', true, 'status', next_status, 'public_url', '/store/' || (select store_slug from public.commerce_storefronts where id = storefront_uuid));
end;
$$;

create or replace function public.set_my_commerce_product_live(
  product_uuid uuid,
  make_active boolean,
  primary_image_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  product_row public.commerce_products%rowtype;
  live_count integer;
  max_products integer := 500;
  clean_image text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  select * into product_row from public.commerce_products
  where id = product_uuid and client_id = client_uuid for update;
  if product_row.id is null then raise exception 'Product was not found in this workspace.'; end if;

  clean_image := nullif(trim(coalesce(primary_image_url, '')), '');
  if clean_image is not null and clean_image !~* '^https://[^\s]+$' then
    raise exception 'Product image must be a valid HTTPS URL.';
  end if;

  if make_active then
    if product_row.base_price < 0 then raise exception 'Product price is invalid.'; end if;
    select count(*) into live_count from public.commerce_products
    where client_id = client_uuid and status = 'active' and id <> product_uuid;
    if live_count >= max_products then raise exception 'This workspace has reached its live product limit.'; end if;
  end if;

  update public.commerce_products
  set status = case when make_active then 'active' else 'draft' end,
      image_urls = case when clean_image is null then image_urls else jsonb_build_array(clean_image) end,
      updated_at = now()
  where id = product_uuid;

  return jsonb_build_object('ok', true, 'status', case when make_active then 'active' else 'draft' end);
end;
$$;

create or replace function public.get_public_commerce_storefront(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'name', s.store_name,
      'slug', s.store_slug,
      'currency', s.currency_code,
      'paypal_url', nullif(s.settings->>'paypal_url', ''),
      'venmo_url', nullif(s.settings->>'venmo_url', ''),
      'payment_note', s.public_payment_note
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'slug', p.slug,
        'short_description', p.short_description,
        'description', p.description,
        'base_price', p.base_price,
        'compare_at_price', p.compare_at_price,
        'image_url', p.image_urls->>0,
        'requires_shipping', p.requires_shipping,
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', v.id,
            'title', v.title,
            'price', v.price,
            'available_quantity', greatest(v.inventory_quantity - v.reserved_quantity, 0),
            'inventory_policy', v.inventory_policy
          ) order by v.is_default desc, v.created_at)
          from public.commerce_product_variants v
          where v.product_id = p.id and v.is_active = true
        ), '[]'::jsonb)
      ) order by p.featured desc, p.updated_at desc)
      from public.commerce_products p
      where p.storefront_id = s.id and p.status = 'active'
    ), '[]'::jsonb)
  )
  from public.commerce_storefronts s
  where s.store_slug = store_slug_value and s.status = 'active'
$$;

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
  qty integer;
  unit_amount numeric(12,2);
  subtotal_amount numeric(12,2) := 0;
  line_amount numeric(12,2);
  order_code text;
  customer_name_value text;
  customer_email_value text;
begin
  select * into storefront_row from public.commerce_storefronts
  where store_slug = store_slug_value and status = 'active';
  if storefront_row.id is null then raise exception 'Storefront is not available.'; end if;
  if jsonb_typeof(items_payload) <> 'array' or jsonb_array_length(items_payload) = 0 then raise exception 'Your cart is empty.'; end if;

  customer_name_value := nullif(trim(coalesce(customer_payload->>'name', '')), '');
  customer_email_value := nullif(lower(trim(coalesce(customer_payload->>'email', ''))), '');
  if customer_name_value is null then raise exception 'Customer name is required.'; end if;
  if customer_email_value is null or customer_email_value !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid customer email is required.'; end if;

  order_code := 'NXQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.commerce_orders (
    client_id, storefront_id, order_number, status, payment_status, fulfillment_status,
    currency_code, customer_email, customer_name, customer_phone, shipping_address,
    payment_provider, customer_note, placed_at, metadata
  ) values (
    storefront_row.client_id, storefront_row.id, order_code, 'pending', 'pending', 'unfulfilled',
    storefront_row.currency_code, customer_email_value, customer_name_value,
    nullif(trim(coalesce(customer_payload->>'phone', '')), ''), customer_payload->'shipping_address',
    'direct_link_manual_confirmation', nullif(trim(coalesce(customer_payload->>'note', '')), ''), now(),
    jsonb_build_object('payment_instruction', 'Customer pays merchant directly and merchant confirms receipt.')
  ) returning id into order_uuid;

  for item in select * from jsonb_array_elements(items_payload)
  loop
    qty := greatest(1, least(99, coalesce((item->>'quantity')::integer, 1)));
    select * into variant_row from public.commerce_product_variants
    where id = (item->>'variant_id')::uuid and storefront_id = storefront_row.id and is_active = true;
    if variant_row.id is null then raise exception 'A cart item is no longer available.'; end if;
    select * into product_row from public.commerce_products where id = variant_row.product_id and status = 'active';
    if product_row.id is null then raise exception 'A cart product is no longer available.'; end if;
    if variant_row.inventory_policy = 'deny' and (variant_row.inventory_quantity - variant_row.reserved_quantity) < qty then
      raise exception '% does not have enough stock.', product_row.name;
    end if;
    unit_amount := variant_row.price;
    line_amount := unit_amount * qty;
    subtotal_amount := subtotal_amount + line_amount;

    insert into public.commerce_order_items (
      client_id, storefront_id, order_id, product_id, variant_id, product_name, variant_name,
      sku, quantity, unit_price, line_total, product_snapshot
    ) values (
      storefront_row.client_id, storefront_row.id, order_uuid, product_row.id, variant_row.id,
      product_row.name, variant_row.title, variant_row.sku, qty, unit_amount, line_amount,
      jsonb_build_object('product_slug', product_row.slug, 'variant_title', variant_row.title)
    );
  end loop;

  update public.commerce_orders
  set subtotal = subtotal_amount, grand_total = subtotal_amount, updated_at = now()
  where id = order_uuid;

  return jsonb_build_object(
    'order_id', order_uuid,
    'order_number', order_code,
    'total', subtotal_amount,
    'currency', storefront_row.currency_code,
    'paypal_url', nullif(storefront_row.settings->>'paypal_url', ''),
    'venmo_url', nullif(storefront_row.settings->>'venmo_url', ''),
    'payment_note', coalesce(storefront_row.public_payment_note, 'Include your order number in the payment note.')
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
  item_row record;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select * into order_row from public.commerce_orders
  where id = order_uuid and client_id = client_uuid for update;
  if order_row.id is null then raise exception 'Order was not found.'; end if;
  if order_row.payment_status = 'paid' then return jsonb_build_object('ok', true, 'already_paid', true); end if;

  for item_row in select * from public.commerce_order_items where order_id = order_uuid
  loop
    if item_row.variant_id is not null then
      update public.commerce_product_variants
      set inventory_quantity = case when inventory_policy = 'deny' then greatest(inventory_quantity - item_row.quantity, 0) else inventory_quantity - item_row.quantity end,
          updated_at = now()
      where id = item_row.variant_id and client_id = client_uuid;

      insert into public.commerce_inventory_movements (
        client_id, storefront_id, product_id, variant_id, movement_type, quantity_delta,
        reference_type, reference_id, note, actor_user_id
      ) values (
        client_uuid, order_row.storefront_id, item_row.product_id, item_row.variant_id,
        'sale', -item_row.quantity, 'commerce_order', order_uuid,
        'Direct payment confirmed by client.', auth.uid()
      );
    end if;
  end loop;

  update public.commerce_orders
  set payment_status = 'paid', status = 'confirmed', paid_at = now(), updated_at = now()
  where id = order_uuid;

  return jsonb_build_object('ok', true, 'order_number', order_row.order_number);
end;
$$;

revoke all on function public.get_my_live_storefront_settings() from public, anon;
revoke all on function public.save_my_live_storefront_settings(text, text, text, text, boolean) from public, anon;
revoke all on function public.set_my_commerce_product_live(uuid, boolean, text) from public, anon;
revoke all on function public.confirm_my_direct_payment_order(uuid) from public, anon;
grant execute on function public.get_my_live_storefront_settings() to authenticated;
grant execute on function public.save_my_live_storefront_settings(text, text, text, text, boolean) to authenticated;
grant execute on function public.set_my_commerce_product_live(uuid, boolean, text) to authenticated;
grant execute on function public.confirm_my_direct_payment_order(uuid) to authenticated;

revoke all on function public.get_public_commerce_storefront(text) from public;
revoke all on function public.create_public_direct_payment_order(text, jsonb, jsonb) from public;
grant execute on function public.get_public_commerce_storefront(text) to anon, authenticated;
grant execute on function public.create_public_direct_payment_order(text, jsonb, jsonb) to anon, authenticated;
