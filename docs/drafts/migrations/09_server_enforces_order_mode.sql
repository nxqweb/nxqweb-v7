-- DRAFT (not a real migration; needs the owner's approval to promote and apply).
-- Fixes a known bug from the handoff list: "order mode is not enforced by the server".
-- A store can be set to take orders by email or as a menu (settings->>'order_mode' = 'email' or 'menu'); the public page then hides
-- the online checkout, but the order functions never looked at the mode, so anyone calling them directly could still create orders,
-- hold stock for 2 hours and notify the shop.
-- Change: the existing guard trigger on commerce_orders (every public direct-payment order passes through it, including the
-- Stripe-ready wrapper) now refuses when the store's order mode is email or menu. Online stores and stores with no mode set are unchanged.
-- Function text otherwise identical to the definition in force; create or replace keeps the trigger and grants.

create or replace function public.guard_public_direct_payment_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- A store set to take orders by email or as a menu must not create online orders or hold stock, however the order function is reached.
  if exists (
    select 1 from public.commerce_storefronts st
    where st.id = new.storefront_id and st.settings ->> 'order_mode' in ('email', 'menu')
  ) then
    raise exception 'This store is not taking online orders right now.';
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
$function$;
