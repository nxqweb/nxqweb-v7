-- 284: Membership v1 for NXQX-Commerce stores (track only; owner decisions 2026-10-17). Promoted from draft 08 on 2026-10-26 (owner approved promoting the migration); NOT applied until the owner approves the guarded run. The page is still not routed and members-only enforcement is NOT included.
--
-- Decisions this follows (owner answered in chat):
--  * "members" are a CLIENT'S OWN CUSTOMERS (e.g. a monthly candle club), not the clients paying NXQX
--  * v1 TRACKS only: tiers, members, renewal dates. The client bills outside the app. No card data, no Stripe, no payouts
--  * the one perk type is "members-only products" (flag set here; ENFORCEMENT is deliberately NOT in this draft, see below)
--
-- What it adds (all deny-by-default: RLS on, no policies, no direct grants; every access goes through the functions):
--  * commerce_member_tiers        up to 10 per store (name, perks text, active)
--  * commerce_members             up to 2000 per store (email, name, phone, tier, status, renews_on, notes), one row per email per store
--  * commerce_member_only_products  which products the store owner marked members-only
--  * owner functions: list_my_membership, save_my_member_tier, save_my_member, remove_my_member, set_my_product_members_only
--  * shopper function: get_my_membership_status(store_slug): "am I a member of this store?" for a signed-in shopper with a CONFIRMED email
--    (needs the store's customer accounts switch from migration 268 to be on, same rules as the other shopper functions)
--
-- NOT in this draft (needs its own owner decision because it changes the core public store contract):
--  * HIDING members-only products on the public store means redefining get_public_commerce_storefront (migrations 104/107) AND refusing
--    members-only items inside order creation (migrations 104/115/227). A hide-only change would be cosmetic: anyone with a product link could
--    still order it. Until that change is approved, the flag is a record only and the UI must say so ("not enforced yet").
--  * emails to members (needs a verified email domain), payments, member import/export, data purge rules.

create table if not exists public.commerce_member_tiers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  perks text check (perks is null or length(perks) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists commerce_member_tiers_store_name_idx
  on public.commerce_member_tiers (storefront_id, lower(btrim(name)));

create table if not exists public.commerce_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  tier_id uuid not null references public.commerce_member_tiers(id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name text check (full_name is null or length(full_name) <= 160),
  phone text check (phone is null or length(phone) <= 80),
  status text not null default 'active' check (status in ('active','paused','ended')),
  renews_on date,
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, email)
);
create index if not exists commerce_members_store_status_idx on public.commerce_members (storefront_id, status, renews_on);

create table if not exists public.commerce_member_only_products (
  product_id uuid primary key references public.commerce_products(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists commerce_member_only_products_store_idx on public.commerce_member_only_products (storefront_id);

alter table public.commerce_member_tiers enable row level security;
alter table public.commerce_members enable row level security;
alter table public.commerce_member_only_products enable row level security;
revoke all on table public.commerce_member_tiers from public, anon, authenticated;
revoke all on table public.commerce_members from public, anon, authenticated;
revoke all on table public.commerce_member_only_products from public, anon, authenticated;

-- Internal helper: the signed-in client's own storefront. Not callable by any API role.
create or replace function public.nxq_member_owner_store()
returns table (owner_client uuid, owner_storefront uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid := public.current_client_id();
  store_uuid uuid;
begin
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select s.id into store_uuid from public.commerce_storefronts s where s.client_id = client_uuid order by s.created_at limit 1;
  if store_uuid is null then raise exception 'Create your storefront first.'; end if;
  return query select client_uuid, store_uuid;
end;
$$;

-- Rejects control characters (tabs and newlines are allowed in notes only through the caller; here none are).
create or replace function public.nxq_member_bad_chars(value text)
returns boolean
language sql
immutable
as $$ select coalesce(value ~ '[[:cntrl:]]', false); $$;

create or replace function public.list_my_membership()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare ctx record;
begin
  select * into ctx from public.nxq_member_owner_store();
  return jsonb_build_object(
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'perks', t.perks, 'active', t.active) order by t.created_at)
                       from public.commerce_member_tiers t where t.storefront_id = ctx.owner_storefront), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'email', m.email, 'full_name', m.full_name, 'phone', m.phone, 'tier_id', m.tier_id,
                                                              'status', m.status, 'renews_on', m.renews_on, 'notes', m.notes) order by m.renews_on nulls last, m.email)
                         from (select * from public.commerce_members x where x.storefront_id = ctx.owner_storefront order by x.renews_on nulls last, x.email limit 2000) m), '[]'::jsonb),
    'members_only_product_ids', coalesce((select jsonb_agg(p.product_id) from public.commerce_member_only_products p where p.storefront_id = ctx.owner_storefront), '[]'::jsonb),
    'enforced', false
  );
end;
$$;

create or replace function public.save_my_member_tier(tier_id_value uuid, name_value text, perks_value text, active_value boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  clean_name text := btrim(coalesce(name_value, ''));
  clean_perks text := nullif(btrim(coalesce(perks_value, '')), '');
  tier_uuid uuid;
begin
  select * into ctx from public.nxq_member_owner_store();
  if length(clean_name) < 1 or length(clean_name) > 80 then raise exception 'Tier name must be 1 to 80 characters.'; end if;
  if clean_perks is not null and length(clean_perks) > 500 then raise exception 'Perks must be 500 characters or fewer.'; end if;
  if public.nxq_member_bad_chars(clean_name) then raise exception 'Tier name has characters that are not allowed.'; end if;
  if active_value is null then raise exception 'Choose active or paused.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('member-tier:' || ctx.owner_storefront::text, 0));

  if tier_id_value is null then
    if (select count(*) from public.commerce_member_tiers where storefront_id = ctx.owner_storefront) >= 10 then
      raise exception 'You can have up to 10 tiers.';
    end if;
    begin
      insert into public.commerce_member_tiers (client_id, storefront_id, name, perks, active)
      values (ctx.owner_client, ctx.owner_storefront, clean_name, clean_perks, active_value)
      returning id into tier_uuid;
    exception when unique_violation then
      raise exception 'You already have a tier with that name.';
    end;
  else
    begin
      update public.commerce_member_tiers
      set name = clean_name, perks = clean_perks, active = active_value, updated_at = now()
      where id = tier_id_value and storefront_id = ctx.owner_storefront
      returning id into tier_uuid;
    exception when unique_violation then
      raise exception 'You already have a tier with that name.';
    end;
    if tier_uuid is null then raise exception 'Tier not found.'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', tier_uuid);
end;
$$;

create or replace function public.save_my_member(
  member_id_value uuid, email_value text, name_value text, phone_value text,
  tier_id_value uuid, status_value text, renews_on_value date, notes_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  clean_email text := lower(btrim(coalesce(email_value, '')));
  clean_name text := nullif(btrim(coalesce(name_value, '')), '');
  clean_phone text := nullif(btrim(coalesce(phone_value, '')), '');
  clean_notes text := nullif(btrim(coalesce(notes_value, '')), '');
  member_uuid uuid;
begin
  select * into ctx from public.nxq_member_owner_store();
  if length(clean_email) > 254 or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address.'; end if;
  if clean_name is not null and length(clean_name) > 160 then raise exception 'Name must be 160 characters or fewer.'; end if;
  if clean_phone is not null and length(clean_phone) > 80 then raise exception 'Phone must be 80 characters or fewer.'; end if;
  if clean_notes is not null and length(clean_notes) > 500 then raise exception 'Notes must be 500 characters or fewer.'; end if;
  if public.nxq_member_bad_chars(clean_email) or public.nxq_member_bad_chars(clean_name) or public.nxq_member_bad_chars(clean_phone) then
    raise exception 'Some characters are not allowed.';
  end if;
  if status_value is null or status_value not in ('active','paused','ended') then raise exception 'Status must be active, paused or ended.'; end if;
  if renews_on_value is not null and (renews_on_value < current_date - 3650 or renews_on_value > current_date + 3650) then
    raise exception 'Renewal date looks wrong.';
  end if;
  if tier_id_value is null or not exists (select 1 from public.commerce_member_tiers t where t.id = tier_id_value and t.storefront_id = ctx.owner_storefront) then
    raise exception 'Choose one of your tiers.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('member:' || ctx.owner_storefront::text, 0));

  if member_id_value is null then
    if (select count(*) from public.commerce_members where storefront_id = ctx.owner_storefront) >= 2000 then
      raise exception 'You have reached the 2000 member limit.';
    end if;
    begin
      insert into public.commerce_members (client_id, storefront_id, tier_id, email, full_name, phone, status, renews_on, notes)
      values (ctx.owner_client, ctx.owner_storefront, tier_id_value, clean_email, clean_name, clean_phone, status_value, renews_on_value, clean_notes)
      returning id into member_uuid;
    exception when unique_violation then
      raise exception 'That email is already a member.';
    end;
  else
    begin
      update public.commerce_members
      set tier_id = tier_id_value, email = clean_email, full_name = clean_name, phone = clean_phone,
          status = status_value, renews_on = renews_on_value, notes = clean_notes, updated_at = now()
      where id = member_id_value and storefront_id = ctx.owner_storefront
      returning id into member_uuid;
    exception when unique_violation then
      raise exception 'That email is already a member.';
    end;
    if member_uuid is null then raise exception 'Member not found.'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', member_uuid);
end;
$$;

create or replace function public.remove_my_member(member_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  removed integer;
begin
  select * into ctx from public.nxq_member_owner_store();
  delete from public.commerce_members where id = member_id_value and storefront_id = ctx.owner_storefront;
  get diagnostics removed = row_count;
  if removed = 0 then raise exception 'Member not found.'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_my_product_members_only(product_id_value uuid, members_only boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare ctx record;
begin
  select * into ctx from public.nxq_member_owner_store();
  if members_only is null then raise exception 'Choose on or off.'; end if;
  if not exists (select 1 from public.commerce_products p where p.id = product_id_value and p.storefront_id = ctx.owner_storefront) then
    raise exception 'Product not found.';
  end if;
  if members_only then
    insert into public.commerce_member_only_products (product_id, storefront_id) values (product_id_value, ctx.owner_storefront)
    on conflict (product_id) do nothing;
  else
    delete from public.commerce_member_only_products where product_id = product_id_value and storefront_id = ctx.owner_storefront;
  end if;
  return jsonb_build_object('ok', true, 'members_only', members_only, 'enforced', false);
end;
$$;

-- A signed-in shopper asks "am I a member here?". Same rules as the other shopper functions: accounts on, confirmed email, nothing about anyone else.
create or replace function public.get_my_membership_status(store_slug_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ctx record;
  m record;
begin
  select * into ctx from public.nxq_shopper_context(store_slug_value);
  select mem.status, mem.renews_on, t.name as tier_name, t.perks as tier_perks, t.active as tier_active
  into m
  from public.commerce_members mem
  join public.commerce_member_tiers t on t.id = mem.tier_id
  where mem.storefront_id = ctx.shopper_storefront and mem.email = ctx.shopper_email;

  if m.status is null then
    return jsonb_build_object('is_member', false);
  end if;
  return jsonb_build_object(
    'is_member', m.status = 'active' and m.tier_active,
    'status', m.status,
    'tier', m.tier_name,
    'perks', m.tier_perks,
    'renews_on', m.renews_on
  );
end;
$$;

revoke all on function public.nxq_member_owner_store() from public, anon, authenticated;
revoke all on function public.nxq_member_bad_chars(text) from public, anon, authenticated;
revoke all on function public.list_my_membership() from public, anon;
revoke all on function public.save_my_member_tier(uuid, text, text, boolean) from public, anon;
revoke all on function public.save_my_member(uuid, text, text, text, uuid, text, date, text) from public, anon;
revoke all on function public.remove_my_member(uuid) from public, anon;
revoke all on function public.set_my_product_members_only(uuid, boolean) from public, anon;
revoke all on function public.get_my_membership_status(text) from public, anon;
grant execute on function public.list_my_membership() to authenticated;
grant execute on function public.save_my_member_tier(uuid, text, text, boolean) to authenticated;
grant execute on function public.save_my_member(uuid, text, text, text, uuid, text, date, text) to authenticated;
grant execute on function public.remove_my_member(uuid) to authenticated;
grant execute on function public.set_my_product_members_only(uuid, boolean) to authenticated;
grant execute on function public.get_my_membership_status(text) to authenticated;
