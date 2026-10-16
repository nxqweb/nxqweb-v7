-- DRAFT 06: NXQX-Menu v1. A store can be a "menu": customers see the items with prices and descriptions, with no cart and no stock, and are told how
-- to order (call or email the shop, from the contact details in migration 269's profile). Hours go in the About text (no new field).
-- Builds on migration 270 (order mode). Same function names and argument names as 270, so the app's calls do not change:
--   get_my_store_order_mode()  now also returns supported_modes (the app shows the Menu choice only when this list has 'menu')
--   save_my_store_order_mode(order_mode_value, make_live)  now also accepts 'menu'; menu needs a contact email OR phone
--   get_public_store_order_mode(slug)  returns 'menu' plus contact email and phone for menu stores only
-- Nothing here changes products, prices, payments or orders.

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
    return jsonb_build_object('has_storefront', false, 'order_mode', 'online', 'contact_email', null, 'contact_phone', null, 'status', null, 'supported_modes', jsonb_build_array('online', 'email', 'menu'));
  end if;
  return jsonb_build_object(
    'has_storefront', true,
    'order_mode', case when storefront_row.settings ->> 'order_mode' in ('email', 'menu') then storefront_row.settings ->> 'order_mode' else 'online' end,
    'contact_email', storefront_row.settings -> 'profile' ->> 'contact_email',
    'contact_phone', storefront_row.settings -> 'profile' ->> 'contact_phone',
    'status', storefront_row.status,
    'supported_modes', jsonb_build_array('online', 'email', 'menu')
  );
end;
$$;

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
  phone_value text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select coalesce(qa_only, false) into client_qa_only from public.clients where id = client_uuid;
  if client_qa_only then raise exception 'Billing artifacts are forbidden for QA-only clients.'; end if;
  if mode_clean not in ('online', 'email', 'menu') then raise exception 'Choose online payment, orders by email, or a menu.'; end if;

  storefront_uuid := public.ensure_my_commerce_storefront();
  select settings -> 'profile' ->> 'contact_email', settings -> 'profile' ->> 'contact_phone'
    into email_value, phone_value from public.commerce_storefronts where id = storefront_uuid;
  if mode_clean = 'email' and nullif(btrim(coalesce(email_value, '')), '') is null then
    raise exception 'Add a contact email before taking orders by email.';
  end if;
  if mode_clean = 'menu' and nullif(btrim(coalesce(email_value, '')), '') is null and nullif(btrim(coalesce(phone_value, '')), '') is null then
    raise exception 'Add a contact email or phone so customers know how to order from your menu.';
  end if;

  update public.commerce_storefronts
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{order_mode}', to_jsonb(mode_clean), true),
      status = case when mode_clean in ('email', 'menu') and make_live then 'active' else status end,
      updated_at = now()
  where id = storefront_uuid;

  return public.get_my_store_order_mode();
end;
$$;

create or replace function public.get_public_store_order_mode(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_mode', case when s.settings ->> 'order_mode' in ('email', 'menu') then s.settings ->> 'order_mode' else 'online' end,
    'contact_email', case when s.settings ->> 'order_mode' in ('email', 'menu') then s.settings -> 'profile' ->> 'contact_email' else null end,
    'contact_phone', case when s.settings ->> 'order_mode' = 'menu' then s.settings -> 'profile' ->> 'contact_phone' else null end
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
