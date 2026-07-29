-- NXQ Commerce foundation.
-- Adds tenant-isolated commerce records without enabling public storefront checkout.
-- Commerce remains planned until intake, portal, storefront, and QA flows are complete.

create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clients.id
  from public.clients
  where clients.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_nxq_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
$$;

revoke all on function public.current_client_id() from public, anon;
revoke all on function public.is_nxq_owner() from public, anon;
grant execute on function public.current_client_id() to authenticated;
grant execute on function public.is_nxq_owner() to authenticated;

create table if not exists public.commerce_storefronts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  store_name text not null,
  store_slug text not null,
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  locale text not null default 'en-US',
  status text not null default 'setup_pending'
    check (status in ('setup_pending','draft','review','active','paused','disabled')),
  inventory_tracking_enabled boolean not null default true,
  allow_backorders boolean not null default false,
  guest_checkout_enabled boolean not null default true,
  customer_accounts_enabled boolean not null default false,
  tax_mode text not null default 'manual'
    check (tax_mode in ('manual','provider','disabled')),
  shipping_mode text not null default 'manual'
    check (shipping_mode in ('manual','provider','pickup_only','disabled')),
  payment_mode text not null default 'not_connected'
    check (payment_mode in ('not_connected','test','live')),
  payment_provider text,
  provider_account_reference text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(store_name)) > 0),
  check (store_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists commerce_storefronts_store_slug_idx
  on public.commerce_storefronts(store_slug);

create table if not exists public.commerce_categories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  parent_category_id uuid references public.commerce_categories(id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, slug),
  check (length(trim(name)) > 0),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.commerce_products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  category_id uuid references public.commerce_categories(id) on delete set null,
  name text not null,
  slug text not null,
  short_description text,
  description text,
  product_type text not null default 'physical'
    check (product_type in ('physical','digital','service')),
  status text not null default 'draft'
    check (status in ('draft','active','archived')),
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  sku text,
  barcode text,
  track_inventory boolean not null default true,
  requires_shipping boolean not null default true,
  taxable boolean not null default true,
  featured boolean not null default false,
  image_urls jsonb not null default '[]'::jsonb,
  seo_title text,
  seo_description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, slug),
  check (length(trim(name)) > 0),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists commerce_products_storefront_sku_idx
  on public.commerce_products(storefront_id, sku)
  where sku is not null;

create table if not exists public.commerce_product_variants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  title text not null,
  sku text,
  barcode text,
  option_values jsonb not null default '{}'::jsonb,
  price numeric(12,2) not null default 0 check (price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  inventory_quantity integer not null default 0,
  inventory_policy text not null default 'deny'
    check (inventory_policy in ('deny','continue')),
  weight_grams integer check (weight_grams is null or weight_grams >= 0),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(title)) > 0)
);

create unique index if not exists commerce_variants_storefront_sku_idx
  on public.commerce_product_variants(storefront_id, sku)
  where sku is not null;

create unique index if not exists commerce_variants_one_default_idx
  on public.commerce_product_variants(product_id)
  where is_default = true;

create table if not exists public.commerce_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  variant_id uuid references public.commerce_product_variants(id) on delete cascade,
  movement_type text not null
    check (movement_type in ('initial','adjustment','sale','return','restock','damage','reservation','release')),
  quantity_delta integer not null check (quantity_delta <> 0),
  quantity_after integer,
  reference_type text,
  reference_id uuid,
  note text,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.commerce_customers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  auth_user_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  accepts_marketing boolean not null default false,
  default_shipping_address jsonb,
  default_billing_address jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_customers_storefront_email_idx
  on public.commerce_customers(storefront_id, lower(email))
  where email is not null;

create unique index if not exists commerce_customers_storefront_auth_idx
  on public.commerce_customers(storefront_id, auth_user_id)
  where auth_user_id is not null;

create table if not exists public.commerce_carts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  customer_id uuid references public.commerce_customers(id) on delete set null,
  session_token_hash text,
  status text not null default 'active'
    check (status in ('active','converted','abandoned','expired')),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  shipping_total numeric(12,2) not null default 0 check (shipping_total >= 0),
  grand_total numeric(12,2) not null default 0 check (grand_total >= 0),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_cart_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  cart_id uuid not null references public.commerce_carts(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete restrict,
  variant_id uuid references public.commerce_product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  product_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id, variant_id)
);

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete restrict,
  customer_id uuid references public.commerce_customers(id) on delete set null,
  cart_id uuid references public.commerce_carts(id) on delete set null,
  order_number text not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','processing','fulfilled','completed','cancelled','refunded')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending','authorized','paid','partially_refunded','refunded','failed','cancelled')),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled','partial','fulfilled','returned','cancelled')),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  shipping_total numeric(12,2) not null default 0 check (shipping_total >= 0),
  grand_total numeric(12,2) not null default 0 check (grand_total >= 0),
  customer_email text,
  customer_name text,
  customer_phone text,
  shipping_address jsonb,
  billing_address jsonb,
  shipping_method text,
  payment_provider text,
  payment_reference text,
  owner_note text,
  customer_note text,
  metadata jsonb not null default '{}'::jsonb,
  placed_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, order_number)
);

create unique index if not exists commerce_orders_payment_reference_idx
  on public.commerce_orders(payment_provider, payment_reference)
  where payment_provider is not null and payment_reference is not null;

create table if not exists public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete restrict,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  product_id uuid references public.commerce_products(id) on delete set null,
  variant_id uuid references public.commerce_product_variants(id) on delete set null,
  product_name text not null,
  variant_name text,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  product_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(trim(product_name)) > 0)
);

create index if not exists commerce_categories_client_idx on public.commerce_categories(client_id, sort_order);
create index if not exists commerce_products_client_status_idx on public.commerce_products(client_id, status, created_at desc);
create index if not exists commerce_variants_product_idx on public.commerce_product_variants(product_id, is_active);
create index if not exists commerce_inventory_variant_created_idx on public.commerce_inventory_movements(variant_id, created_at desc);
create index if not exists commerce_customers_client_created_idx on public.commerce_customers(client_id, created_at desc);
create index if not exists commerce_carts_client_status_idx on public.commerce_carts(client_id, status, updated_at desc);
create index if not exists commerce_orders_client_created_idx on public.commerce_orders(client_id, created_at desc);
create index if not exists commerce_orders_client_status_idx on public.commerce_orders(client_id, status, payment_status);
create index if not exists commerce_order_items_order_idx on public.commerce_order_items(order_id);

create or replace function public.touch_commerce_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_commerce_updated_at() from public, anon;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'commerce_storefronts',
    'commerce_categories',
    'commerce_products',
    'commerce_product_variants',
    'commerce_customers',
    'commerce_carts',
    'commerce_cart_items',
    'commerce_orders'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'touch_' || table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_commerce_updated_at()',
      'touch_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end;
$$;

alter table public.commerce_storefronts enable row level security;
alter table public.commerce_categories enable row level security;
alter table public.commerce_products enable row level security;
alter table public.commerce_product_variants enable row level security;
alter table public.commerce_inventory_movements enable row level security;
alter table public.commerce_customers enable row level security;
alter table public.commerce_carts enable row level security;
alter table public.commerce_cart_items enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;

revoke all on table public.commerce_storefronts from public, anon;
revoke all on table public.commerce_categories from public, anon;
revoke all on table public.commerce_products from public, anon;
revoke all on table public.commerce_product_variants from public, anon;
revoke all on table public.commerce_inventory_movements from public, anon;
revoke all on table public.commerce_customers from public, anon;
revoke all on table public.commerce_carts from public, anon;
revoke all on table public.commerce_cart_items from public, anon;
revoke all on table public.commerce_orders from public, anon;
revoke all on table public.commerce_order_items from public, anon;

grant select, insert, update, delete on table public.commerce_storefronts to authenticated;
grant select, insert, update, delete on table public.commerce_categories to authenticated;
grant select, insert, update, delete on table public.commerce_products to authenticated;
grant select, insert, update, delete on table public.commerce_product_variants to authenticated;
grant select, insert, update, delete on table public.commerce_inventory_movements to authenticated;
grant select, insert, update, delete on table public.commerce_customers to authenticated;
grant select, insert, update, delete on table public.commerce_carts to authenticated;
grant select, insert, update, delete on table public.commerce_cart_items to authenticated;
grant select, insert, update, delete on table public.commerce_orders to authenticated;
grant select, insert, update, delete on table public.commerce_order_items to authenticated;

-- Owners may manage all Commerce data. Clients may manage only rows in their own workspace.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'commerce_storefronts',
    'commerce_categories',
    'commerce_products',
    'commerce_product_variants',
    'commerce_inventory_movements',
    'commerce_customers',
    'commerce_carts',
    'commerce_cart_items',
    'commerce_orders',
    'commerce_order_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'owner_manage_' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_nxq_owner()) with check (public.is_nxq_owner())',
      'owner_manage_' || table_name,
      table_name
    );

    execute format('drop policy if exists %I on public.%I', 'client_manage_own_' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (client_id = public.current_client_id()) with check (client_id = public.current_client_id())',
      'client_manage_own_' || table_name,
      table_name
    );
  end loop;
end;
$$;

-- Keep Commerce unavailable publicly until the full client and storefront flow passes QA.
update public.product_families
set public_status = 'planned',
    is_active = true,
    updated_at = now()
where slug = 'commerce';

update public.product_family_tiers tier
set public_status = 'planned',
    is_active = true,
    updated_at = now()
from public.product_families family
where family.id = tier.product_family_id
  and family.slug = 'commerce';

comment on table public.commerce_storefronts is 'Per-client Commerce storefront configuration. No live payment connection is enabled by this migration.';
comment on table public.commerce_products is 'Tenant-isolated Commerce product catalog.';
comment on table public.commerce_inventory_movements is 'Append-only inventory audit trail for Commerce products and variants.';
comment on table public.commerce_orders is 'Commerce order records with provider-ready payment references and guarded tenant access.';
comment on table public.commerce_order_items is 'Immutable order-time product snapshots so historical orders remain accurate after catalog edits.';
