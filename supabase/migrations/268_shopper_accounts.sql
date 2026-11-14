-- Migration 268: optional shopper accounts for NXQX-Commerce stores (owner request 2026-10-15; guest checkout stays as is; applied only after owner approval).
--
-- What this adds, per store, only where the store opts in (commerce_storefronts.customer_accounts_enabled, default false):
--  * a saved profile for a signed-in shopper (name, phone, shipping address) so checkout can autofill
--  * order history for that shopper = orders in THAT store placed with the shopper's CONFIRMED email (earlier guest orders appear too)
--  * a switch the store owner uses to turn accounts on or off for their own store
--  * a public yes/no so the storefront knows whether to show "Sign in"
--
-- What it deliberately does NOT do:
--  * no card numbers or payment details are stored anywhere (payments stay with the store's own Stripe/PayPal/Venmo)
--  * no change to the order-creation functions (migrations 104/115/227), so checkout behaviour cannot regress
--  * no shopper can read another shopper's data or another store's data: every read is keyed on auth.uid() AND the store resolved from the slug
--  * order history requires auth.users.email_confirmed_at, so signing up with someone else's email address shows nothing
--
-- Shoppers use the same Supabase Auth user pool as everyone else. The signup trigger only creates a client when the user metadata carries a
-- business_name (migration 193), so a shopper signing up never becomes a client.

create table if not exists public.commerce_shopper_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  full_name text check (full_name is null or length(full_name) <= 160),
  phone text check (phone is null or length(phone) <= 80),
  shipping_address jsonb not null default '{}'::jsonb
    check (jsonb_typeof(shipping_address) = 'object' and length(shipping_address::text) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, storefront_id)
);

-- Deny-by-default: RLS on with no policies and no direct grants. All access goes through the functions below.
alter table public.commerce_shopper_profiles enable row level security;
revoke all on table public.commerce_shopper_profiles from public, anon, authenticated;

create index if not exists commerce_orders_storefront_email_idx
  on public.commerce_orders (storefront_id, lower(customer_email));

-- Internal helper: who is the signed-in shopper and which opted-in store are they talking to. Not callable by any API role.
create or replace function public.nxq_shopper_context(store_slug_value text)
returns table (shopper_user uuid, shopper_email text, shopper_storefront uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  user_value uuid := auth.uid();
  email_value text;
  storefront_value uuid;
begin
  if user_value is null then
    raise exception 'Sign in to continue.';
  end if;
  if store_slug_value is null or length(trim(store_slug_value)) < 1 or length(trim(store_slug_value)) > 120 then
    raise exception 'Storefront is not available.';
  end if;

  select s.id into storefront_value
  from public.commerce_storefronts s
  where s.store_slug = trim(store_slug_value)
    and s.status = 'active'
    and s.customer_accounts_enabled = true;
  if storefront_value is null then
    raise exception 'Customer accounts are not available for this store.';
  end if;

  select lower(u.email) into email_value
  from auth.users u
  where u.id = user_value and u.email_confirmed_at is not null;
  if email_value is null then
    raise exception 'Confirm your email address to use your account.';
  end if;

  return query select user_value, email_value, storefront_value;
end;
$$;

create or replace function public.get_my_shopper_profile(store_slug_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  profile_row public.commerce_shopper_profiles%rowtype;
begin
  select * into ctx from public.nxq_shopper_context(store_slug_value);
  select * into profile_row from public.commerce_shopper_profiles
  where user_id = ctx.shopper_user and storefront_id = ctx.shopper_storefront;

  return jsonb_build_object(
    'email', ctx.shopper_email,
    'has_profile', profile_row.id is not null,
    'full_name', profile_row.full_name,
    'phone', profile_row.phone,
    'shipping_address', coalesce(profile_row.shipping_address, '{}'::jsonb)
  );
end;
$$;

create or replace function public.save_my_shopper_profile(store_slug_value text, profile_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  name_value text;
  phone_value text;
  address_value jsonb;
begin
  select * into ctx from public.nxq_shopper_context(store_slug_value);

  if profile_payload is null or jsonb_typeof(profile_payload) <> 'object' then
    raise exception 'Profile details are invalid.';
  end if;
  name_value := nullif(trim(coalesce(profile_payload->>'full_name', '')), '');
  phone_value := nullif(trim(coalesce(profile_payload->>'phone', '')), '');
  address_value := coalesce(profile_payload->'shipping_address', '{}'::jsonb);

  if name_value is not null and length(name_value) > 160 then
    raise exception 'Name must be 160 characters or fewer.';
  end if;
  if phone_value is not null and length(phone_value) > 80 then
    raise exception 'Phone must be 80 characters or fewer.';
  end if;
  if jsonb_typeof(address_value) <> 'object' or length(address_value::text) > 5000 then
    raise exception 'Shipping address is invalid or too large.';
  end if;

  insert into public.commerce_shopper_profiles (user_id, storefront_id, full_name, phone, shipping_address)
  values (ctx.shopper_user, ctx.shopper_storefront, name_value, phone_value, address_value)
  on conflict (user_id, storefront_id) do update
  set full_name = excluded.full_name,
      phone = excluded.phone,
      shipping_address = excluded.shipping_address,
      updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_my_shopper_profile(store_slug_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
begin
  select * into ctx from public.nxq_shopper_context(store_slug_value);
  delete from public.commerce_shopper_profiles
  where user_id = ctx.shopper_user and storefront_id = ctx.shopper_storefront;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.list_my_shopper_orders(store_slug_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
begin
  select * into ctx from public.nxq_shopper_context(store_slug_value);

  return jsonb_build_object('orders', coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_number', o.order_number,
      'status', o.status,
      'payment_status', o.payment_status,
      'fulfillment_stage', o.fulfillment_stage,
      'grand_total', o.grand_total,
      'currency_code', o.currency_code,
      'placed_at', o.placed_at
    ) order by o.placed_at desc nulls last)
    from (
      select * from public.commerce_orders x
      where x.storefront_id = ctx.shopper_storefront
        and lower(x.customer_email) = ctx.shopper_email
        and coalesce(x.is_test, false) = false
      order by x.placed_at desc nulls last
      limit 50
    ) o
  ), '[]'::jsonb));
end;
$$;

-- The store owner switches accounts on or off for their own store only.
create or replace function public.set_my_customer_accounts_enabled(enable_accounts boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  changed integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  if enable_accounts is null then raise exception 'Choose on or off.'; end if;

  update public.commerce_storefronts
  set customer_accounts_enabled = enable_accounts, updated_at = now()
  where client_id = client_uuid;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Create your storefront first.'; end if;

  return jsonb_build_object('ok', true, 'customer_accounts_enabled', enable_accounts);
end;
$$;

-- Public yes/no so the storefront can decide whether to show "Sign in". Reveals nothing else.
create or replace function public.get_public_store_accounts_status(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('accounts_enabled', coalesce((
    select s.customer_accounts_enabled
    from public.commerce_storefronts s
    where s.store_slug = trim(coalesce(store_slug_value, '')) and s.status = 'active'
    limit 1
  ), false));
$$;

revoke all on function public.nxq_shopper_context(text) from public, anon, authenticated;
revoke all on function public.get_my_shopper_profile(text) from public, anon;
revoke all on function public.save_my_shopper_profile(text, jsonb) from public, anon;
revoke all on function public.delete_my_shopper_profile(text) from public, anon;
revoke all on function public.list_my_shopper_orders(text) from public, anon;
revoke all on function public.set_my_customer_accounts_enabled(boolean) from public, anon;
revoke all on function public.get_public_store_accounts_status(text) from public;
grant execute on function public.get_my_shopper_profile(text) to authenticated;
grant execute on function public.save_my_shopper_profile(text, jsonb) to authenticated;
grant execute on function public.delete_my_shopper_profile(text) to authenticated;
grant execute on function public.list_my_shopper_orders(text) to authenticated;
grant execute on function public.set_my_customer_accounts_enabled(boolean) to authenticated;
grant execute on function public.get_public_store_accounts_status(text) to anon, authenticated;
