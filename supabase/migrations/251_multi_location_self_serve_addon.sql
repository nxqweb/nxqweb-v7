-- Multi-Location self-serve add-on.
--
-- Rules (as decided): Starter gets one location. Growth and Intelligence can
-- self-serve add extra locations at $10/month each, up to 10 total.
-- Enterprise already includes multi-location (cap 100, unchanged) and is
-- required above 10. Billing is currently off system-wide, so this
-- migration makes no charge, no external connection, and does not touch
-- clients.monthly_price or billing_subscriptions.amount in any way -- base
-- price, add-on amount, and internal total are computed and displayed
-- separately, never merged into the actual billed amount. Folding the
-- add-on amount into real billing is an explicit, separately reviewed step
-- for whenever live billing is activated; nothing here bridges to it.
--
-- Investigated before writing this migration:
--   - resolve_client_plan_change() (migration 040) unconditionally resets
--     clients.monthly_price to the tier's flat list price on every
--     approved plan change, and migration 030 treats any drift from that
--     as a bug to repair. monthly_price must stay untouched by this
--     feature or a future plan-change approval would silently wipe any
--     add-on amount stored there.
--   - client_locations currently grants direct insert/update/delete to
--     authenticated with an RLS policy that checks ownership only, never
--     quantity or status transitions -- a client can bypass
--     current_client_create_location()'s tier cap with a raw table write
--     today. Closed with a BEFORE INSERT OR UPDATE trigger below that is
--     authoritative regardless of entry path.
--   - No self-serve "close a location" capability existed before this
--     migration; the cancellation rule below depends on one, so one is
--     added here.
--   - automation_escalations and automation_audit_log are both
--     effectively write-only from the owner's perspective (no page reads
--     either). Owner visibility for this feature is a dedicated RPC read
--     from real tables, not a repeat of that pattern.
--
-- This migration is staged for review; it has not been applied to any
-- database.

-- 1. Add-on entitlement, one row per client. Writes only via the
--    SECURITY DEFINER RPCs below -- authenticated gets SELECT only, so a
--    direct table write cannot silently grant units.
create table if not exists public.client_location_addons (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled_units integer not null default 0 check (enabled_units between 0 and 9),
  unit_price_cents integer not null default 1000 check (unit_price_cents = 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_location_addons enable row level security;

revoke all on table public.client_location_addons from public, anon, authenticated;
grant select on table public.client_location_addons to authenticated;
grant select, insert, update, delete on table public.client_location_addons to service_role;

create policy owner_read_client_location_addons
on public.client_location_addons for select to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));

create policy client_read_own_location_addons
on public.client_location_addons for select to authenticated
using (exists (select 1 from public.clients c where c.id = client_location_addons.client_id and c.auth_user_id = auth.uid()));

-- 2. Append-only audit trail of enable/cancel actions, for genuine owner
--    portal visibility (not a write-only dead end).
create table if not exists public.client_location_addon_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null check (event_type in ('enabled', 'cancelled')),
  unit_price_cents integer not null,
  resulting_enabled_units integer not null,
  billing_live_at_event boolean not null default false,
  occurred_at timestamptz not null default now()
);

create index if not exists client_location_addon_events_client_idx
  on public.client_location_addon_events (client_id, occurred_at desc);

alter table public.client_location_addon_events enable row level security;

revoke all on table public.client_location_addon_events from public, anon, authenticated;
grant select on table public.client_location_addon_events to authenticated;
grant select, insert on table public.client_location_addon_events to service_role;

create policy owner_read_location_addon_events
on public.client_location_addon_events for select to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));

create policy client_read_own_location_addon_events
on public.client_location_addon_events for select to authenticated
using (exists (select 1 from public.clients c where c.id = client_location_addon_events.client_id and c.auth_user_id = auth.uid()));

-- 3. Authoritative cap enforcement, regardless of entry path (RPC or a
--    direct table write). Only runs when the operation could increase a
--    client's active location count: a fresh insert, reopening a closed
--    location, or reassigning a location to a different client. A plain
--    edit to an already-grandfathered, over-cap location is left alone.
create or replace function public.enforce_client_location_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  needs_check boolean;
  tier_key_value text;
  addon_units integer;
  effective_cap integer;
  active_count integer;
begin
  needs_check := (tg_op = 'INSERT' and new.status <> 'closed')
    or (tg_op = 'UPDATE' and new.status <> 'closed'
        and (old.status = 'closed' or old.client_id is distinct from new.client_id));

  if not needs_check then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-location-capacity:' || new.client_id::text, 0));

  select tier.tier_key into tier_key_value
  from public.clients c
  join public.product_family_tiers tier
    on tier.id = c.product_tier_id and tier.product_family_id = c.product_family_id
  where c.id = new.client_id;

  if tier_key_value is null then
    raise exception 'Client tier could not be resolved for location limit enforcement.';
  end if;

  select coalesce(enabled_units, 0) into addon_units
  from public.client_location_addons
  where client_id = new.client_id;

  effective_cap := case
    when tier_key_value = 'enterprise' then 100
    when tier_key_value in ('growth', 'intelligence') then 1 + coalesce(addon_units, 0)
    else 1
  end;

  select count(*) into active_count
  from public.client_locations
  where client_id = new.client_id
    and status <> 'closed'
    and id is distinct from new.id;

  if active_count + 1 > effective_cap then
    raise exception 'Location limit reached for this plan (%). Close an existing location, enable a self-serve add-on, or contact NXQ about Enterprise.', effective_cap;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_client_location_limit on public.client_locations;
create trigger enforce_client_location_limit
before insert or update on public.client_locations
for each row execute function public.enforce_client_location_limit();

-- 4. current_client_create_location(): identical to migration 185's
--    version except the location_limit formula now accounts for
--    self-serve add-on units on Growth/Intelligence.
create or replace function public.current_client_create_location(
  target_display_name text,
  target_city text,
  target_state_region text,
  target_postal_code text default null,
  target_phone text default null,
  target_email text default null,
  target_service_area text default null,
  target_services text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  tier_key_value text;
  addon_units_value integer;
  location_row public.client_locations%rowtype;
  display_value text:=btrim(coalesce(target_display_name,''));
  city_value text:=btrim(coalesce(target_city,''));
  region_value text:=btrim(coalesce(target_state_region,''));
  postal_value text:=nullif(btrim(coalesce(target_postal_code,'')),'');
  phone_value text:=nullif(btrim(coalesce(target_phone,'')),'');
  email_value text:=nullif(lower(btrim(coalesce(target_email,''))),'');
  area_value text:=nullif(btrim(coalesce(target_service_area,'')),'');
  base_slug text;
  slug_value text;
  code_value text;
  location_count integer;
  location_limit integer;
  service_value text;
  service_slug_value text;
  normalized_services text[]:=array[]::text[];
begin
  if auth.role()<>'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id=auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;
  if client_row.qa_only or client_row.pipeline_stopped_at is not null
     or client_row.status::text not in ('approved','active') then
    raise exception 'Client lifecycle does not allow location changes.';
  end if;
  select tier_key into tier_key_value from public.product_family_tiers
  where id=client_row.product_tier_id and product_family_id=client_row.product_family_id;
  if tier_key_value is null then raise exception 'An active Business tier is required.'; end if;
  select coalesce(enabled_units,0) into addon_units_value from public.client_location_addons where client_id=client_row.id;
  location_limit:=case
    when tier_key_value='enterprise' then 100
    when tier_key_value in ('growth','intelligence') then 1+coalesce(addon_units_value,0)
    else 1
  end;
  select count(*) into location_count from public.client_locations
  where client_id=client_row.id and status<>'closed';
  if location_count>=location_limit then
    raise exception 'Current plan location limit reached (%). Enable a self-serve add-on or request Enterprise for more.',location_limit;
  end if;
  if display_value='' then display_value:=concat_ws(', ',city_value,region_value); end if;
  if length(display_value) not between 2 and 120
     or length(city_value) not between 2 and 100
     or length(region_value) not between 2 and 100 then
    raise exception 'Location name, city, and state/region are required.';
  end if;
  if postal_value is not null and length(postal_value)>20 then raise exception 'Postal code is too long.'; end if;
  if phone_value is not null and (length(phone_value)>40 or phone_value !~ '^[0-9+(). xX-]+$') then
    raise exception 'Phone number contains unsupported characters.';
  end if;
  if email_value is not null and (length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Email address is invalid.';
  end if;
  if area_value is not null and length(area_value)>500 then raise exception 'Service area is too long.'; end if;
  if coalesce(array_length(target_services,1),0)>30 then raise exception 'A location supports at most 30 services.'; end if;

  foreach service_value in array coalesce(target_services,array[]::text[]) loop
    service_value:=btrim(service_value);
    if service_value<>'' and length(service_value)<=120 and not service_value=any(normalized_services) then
      normalized_services:=array_append(normalized_services,service_value);
    end if;
  end loop;

  base_slug:=left(trim(both '-' from regexp_replace(lower(city_value||'-'||region_value||'-'||display_value),'[^a-z0-9]+','-','g')),80);
  if base_slug='' then base_slug:='location'; end if;
  slug_value:=base_slug;
  if exists(select 1 from public.client_locations where client_id=client_row.id and seo_slug=slug_value) then
    slug_value:=left(base_slug,80)||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  end if;
  code_value:='LOC-'||upper(left(regexp_replace(slug_value,'[^a-z0-9]','','g'),12))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.client_locations(
    client_id,location_code,display_name,is_primary,status,city,state_region,
    postal_code,phone,email,service_area,seo_slug,seo_title,seo_description
  ) values(
    client_row.id,code_value,display_value,location_count=0,'active',city_value,region_value,
    postal_value,phone_value,email_value,area_value,slug_value,
    left(display_value||' | '||city_value||', '||region_value,160),
    left('Professional services from '||display_value||' in '||city_value||', '||region_value||'.',155)
  ) returning * into location_row;

  foreach service_value in array normalized_services loop
    service_slug_value:=left(trim(both '-' from regexp_replace(lower(service_value),'[^a-z0-9]+','-','g')),100);
    if service_slug_value<>'' then
      insert into public.client_location_services(
        client_id,location_id,service_name,service_slug,summary
      ) values(
        client_row.id,location_row.id,service_value,service_slug_value,
        left(service_value||' available from this location.',500)
      ) on conflict(location_id,service_slug) do nothing;
    end if;
  end loop;

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(client_row.id,'client_location_created','client',jsonb_build_object(
    'location_id',location_row.id,'location_code',location_row.location_code,
    'seo_slug',location_row.seo_slug,'service_count',cardinality(normalized_services),
    'tier_key',tier_key_value,'location_limit',location_limit,'atomic',true
  ));
  return jsonb_build_object('ok',true,'location',to_jsonb(location_row),'service_count',cardinality(normalized_services));
end;
$$;

-- 5. current_client_close_location(): the missing self-serve capability the
--    cancellation rule depends on. Never deletes a row, only marks it
--    closed. Refuses to close the primary location while any other active
--    location exists, to avoid an ambiguous primary-reassignment case.
create or replace function public.current_client_close_location(target_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  location_row public.client_locations%rowtype;
  other_active_count integer;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id = auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;

  select * into location_row from public.client_locations
  where id = target_location_id and client_id = client_row.id
  for update;
  if not found then raise exception 'Location not found.'; end if;
  if location_row.status = 'closed' then
    raise exception 'This location is already closed.';
  end if;

  if location_row.is_primary then
    select count(*) into other_active_count from public.client_locations
    where client_id = client_row.id and status <> 'closed' and id <> location_row.id;
    if other_active_count > 0 then
      raise exception 'Choose a non-primary location to close, or contact NXQ to change your primary location first.';
    end if;
  end if;

  update public.client_locations
  set status = 'closed', updated_at = now()
  where id = location_row.id;

  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (client_row.id, 'client_location_closed', 'client',
    jsonb_build_object('location_id', location_row.id, 'location_code', location_row.location_code));

  return jsonb_build_object('ok', true, 'location_id', location_row.id, 'status', 'closed');
end;
$$;

revoke all on function public.current_client_close_location(uuid) from public, anon;
grant execute on function public.current_client_close_location(uuid) to authenticated;

-- 6. current_client_enable_location_addon(): self-serve, instant, no owner
--    approval. Never touches clients.monthly_price or
--    billing_subscriptions.amount -- base/add-on/total are returned as
--    plain computed numbers for display only.
create or replace function public.current_client_enable_location_addon()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  tier_key_value text;
  addon_row public.client_location_addons%rowtype;
  new_units integer;
  billing_live boolean;
  base_price_cents bigint;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id = auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;
  if client_row.qa_only or client_row.pipeline_stopped_at is not null
     or client_row.status::text not in ('approved','active') then
    raise exception 'Client lifecycle does not allow location add-on changes.';
  end if;

  select tier_key into tier_key_value from public.product_family_tiers
  where id = client_row.product_tier_id and product_family_id = client_row.product_family_id;
  if tier_key_value is null then raise exception 'An active Business tier is required.'; end if;
  if tier_key_value not in ('growth', 'intelligence') then
    raise exception 'Location add-ons are available on Growth and Intelligence plans. Starter includes one location; Enterprise already includes multi-location.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-location-capacity:' || client_row.id::text, 0));

  insert into public.client_location_addons (client_id, enabled_units)
  values (client_row.id, 0)
  on conflict (client_id) do nothing;

  select * into addon_row from public.client_location_addons where client_id = client_row.id for update;

  if 1 + addon_row.enabled_units >= 10 then
    raise exception 'Maximum self-serve locations reached (10 total). Contact NXQ about Enterprise for more.';
  end if;

  new_units := addon_row.enabled_units + 1;
  update public.client_location_addons
  set enabled_units = new_units, updated_at = now()
  where client_id = client_row.id;

  select coalesce((config->>'online_billing_enabled')::boolean, false) into billing_live
  from public.nxq_provider_connections
  where provider_key = 'stripe' and scope_type = 'global' and scope_id is null;

  insert into public.client_location_addon_events (client_id, event_type, unit_price_cents, resulting_enabled_units, billing_live_at_event)
  values (client_row.id, 'enabled', 1000, new_units, coalesce(billing_live, false));

  base_price_cents := round(coalesce(client_row.monthly_price, 0) * 100);

  return jsonb_build_object(
    'ok', true,
    'enabled_units', new_units,
    'unit_price_cents', 1000,
    'base_price_cents', base_price_cents,
    'addon_amount_cents', new_units * 1000,
    'internal_total_cents', base_price_cents + new_units * 1000,
    'message', 'Location add-on enabled. No charge has been made -- this will add $10/month to your bill only once NXQ turns on live billing.'
  );
end;
$$;

revoke all on function public.current_client_enable_location_addon() from public, anon;
grant execute on function public.current_client_enable_location_addon() to authenticated;

-- 7. current_client_cancel_location_addon(): only path is immediate
--    cancellation, gated on current active locations already fitting the
--    lower limit. No live-billing branch -- that stays for the reviewed
--    billing activation work, not built here untested.
create or replace function public.current_client_cancel_location_addon()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  addon_row public.client_location_addons%rowtype;
  new_units integer;
  new_cap integer;
  active_count integer;
  billing_live boolean;
  base_price_cents bigint;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id = auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('client-location-capacity:' || client_row.id::text, 0));

  select * into addon_row from public.client_location_addons where client_id = client_row.id for update;
  if not found or addon_row.enabled_units <= 0 then
    raise exception 'There is no active location add-on to cancel.';
  end if;

  new_units := addon_row.enabled_units - 1;
  new_cap := 1 + new_units;

  select count(*) into active_count from public.client_locations
  where client_id = client_row.id and status <> 'closed';

  if active_count > new_cap then
    raise exception 'You have % active locations but this plan would only allow %. Close a location first, then cancel this add-on. NXQ never closes a location automatically.', active_count, new_cap;
  end if;

  update public.client_location_addons
  set enabled_units = new_units, updated_at = now()
  where client_id = client_row.id;

  select coalesce((config->>'online_billing_enabled')::boolean, false) into billing_live
  from public.nxq_provider_connections
  where provider_key = 'stripe' and scope_type = 'global' and scope_id is null;

  insert into public.client_location_addon_events (client_id, event_type, unit_price_cents, resulting_enabled_units, billing_live_at_event)
  values (client_row.id, 'cancelled', 1000, new_units, coalesce(billing_live, false));

  base_price_cents := round(coalesce(client_row.monthly_price, 0) * 100);

  return jsonb_build_object(
    'ok', true,
    'enabled_units', new_units,
    'unit_price_cents', 1000,
    'base_price_cents', base_price_cents,
    'addon_amount_cents', new_units * 1000,
    'internal_total_cents', base_price_cents + new_units * 1000,
    'message', 'Location add-on cancelled immediately. Billing is currently off, so no refund is applicable.'
  );
end;
$$;

revoke all on function public.current_client_cancel_location_addon() from public, anon;
grant execute on function public.current_client_cancel_location_addon() to authenticated;

-- 8. current_client_locations(): identical to migration 132's version,
--    extended to also return tier/cap/add-on/total fields so the client UI
--    can render entitlement, over-entitlement, and the enable/cancel
--    controls without an extra round trip. The locations array itself and
--    its "status <> 'closed'" filter are unchanged.
create or replace function public.current_client_locations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  tier_key_value text;
  addon_units integer;
  effective_cap integer;
  active_count integer;
  base_price_cents bigint;
  payload jsonb;
begin
  select * into client_row from public.clients where auth_user_id = auth.uid() order by created_at desc limit 1;
  if client_row.id is null then raise exception 'Client account not found.'; end if;

  select tier_key into tier_key_value from public.product_family_tiers
  where id = client_row.product_tier_id and product_family_id = client_row.product_family_id;

  select coalesce(enabled_units, 0) into addon_units
  from public.client_location_addons where client_id = client_row.id;
  addon_units := coalesce(addon_units, 0);

  effective_cap := case
    when tier_key_value = 'enterprise' then 100
    when tier_key_value in ('growth', 'intelligence') then 1 + addon_units
    else 1
  end;

  select count(*) into active_count from public.client_locations
  where client_id = client_row.id and status <> 'closed';

  base_price_cents := round(coalesce(client_row.monthly_price, 0) * 100);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'location_code', l.location_code,
    'display_name', l.display_name,
    'is_primary', l.is_primary,
    'status', l.status,
    'city', l.city,
    'state_region', l.state_region,
    'postal_code', l.postal_code,
    'country_code', l.country_code,
    'phone', l.phone,
    'email', l.email,
    'service_area', l.service_area,
    'seo_slug', l.seo_slug,
    'seo_title', l.seo_title,
    'seo_description', l.seo_description,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.service_name, 'slug', s.service_slug, 'summary', s.summary) order by s.service_name)
      from public.client_location_services s
      where s.location_id = l.id and s.active = true
    ), '[]'::jsonb)
  ) order by l.is_primary desc, l.display_name), '[]'::jsonb)
  into payload
  from public.client_locations l
  where l.client_id = client_row.id and l.status <> 'closed';

  return jsonb_build_object(
    'client_id', client_row.id,
    'locations', payload,
    'tier_key', tier_key_value,
    'active_location_count', active_count,
    'effective_cap', effective_cap,
    'over_entitlement', active_count > effective_cap,
    'enabled_addon_units', addon_units,
    'can_enable_addon', tier_key_value in ('growth', 'intelligence') and addon_units < 9,
    'can_cancel_addon', addon_units > 0,
    'unit_price_cents', 1000,
    'base_price_cents', base_price_cents,
    'addon_amount_cents', addon_units * 1000,
    'internal_total_cents', base_price_cents + addon_units * 1000,
    'generated_at', now()
  );
end;
$$;

-- 9. owner_location_addon_overview(): genuine owner-portal visibility --
--    per-client base/add-on/total, a live over-entitlement list (catches
--    Starter downgrades and any other path to being over cap, computed
--    fresh every call rather than relying on a stored flag), and the last
--    50 enable/cancel events.
create or replace function public.owner_location_addon_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;

  return jsonb_build_object(
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', c.id,
        'business_name', c.business_name,
        'tier_key', tier.tier_key,
        'base_price_cents', round(coalesce(c.monthly_price, 0) * 100),
        'enabled_units', coalesce(addon.enabled_units, 0),
        'addon_amount_cents', coalesce(addon.enabled_units, 0) * 1000,
        'internal_total_cents', round(coalesce(c.monthly_price, 0) * 100) + coalesce(addon.enabled_units, 0) * 1000,
        'active_location_count', (select count(*) from public.client_locations loc where loc.client_id = c.id and loc.status <> 'closed'),
        'effective_cap', case
          when tier.tier_key = 'enterprise' then 100
          when tier.tier_key in ('growth', 'intelligence') then 1 + coalesce(addon.enabled_units, 0)
          else 1
        end
      ) order by c.business_name)
      from public.clients c
      join public.product_family_tiers tier
        on tier.id = c.product_tier_id and tier.product_family_id = c.product_family_id
      left join public.client_location_addons addon on addon.client_id = c.id
      where coalesce(addon.enabled_units, 0) > 0
         or exists (select 1 from public.client_locations loc where loc.client_id = c.id and loc.status <> 'closed')
    ), '[]'::jsonb),
    'over_entitlement', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', c.id,
        'business_name', c.business_name,
        'tier_key', tier.tier_key,
        'active_location_count', loc_count.active_count,
        'effective_cap', loc_count.effective_cap
      ) order by c.business_name)
      from public.clients c
      join public.product_family_tiers tier
        on tier.id = c.product_tier_id and tier.product_family_id = c.product_family_id
      left join public.client_location_addons addon on addon.client_id = c.id
      join lateral (
        select
          (select count(*) from public.client_locations loc where loc.client_id = c.id and loc.status <> 'closed') as active_count,
          case
            when tier.tier_key = 'enterprise' then 100
            when tier.tier_key in ('growth', 'intelligence') then 1 + coalesce(addon.enabled_units, 0)
            else 1
          end as effective_cap
      ) loc_count on true
      where loc_count.active_count > loc_count.effective_cap
    ), '[]'::jsonb),
    'recent_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', e.client_id,
        'business_name', c.business_name,
        'event_type', e.event_type,
        'resulting_enabled_units', e.resulting_enabled_units,
        'billing_live_at_event', e.billing_live_at_event,
        'occurred_at', e.occurred_at
      ) order by e.occurred_at desc)
      from (select * from public.client_location_addon_events order by occurred_at desc limit 50) e
      join public.clients c on c.id = e.client_id
    ), '[]'::jsonb),
    'generated_at', now()
  );
end;
$$;

revoke all on function public.owner_location_addon_overview() from public, anon, authenticated;
grant execute on function public.owner_location_addon_overview() to authenticated, service_role;
