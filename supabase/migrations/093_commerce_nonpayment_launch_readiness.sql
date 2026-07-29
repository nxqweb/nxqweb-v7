-- NXQ Commerce non-payment launch readiness.
-- Adds client-managed shipping/pickup/tax/policy settings, launch checks,
-- expiring test reservations, queued customer-notification records, and basic
-- public protected-checkout rate limiting. No payment provider is connected and
-- no email is sent by this migration.

alter table public.commerce_orders
  add column if not exists reservation_expires_at timestamptz,
  add column if not exists reservation_released_at timestamptz;

create table if not exists public.commerce_notification_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  order_id uuid references public.commerce_orders(id) on delete cascade,
  event_type text not null check (event_type in (
    'order_created','order_processing','order_ready_for_pickup','order_shipped',
    'order_delivered','order_cancelled','order_refunded'
  )),
  recipient_email text,
  subject_template text not null,
  body_template text not null,
  delivery_status text not null default 'queued_not_connected'
    check (delivery_status in ('queued_not_connected','ready','sent','failed','cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists commerce_notification_events_storefront_idx
  on public.commerce_notification_events(storefront_id, created_at desc);
create unique index if not exists commerce_notification_events_order_type_idx
  on public.commerce_notification_events(order_id, event_type)
  where order_id is not null;

alter table public.commerce_notification_events enable row level security;
revoke all on table public.commerce_notification_events from public, anon;
grant select on table public.commerce_notification_events to authenticated;

drop policy if exists client_view_own_commerce_notification_events on public.commerce_notification_events;
create policy client_view_own_commerce_notification_events
on public.commerce_notification_events
for select to authenticated
using (client_id = public.current_client_id());

drop policy if exists owner_view_commerce_notification_events on public.commerce_notification_events;
create policy owner_view_commerce_notification_events
on public.commerce_notification_events
for select to authenticated
using (public.is_nxq_owner());

create or replace function public.guard_public_protected_checkout_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
begin
  if coalesce(new.metadata ->> 'checkout_source', '') <> 'public_protected_checkout' then
    return new;
  end if;

  if new.is_test is distinct from true or new.payment_provider <> 'protected_test' then
    raise exception 'Public protected checkout may create test orders only.';
  end if;

  select count(*) into recent_count
  from public.commerce_orders o
  where o.storefront_id = new.storefront_id
    and lower(coalesce(o.customer_email, '')) = lower(coalesce(new.customer_email, ''))
    and coalesce(o.metadata ->> 'checkout_source', '') = 'public_protected_checkout'
    and o.created_at >= now() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'Too many protected checkout attempts. Please wait before trying again.';
  end if;

  new.reservation_expires_at := coalesce(new.reservation_expires_at, now() + interval '30 minutes');
  return new;
end;
$$;

drop trigger if exists guard_public_protected_checkout_order_trigger on public.commerce_orders;
create trigger guard_public_protected_checkout_order_trigger
before insert on public.commerce_orders
for each row execute function public.guard_public_protected_checkout_order();

create or replace function public.queue_commerce_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_event text;
  subject_value text;
  body_value text;
begin
  if tg_op = 'INSERT' then
    next_event := 'order_created';
  elsif new.fulfillment_stage is distinct from old.fulfillment_stage then
    next_event := case new.fulfillment_stage
      when 'processing' then 'order_processing'
      when 'ready_for_pickup' then 'order_ready_for_pickup'
      when 'shipped' then 'order_shipped'
      when 'delivered' then 'order_delivered'
      when 'cancelled' then 'order_cancelled'
      when 'refunded' then 'order_refunded'
      else null
    end;
  end if;

  if next_event is null then return new; end if;

  subject_value := case next_event
    when 'order_created' then 'Order received: ' || new.order_number
    when 'order_processing' then 'Your order is being prepared'
    when 'order_ready_for_pickup' then 'Your order is ready for pickup'
    when 'order_shipped' then 'Your order has shipped'
    when 'order_delivered' then 'Your order was delivered'
    when 'order_cancelled' then 'Your order was cancelled'
    when 'order_refunded' then 'Your order was refunded'
  end;

  body_value := case next_event
    when 'order_created' then 'We received order ' || new.order_number || '. Payment messaging remains disabled until a payment provider is connected.'
    when 'order_processing' then 'Order ' || new.order_number || ' is now being prepared.'
    when 'order_ready_for_pickup' then 'Order ' || new.order_number || ' is ready for pickup. Check the store instructions for details.'
    when 'order_shipped' then 'Order ' || new.order_number || ' has shipped.' || case when new.tracking_number is not null then ' Tracking: ' || new.tracking_number else '' end
    when 'order_delivered' then 'Order ' || new.order_number || ' was marked delivered.'
    when 'order_cancelled' then 'Order ' || new.order_number || ' was cancelled.'
    when 'order_refunded' then 'Order ' || new.order_number || ' was marked refunded.'
  end;

  insert into public.commerce_notification_events (
    client_id, storefront_id, order_id, event_type, recipient_email,
    subject_template, body_template, delivery_status, metadata
  ) values (
    new.client_id, new.storefront_id, new.id, next_event, new.customer_email,
    subject_value, body_value, 'queued_not_connected',
    jsonb_build_object('is_test', new.is_test, 'email_sending_enabled', false)
  ) on conflict (order_id, event_type) where order_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists queue_commerce_order_notification_trigger on public.commerce_orders;
create trigger queue_commerce_order_notification_trigger
after insert or update of fulfillment_stage on public.commerce_orders
for each row execute function public.queue_commerce_order_notification();

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
begin
  if not public.is_nxq_owner() and public.current_client_id() is null then
    raise exception 'Authorized workspace required.';
  end if;

  for order_record in
    select o.*
    from public.commerce_orders o
    where o.reservation_expires_at is not null
      and o.reservation_expires_at <= now()
      and o.reservation_released_at is null
      and o.fulfillment_stage in ('new','processing')
      and (target_storefront_id is null or o.storefront_id = target_storefront_id)
      and (public.is_nxq_owner() or o.client_id = public.current_client_id())
    for update
  loop
    for item_record in select * from public.commerce_order_items where order_id = order_record.id
    loop
      if item_record.variant_id is not null then
        update public.commerce_product_variants
        set reserved_quantity = greatest(reserved_quantity - item_record.quantity, 0),
            updated_at = now()
        where id = item_record.variant_id;

        insert into public.commerce_inventory_movements (
          client_id, storefront_id, product_id, variant_id, movement_type,
          quantity_delta, quantity_after, reference_type, reference_id, note
        )
        select order_record.client_id, order_record.storefront_id, item_record.product_id,
          item_record.variant_id, 'release', item_record.quantity,
          v.inventory_quantity - greatest(v.reserved_quantity - item_record.quantity, 0),
          'commerce_order', order_record.id,
          'Expired unpaid/test reservation released automatically.'
        from public.commerce_product_variants v where v.id = item_record.variant_id;
      end if;
    end loop;

    update public.commerce_orders
    set reservation_released_at = now(),
        fulfillment_stage = 'cancelled',
        fulfillment_status = 'cancelled',
        status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        fulfillment_note = coalesce(fulfillment_note, 'Reservation expired before payment was connected.'),
        updated_at = now()
    where id = order_record.id;

    insert into public.commerce_order_events (
      client_id, storefront_id, order_id, event_type, from_status, to_status, note
    ) values (
      order_record.client_id, order_record.storefront_id, order_record.id,
      'reservation_expired', order_record.fulfillment_stage, 'cancelled',
      'Expired reservation released. No payment was charged.'
    );

    released_orders := released_orders + 1;
  end loop;

  return released_orders;
end;
$$;

create or replace function public.save_my_commerce_launch_readiness(readiness_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  clean_settings jsonb;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  storefront_uuid := public.ensure_my_commerce_storefront();
  if readiness_payload is null or jsonb_typeof(readiness_payload) <> 'object' then
    raise exception 'Readiness settings must be an object.';
  end if;

  clean_settings := jsonb_build_object(
    'shipping_regions', left(trim(coalesce(readiness_payload->>'shipping_regions','')), 2000),
    'shipping_rates', left(trim(coalesce(readiness_payload->>'shipping_rates','')), 2000),
    'pickup_enabled', coalesce((readiness_payload->>'pickup_enabled')::boolean, false),
    'pickup_instructions', left(trim(coalesce(readiness_payload->>'pickup_instructions','')), 2000),
    'tax_registration_confirmed', coalesce((readiness_payload->>'tax_registration_confirmed')::boolean, false),
    'tax_notes', left(trim(coalesce(readiness_payload->>'tax_notes','')), 2000),
    'returns_policy', left(trim(coalesce(readiness_payload->>'returns_policy','')), 4000),
    'refund_policy', left(trim(coalesce(readiness_payload->>'refund_policy','')), 4000),
    'privacy_policy', left(trim(coalesce(readiness_payload->>'privacy_policy','')), 4000),
    'terms_of_sale', left(trim(coalesce(readiness_payload->>'terms_of_sale','')), 4000),
    'support_email', lower(left(trim(coalesce(readiness_payload->>'support_email','')), 320)),
    'customer_notifications_enabled', coalesce((readiness_payload->>'customer_notifications_enabled')::boolean, true),
    'updated_at', now()
  );

  update public.commerce_storefronts
  set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('launch_readiness', clean_settings),
      shipping_mode = case
        when coalesce((readiness_payload->>'pickup_enabled')::boolean, false)
          and trim(coalesce(readiness_payload->>'shipping_regions','')) = '' then 'pickup_only'
        when trim(coalesce(readiness_payload->>'shipping_regions','')) <> '' then 'manual'
        else 'disabled'
      end,
      tax_mode = case when coalesce((readiness_payload->>'tax_registration_confirmed')::boolean, false) then 'manual' else 'disabled' end,
      updated_at = now()
  where id = storefront_uuid;

  return clean_settings;
end;
$$;

create or replace function public.get_my_commerce_launch_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_row public.commerce_storefronts%rowtype;
  intake_row public.commerce_intakes%rowtype;
  readiness jsonb;
  product_count integer;
  active_variant_count integer;
  image_count integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select * into storefront_row from public.commerce_storefronts where client_id = client_uuid;
  if storefront_row.id is null then perform public.ensure_my_commerce_storefront(); select * into storefront_row from public.commerce_storefronts where client_id = client_uuid; end if;
  select * into intake_row from public.commerce_intakes where client_id = client_uuid;

  perform public.release_expired_commerce_reservations(storefront_row.id);

  readiness := coalesce(storefront_row.settings->'launch_readiness', '{}'::jsonb);
  select count(*) into product_count from public.commerce_products where storefront_id = storefront_row.id and status <> 'archived';
  select count(*) into active_variant_count from public.commerce_product_variants where storefront_id = storefront_row.id and is_active = true;
  select count(*) into image_count from public.commerce_product_images where storefront_id = storefront_row.id;

  return jsonb_build_object(
    'storefront', jsonb_build_object(
      'id', storefront_row.id,
      'store_name', storefront_row.store_name,
      'status', storefront_row.status,
      'payment_mode', storefront_row.payment_mode,
      'shipping_mode', storefront_row.shipping_mode,
      'tax_mode', storefront_row.tax_mode
    ),
    'settings', readiness,
    'checks', jsonb_build_array(
      jsonb_build_object('key','setup','label','Commerce setup submitted or approved','passed',coalesce(intake_row.status,'draft') in ('submitted','approved')),
      jsonb_build_object('key','products','label','At least one product exists','passed',product_count > 0),
      jsonb_build_object('key','variants','label','At least one active product variant exists','passed',active_variant_count > 0),
      jsonb_build_object('key','images','label','At least one product image exists','passed',image_count > 0),
      jsonb_build_object('key','fulfillment','label','Shipping regions or local pickup configured','passed',trim(coalesce(readiness->>'shipping_regions','')) <> '' or coalesce((readiness->>'pickup_enabled')::boolean,false)),
      jsonb_build_object('key','policies','label','Returns, refund, privacy, and terms are written','passed',
        trim(coalesce(readiness->>'returns_policy','')) <> '' and trim(coalesce(readiness->>'refund_policy','')) <> '' and
        trim(coalesce(readiness->>'privacy_policy','')) <> '' and trim(coalesce(readiness->>'terms_of_sale','')) <> ''),
      jsonb_build_object('key','support','label','Customer support email is configured','passed',trim(coalesce(readiness->>'support_email','')) <> ''),
      jsonb_build_object('key','payment','label','Live payment provider connected','passed',false,'blocked',true,'note','Intentionally disabled in this non-payment readiness update.')
    ),
    'payment_blocked', true,
    'can_publish_without_payments', false,
    'notification_delivery_connected', false,
    'notification_events', (select count(*) from public.commerce_notification_events where storefront_id = storefront_row.id)
  );
end;
$$;

revoke all on function public.release_expired_commerce_reservations(uuid) from public;
revoke all on function public.save_my_commerce_launch_readiness(jsonb) from public;
revoke all on function public.get_my_commerce_launch_readiness() from public;
grant execute on function public.release_expired_commerce_reservations(uuid) to authenticated;
grant execute on function public.save_my_commerce_launch_readiness(jsonb) to authenticated;
grant execute on function public.get_my_commerce_launch_readiness() to authenticated;
