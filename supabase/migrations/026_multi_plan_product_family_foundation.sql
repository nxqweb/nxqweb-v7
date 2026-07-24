-- Shared NXQ Web product-family and tier foundation.
-- Separates the website product family (Business, Booking, Commerce, etc.)
-- from the service tier (Starter, Growth, Intelligence, Enterprise).
-- Existing clients and projects are safely backfilled to NXQ Business.

create table if not exists public.product_families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  public_status text not null default 'planned'
    check (public_status in ('available', 'beta', 'planned', 'private')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0),
  check (length(trim(slug)) > 0)
);

create table if not exists public.product_family_tiers (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid not null
    references public.product_families(id) on delete cascade,
  tier_key text not null
    check (tier_key in ('starter', 'growth', 'intelligence', 'enterprise')),
  name text not null,
  monthly_price numeric(10,2),
  price_label text,
  description text,
  features jsonb not null default '[]'::jsonb,
  intake_schema jsonb not null default '{}'::jsonb,
  portal_modules jsonb not null default '[]'::jsonb,
  build_instructions jsonb not null default '{}'::jsonb,
  public_status text not null default 'planned'
    check (public_status in ('available', 'beta', 'planned', 'private')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_family_id, tier_key),
  check (monthly_price is null or monthly_price >= 0),
  check (length(trim(name)) > 0)
);

create index if not exists product_families_status_sort_idx
  on public.product_families(public_status, sort_order);

create index if not exists product_family_tiers_family_sort_idx
  on public.product_family_tiers(product_family_id, sort_order);

create or replace function public.touch_product_catalog_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_product_families_updated_at
  on public.product_families;
create trigger touch_product_families_updated_at
before update on public.product_families
for each row execute function public.touch_product_catalog_updated_at();

drop trigger if exists touch_product_family_tiers_updated_at
  on public.product_family_tiers;
create trigger touch_product_family_tiers_updated_at
before update on public.product_family_tiers
for each row execute function public.touch_product_catalog_updated_at();

alter table public.clients
  add column if not exists product_family_id uuid
    references public.product_families(id) on delete set null,
  add column if not exists product_tier_id uuid
    references public.product_family_tiers(id) on delete set null;

alter table public.projects
  add column if not exists product_family_id uuid
    references public.product_families(id) on delete set null,
  add column if not exists product_tier_id uuid
    references public.product_family_tiers(id) on delete set null;

alter table public.client_intakes
  add column if not exists product_family_slug text,
  add column if not exists product_tier_key text;

insert into public.product_families
  (name, slug, description, public_status, sort_order)
values
  ('NXQ Business', 'business', 'Premium managed websites for service businesses, local companies, contractors, and growing brands.', 'available', 10),
  ('NXQ Booking', 'booking', 'Website systems with appointments, availability, reminders, cancellations, and scheduling workflows.', 'planned', 20),
  ('NXQ Commerce', 'commerce', 'Website systems with products, carts, checkout, orders, inventory, and customer accounts.', 'planned', 30),
  ('NXQ Menu', 'menu', 'Restaurant and hospitality websites with digital menus, specials, hours, locations, and ordering integrations.', 'planned', 40),
  ('NXQ Property', 'property', 'Property websites with searchable listings, agents, inquiries, and inventory management.', 'planned', 50),
  ('NXQ Multi-Location', 'multi-location', 'Unified websites with location-specific pages, teams, contact details, and local SEO.', 'planned', 60),
  ('NXQ Membership', 'membership', 'Member websites with accounts, subscriptions, gated content, dashboards, and renewals.', 'planned', 70),
  ('NXQ Enterprise Systems', 'enterprise-systems', 'Advanced custom website systems with permissions, integrations, departments, and infrastructure.', 'private', 80)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

with business_family as (
  select id from public.product_families where slug = 'business'
)
insert into public.product_family_tiers
  (product_family_id, tier_key, name, monthly_price, price_label, description, features, public_status, sort_order)
select business_family.id, values_table.tier_key, values_table.name,
       values_table.monthly_price, values_table.price_label,
       values_table.description, values_table.features::jsonb,
       values_table.public_status, values_table.sort_order
from business_family
cross join (values
  ('starter', 'Starter', 50::numeric, '$50/mo', 'Premium website essentials for small businesses.', '["Premium 1-3 page website","Mobile-responsive design","Basic SEO setup","Contact form","Client portal access","Manual update requests"]', 'available', 10),
  ('growth', 'Growth', 100::numeric, '$100/mo', 'A stronger SEO-focused website system for businesses that want more visibility and leads.', '["Everything in Starter","Up to 5 core pages","Service-area SEO sections","Monthly website/content improvements","Review and testimonial sections","SEO and content suggestions"]', 'available', 20),
  ('intelligence', 'Intelligence', 150::numeric, '$150/mo', 'Advanced optimization with behavior insights and conversion-focused monthly planning.', '["Everything in Growth","Click and scroll insights","Page interaction review","Monthly performance review","Layout improvement suggestions","Conversion-focused optimization notes"]', 'available', 30),
  ('enterprise', 'Enterprise', null::numeric, 'Custom', 'Custom website systems for larger and multi-location companies.', '["Multi-location SEO","Location-specific pages","Advanced reporting","Custom review workflows","Priority project support","Custom integrations"]', 'available', 40)
) as values_table(tier_key, name, monthly_price, price_label, description, features, public_status, sort_order)
on conflict (product_family_id, tier_key) do update set
  name = excluded.name,
  monthly_price = excluded.monthly_price,
  price_label = excluded.price_label,
  description = excluded.description,
  features = excluded.features,
  public_status = excluded.public_status,
  sort_order = excluded.sort_order;

-- Create the reusable four-tier shape for future families without claiming they are sellable yet.
insert into public.product_family_tiers
  (product_family_id, tier_key, name, price_label, description, public_status, sort_order)
select family.id, tier.tier_key, tier.name, 'Pricing in development',
       family.name || ' ' || tier.name || ' foundation.', 'planned', tier.sort_order
from public.product_families family
cross join (values
  ('starter', 'Starter', 10),
  ('growth', 'Growth', 20),
  ('intelligence', 'Intelligence', 30),
  ('enterprise', 'Enterprise', 40)
) as tier(tier_key, name, sort_order)
where family.slug <> 'business'
on conflict (product_family_id, tier_key) do nothing;

-- Backfill all existing records into the current NXQ Business family.
update public.clients
set product_family_id = family.id
from public.product_families family
where family.slug = 'business'
  and clients.product_family_id is null;

update public.projects
set product_family_id = coalesce(clients.product_family_id, family.id)
from public.clients clients
cross join public.product_families family
where projects.client_id = clients.id
  and family.slug = 'business'
  and projects.product_family_id is null;

update public.client_intakes
set product_family_slug = 'business'
where product_family_slug is null;

-- Map existing package records to the new Business tier catalog.
update public.clients
set product_tier_id = tier.id
from public.product_family_tiers tier
join public.product_families family on family.id = tier.product_family_id
left join public.packages package on package.id = clients.package_id
where family.slug = 'business'
  and clients.product_tier_id is null
  and tier.tier_key = case
    when package.slug = 'starter' then 'starter'
    when package.slug = 'growth' then 'growth'
    when package.slug in ('premium', 'intelligence') then 'intelligence'
    else 'starter'
  end;

update public.projects
set product_tier_id = clients.product_tier_id
from public.clients clients
where projects.client_id = clients.id
  and projects.product_tier_id is null;

alter table public.product_families enable row level security;
alter table public.product_family_tiers enable row level security;

revoke all on table public.product_families from public, anon;
revoke all on table public.product_family_tiers from public, anon;
grant select, insert, update, delete on table public.product_families to authenticated;
grant select, insert, update, delete on table public.product_family_tiers to authenticated;

-- Public visitors may read only active catalog entries intended for display.
grant select on table public.product_families to anon;
grant select on table public.product_family_tiers to anon;

drop policy if exists public_read_active_product_families on public.product_families;
create policy public_read_active_product_families
on public.product_families
for select
to anon, authenticated
using (is_active = true and public_status <> 'private');

drop policy if exists public_read_active_product_family_tiers on public.product_family_tiers;
create policy public_read_active_product_family_tiers
on public.product_family_tiers
for select
to anon, authenticated
using (is_active = true and public_status <> 'private');

drop policy if exists owner_manage_product_families on public.product_families;
create policy owner_manage_product_families
on public.product_families
for all
to authenticated
using (
  exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid())
);

drop policy if exists owner_manage_product_family_tiers on public.product_family_tiers;
create policy owner_manage_product_family_tiers
on public.product_family_tiers
for all
to authenticated
using (
  exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid())
);

revoke all on function public.touch_product_catalog_updated_at() from public, anon;

comment on table public.product_families is
  'NXQ Web product families such as Business, Booking, Commerce, Menu, Property, Multi-Location, Membership, and Enterprise Systems.';

comment on table public.product_family_tiers is
  'Reusable Starter, Growth, Intelligence, and Enterprise tiers belonging to one NXQ Web product family.';
