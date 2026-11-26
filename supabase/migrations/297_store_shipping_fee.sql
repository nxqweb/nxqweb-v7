-- 297: promoted from draft 08 on 2026-11-24 (owner chose "everything" for deploy day in chat); NOT applied until the owner approves the guarded run.
-- Draft 08: a simple shipping fee for stores (added 2026-11-17). ADDITIVE ONLY: four new functions plus one internal helper.
-- No existing function, table, trigger or policy is changed, so a store that never sets a shipping rule behaves exactly as before,
-- and the app keeps using the old order function until a rule is switched on.
--
-- The rule lives in commerce_storefronts.settings -> 'shipping' (the same jsonb the payment links, order mode and profile use):
--   mode            'none' (default) or 'flat'
--   flat_fee        one fee per order, 0 to 9999.99
--   free_over       optional: orders with a subtotal at or above this ship free
--   pickup_allowed  the shopper may choose local pickup (no fee)
--   pickup_note     optional plain text shown to the shopper ("Pickup is Saturdays at the market")
-- The fee is charged only when the order holds at least one product marked "requires shipping".
-- The SERVER works the fee out from the saved rule; nothing the shopper's page sends can set or lower the amount.
-- Payment stays manual (the shopper pays the store directly); only the order total the shopper is told to pay changes.

create or replace function public.nxq_store_shipping_rule(settings_value jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'mode', case when settings_value -> 'shipping' ->> 'mode' = 'flat' then 'flat' else 'none' end,
    'flat_fee', coalesce((settings_value -> 'shipping' ->> 'flat_fee')::numeric(12,2), 0),
    'free_over', (settings_value -> 'shipping' ->> 'free_over')::numeric(12,2),
    'pickup_allowed', coalesce((settings_value -> 'shipping' ->> 'pickup_allowed')::boolean, false),
    'pickup_note', nullif(settings_value -> 'shipping' ->> 'pickup_note', '')
  )
$$;

create or replace function public.get_my_store_shipping()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  settings_value jsonb;
  found_store boolean := false;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select true, settings into found_store, settings_value from public.commerce_storefronts where client_id = client_uuid;
  return public.nxq_store_shipping_rule(coalesce(settings_value, '{}'::jsonb))
    || jsonb_build_object('has_storefront', coalesce(found_store, false));
end;
$$;

create or replace function public.save_my_store_shipping(
  mode_value text,
  flat_fee_value numeric default 0,
  free_over_value numeric default null,
  pickup_allowed_value boolean default false,
  pickup_note_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  mode_clean text := lower(btrim(coalesce(mode_value, '')));
  note_clean text := nullif(btrim(coalesce(pickup_note_value, '')), '');
  fee_clean numeric(12,2);
  free_clean numeric(12,2);
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  if mode_clean not in ('none', 'flat') then raise exception 'Choose no shipping fee or one flat fee per order.'; end if;
  if flat_fee_value is null or flat_fee_value < 0 or flat_fee_value > 9999.99 then
    raise exception 'The shipping fee must be between 0 and 9999.99.';
  end if;
  if free_over_value is not null and (free_over_value <= 0 or free_over_value > 999999.99) then
    raise exception 'Free shipping must start above 0.';
  end if;
  if note_clean is not null and length(note_clean) > 300 then
    raise exception 'The pickup note must be 300 characters or fewer.';
  end if;
  fee_clean := round(flat_fee_value, 2);
  free_clean := round(free_over_value, 2);
  if mode_clean = 'flat' and fee_clean = 0 then raise exception 'Enter a shipping fee above 0, or choose no shipping fee.'; end if;

  storefront_uuid := public.ensure_my_commerce_storefront();
  update public.commerce_storefronts
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{shipping}', jsonb_strip_nulls(jsonb_build_object(
        'mode', mode_clean,
        'flat_fee', case when mode_clean = 'flat' then fee_clean else 0 end,
        'free_over', case when mode_clean = 'flat' then free_clean else null end,
        'pickup_allowed', coalesce(pickup_allowed_value, false),
        'pickup_note', case when coalesce(pickup_allowed_value, false) then note_clean else null end
      )), true),
      updated_at = now()
  where id = storefront_uuid and client_id = client_uuid;

  return public.get_my_store_shipping();
end;
$$;

-- What a shopper may know before ordering: the fee, when it is free, and whether pickup is offered. Active stores only.
create or replace function public.get_public_store_shipping(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.nxq_store_shipping_rule(coalesce(s.settings, '{}'::jsonb))
  from public.commerce_storefronts s
  where s.store_slug = store_slug_value and s.status = 'active'
$$;

-- Places the order through the existing hardened order function (same checks, stock holds, idempotency and order number), then adds
-- the shipping fee the saved rule gives. A replayed checkout returns the first order as stored and never re-prices it.
create or replace function public.create_public_store_order_with_shipping(
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
  result jsonb;
  rule jsonb;
  storefront_uuid uuid;
  order_row public.commerce_orders%rowtype;
  method text;
  needs_shipping boolean;
  fee numeric(12,2) := 0;
  changed integer;
begin
  if customer_payload is null or jsonb_typeof(customer_payload) <> 'object' then
    raise exception 'Customer details are invalid.';
  end if;
  method := lower(btrim(coalesce(customer_payload ->> 'delivery_method', 'ship')));
  if method not in ('ship', 'pickup') then raise exception 'Choose shipping or pickup.'; end if;

  select s.id, public.nxq_store_shipping_rule(coalesce(s.settings, '{}'::jsonb))
  into storefront_uuid, rule
  from public.commerce_storefronts s
  where s.store_slug = store_slug_value and s.status = 'active';
  if storefront_uuid is null then raise exception 'Storefront is not available.'; end if;
  if method = 'pickup' and not (rule ->> 'pickup_allowed')::boolean then
    raise exception 'This store does not offer pickup.';
  end if;

  result := public.create_public_stripe_ready_direct_payment_order(store_slug_value, items_payload, customer_payload);

  select * into order_row from public.commerce_orders
  where id = (result ->> 'order_id')::uuid and storefront_id = storefront_uuid
  for update;
  if order_row.id is null then raise exception 'Order could not be priced.'; end if;

  if coalesce((result ->> 'idempotent_replay')::boolean, false) then
    return result || jsonb_build_object(
      'subtotal', order_row.subtotal,
      'shipping_total', order_row.shipping_total,
      'total', order_row.grand_total,
      'delivery_method', coalesce(order_row.metadata ->> 'delivery_method', 'ship')
    );
  end if;

  select exists (
    select 1 from public.commerce_order_items i
    join public.commerce_products p on p.id = i.product_id
    where i.order_id = order_row.id and p.requires_shipping
  ) into needs_shipping;

  if rule ->> 'mode' = 'flat' and needs_shipping and method = 'ship'
     and not ((rule ->> 'free_over') is not null and order_row.subtotal >= (rule ->> 'free_over')::numeric) then
    fee := (rule ->> 'flat_fee')::numeric(12,2);
  end if;

  update public.commerce_orders
  set shipping_total = fee,
      grand_total = subtotal + fee,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('delivery_method', method, 'shipping_rule', rule),
      updated_at = now()
  where id = order_row.id and storefront_id = storefront_uuid;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Order could not be priced.'; end if;

  return result || jsonb_build_object(
    'subtotal', order_row.subtotal,
    'shipping_total', fee,
    'total', order_row.subtotal + fee,
    'delivery_method', method
  );
end;
$$;

revoke all on function public.nxq_store_shipping_rule(jsonb) from public, anon, authenticated;
revoke all on function public.get_my_store_shipping() from public, anon;
revoke all on function public.save_my_store_shipping(text, numeric, numeric, boolean, text) from public, anon;
revoke all on function public.get_public_store_shipping(text) from public;
revoke all on function public.create_public_store_order_with_shipping(text, jsonb, jsonb) from public;
grant execute on function public.get_my_store_shipping() to authenticated;
grant execute on function public.save_my_store_shipping(text, numeric, numeric, boolean, text) to authenticated;
grant execute on function public.get_public_store_shipping(text) to anon, authenticated;
grant execute on function public.create_public_store_order_with_shipping(text, jsonb, jsonb) to anon, authenticated;
