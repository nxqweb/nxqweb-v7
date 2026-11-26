-- Forward-only fix for a trigger conflict found in a read-only review of
-- migration 251 (Multi-Location self-serve add-on), before 251 has been
-- applied to any database.
--
-- The conflict: client_locations already carried a BEFORE INSERT trigger,
-- nxq_enforce_location_entitlement() (migration 246), which hardcodes the
-- non-enterprise location cap at 1 with no awareness of
-- client_location_addons. Migration 251 added a *second*, separate
-- BEFORE INSERT OR UPDATE trigger, enforce_client_location_limit(), whose
-- cap formula correctly accounts for enabled add-on units. Both triggers
-- fire on every INSERT; the untouched migration-246 trigger runs second
-- (alphabetically after "enforce_client_location_limit") and still
-- rejects any Growth/Intelligence client's second location regardless of
-- enabled add-on units. As staged, a client could enable and pay for an
-- add-on unit and still be unable to create the location it was supposed
-- to unlock.
--
-- The fix keeps exactly one authoritative trigger per operation type
-- instead of two overlapping ones:
--   - nxq_enforce_location_entitlement() keeps governing INSERT. Its
--     family/status/billing/pipeline guards are preserved verbatim,
--     unchanged from migration 246. Only its cap formula changes (adds
--     enabled add-on units for growth/intelligence) and its advisory
--     lock now uses the same namespace as the add-on RPCs, closing a
--     race where "enable add-on" and "insert second location" could
--     previously run under different locks and not serialize against
--     each other.
--   - enforce_client_location_limit() (migration 251) is narrowed to
--     only fire on the UPDATE cases it was actually needed for
--     (reopening a closed location, or reassigning client_id) -- the
--     plain-INSERT case it also checked is now fully and correctly
--     handled by the revised function above, so checking it twice was
--     redundant, not protective.
--
-- No data is migrated or backfilled: this only changes trigger/function
-- definitions, and both existing triggers only ever evaluate rows being
-- inserted or updated going forward, never rows already at rest.
--
-- This migration is staged for review; it has not been applied to any
-- database. It depends on migration 251 (client_location_addons) also
-- being applied in the same or an earlier run; both are still unapplied
-- as of this migration's creation.

create or replace function public.nxq_enforce_location_entitlement()
returns trigger language plpgsql security definer set search_path=public as $$
declare c record; location_limit integer; current_count integer; addon_units integer;
begin
  select cl.status::text client_status,cl.billing_status::text billing_status,cl.pipeline_stopped_at,
    pf.slug family_slug,pft.tier_key into c from public.clients cl
  join public.product_families pf on pf.id=cl.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=cl.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where cl.id=new.client_id;
  if c.family_slug is distinct from 'business' or c.pipeline_stopped_at is not null
     or c.client_status not in ('approved','active','overdue') or c.billing_status not in ('active','past_due') then
    raise exception 'Current subscription does not permit location creation.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-location-capacity:'||new.client_id::text,0));

  if c.tier_key='enterprise' then
    location_limit:=coalesce((select (limits->>'max_locations')::integer from public.nxq_tier_entitlements
      where product_family_slug='business' and tier_key='enterprise' and feature_key='multi_location' and enabled),0);
  elsif c.tier_key in ('growth','intelligence') then
    select coalesce(enabled_units,0) into addon_units
    from public.client_location_addons where client_id=new.client_id;
    location_limit:=1+coalesce(addon_units,0);
  else
    location_limit:=1;
  end if;
  if location_limit<=0 then raise exception 'A positive server-side location limit is required.'; end if;

  select count(*) into current_count from public.client_locations where client_id=new.client_id and status<>'closed';
  if current_count>=location_limit then raise exception 'Current plan location limit reached (%).',location_limit; end if;
  return new;
end; $$;
drop trigger if exists nxq_enforce_location_entitlement on public.client_locations;
create trigger nxq_enforce_location_entitlement before insert on public.client_locations
for each row execute function public.nxq_enforce_location_entitlement();
revoke all on function public.nxq_enforce_location_entitlement() from public,anon,authenticated,service_role;

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
  needs_check := tg_op = 'UPDATE' and new.status <> 'closed'
    and (old.status = 'closed' or old.client_id is distinct from new.client_id);

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

comment on function public.nxq_enforce_location_entitlement() is
  'INSERT-time location entitlement gate. Family/status/billing/pipeline guards unchanged from migration 246; cap formula now accounts for client_location_addons on growth/intelligence, and its advisory lock shares migration 251''s client-location-capacity namespace so it serializes correctly against the add-on enable/cancel RPCs.';

comment on function public.enforce_client_location_limit() is
  'UPDATE-only location cap gate (reopening a closed location, or reassigning client_id). The plain-INSERT case this function also checked in migration 251 is removed here -- it is now handled exclusively by nxq_enforce_location_entitlement(), avoiding two competing triggers evaluating INSERT with different, previously-inconsistent cap formulas.';
