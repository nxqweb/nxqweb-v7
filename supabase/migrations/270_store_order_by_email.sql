-- Migration 270: let a store take orders by email instead of online payment links.
-- Owner request 2026-10-16 (the candle client wants customers to order over email).
-- Stored in commerce_storefronts.settings->>'order_mode' ('online' is the default when missing, 'email' is new).
-- In email mode the public store shows an "Email my order" button that opens the shopper's own email app addressed to the shop's contact
-- email (from migration 269's profile). No order row is created and no stock is held; the shop confirms by email.
-- Nothing here touches payment links or the existing order functions.

create or replace function public.get_my_store_order_mode()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_row public.commerce_storefronts%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select * into storefront_row from public.commerce_storefronts where client_id = client_uuid;
  if storefront_row.id is null then
    return jsonb_build_object('has_storefront', false, 'order_mode', 'online', 'contact_email', null, 'status', null);
  end if;
  return jsonb_build_object(
    'has_storefront', true,
    'order_mode', case when storefront_row.settings ->> 'order_mode' = 'email' then 'email' else 'online' end,
    'contact_email', storefront_row.settings -> 'profile' ->> 'contact_email',
    'status', storefront_row.status
  );
end;
$$;

-- Switch the store between the two ways of ordering. Email mode needs a contact email (set on the About and contact form).
-- make_live opens the store in email mode without any payment link. Online mode never opens the store by itself: opening an online store
-- still goes through the payment-link rules in save_my_stripe_ready_storefront_settings.
create or replace function public.save_my_store_order_mode(order_mode_value text, make_live boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  client_qa_only boolean := false;
  storefront_uuid uuid;
  mode_clean text := lower(btrim(coalesce(order_mode_value, '')));
  email_value text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select coalesce(qa_only, false) into client_qa_only from public.clients where id = client_uuid;
  if client_qa_only then raise exception 'Billing artifacts are forbidden for QA-only clients.'; end if;
  if mode_clean not in ('online', 'email') then raise exception 'Choose online payment or orders by email.'; end if;

  storefront_uuid := public.ensure_my_commerce_storefront();
  select settings -> 'profile' ->> 'contact_email' into email_value from public.commerce_storefronts where id = storefront_uuid;
  if mode_clean = 'email' and nullif(btrim(coalesce(email_value, '')), '') is null then
    raise exception 'Add a contact email before taking orders by email.';
  end if;

  update public.commerce_storefronts
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{order_mode}', to_jsonb(mode_clean), true),
      status = case when mode_clean = 'email' and make_live then 'active' else status end,
      updated_at = now()
  where id = storefront_uuid;

  return public.get_my_store_order_mode();
end;
$$;

-- Public read for an OPEN store only: how orders are taken and the contact email to send them to. Reveals nothing for a store that is not open.
create or replace function public.get_public_store_order_mode(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_mode', case when s.settings ->> 'order_mode' = 'email' then 'email' else 'online' end,
    'contact_email', case when s.settings ->> 'order_mode' = 'email' then s.settings -> 'profile' ->> 'contact_email' else null end
  ))
  from public.commerce_storefronts s
  where s.store_slug = store_slug_value and s.status = 'active'
$$;

revoke all on function public.get_my_store_order_mode() from public, anon;
revoke all on function public.save_my_store_order_mode(text, boolean) from public, anon;
revoke all on function public.get_public_store_order_mode(text) from public;
grant execute on function public.get_my_store_order_mode() to authenticated;
grant execute on function public.save_my_store_order_mode(text, boolean) to authenticated;
grant execute on function public.get_public_store_order_mode(text) to anon, authenticated;

comment on function public.get_public_store_order_mode(text) is
  'Public ordering mode of an open store plus the contact email only when orders are taken by email. Never returns payment links or other settings.';
