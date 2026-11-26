-- DRAFT (not applied). Generic add-on packs ("Team hours" and later ones) on top of the $50 plan.
-- Same shape as the Multi-Location add-on in migration 251: a per-client row, an append-only events trail,
-- RLS (owner reads all, a client reads only its own), and ONE owner-only function to switch a pack on or off.
-- Billing stays manual for now: this records WHAT a client has and WHEN it changed; it never charges anyone.
-- Prices below are placeholders from the owner's chat example; every pack starts INACTIVE until the owner
-- confirms its name and price (see docs/BUSINESS_SUITE_PLAN.md). Card fees make tiny prices expensive
-- (about 2.9% + $0.30 per charge, unverified), which is why packs are meant to ride the monthly invoice.
create table if not exists public.nxq_addon_pack_catalog (
  pack_key text primary key check (pack_key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  description text not null default '',
  monthly_price_cents integer not null check (monthly_price_cents between 0 and 100000),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_addon_packs (
  client_id uuid not null references public.clients(id) on delete cascade,
  pack_key text not null references public.nxq_addon_pack_catalog(pack_key),
  enabled boolean not null default false,
  price_cents_when_enabled integer not null default 0 check (price_cents_when_enabled between 0 and 100000),
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, pack_key)
);

create table if not exists public.client_addon_pack_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pack_key text not null references public.nxq_addon_pack_catalog(pack_key),
  event_type text not null check (event_type in ('enabled', 'cancelled')),
  price_cents integer not null check (price_cents between 0 and 100000),
  occurred_at timestamptz not null default now()
);
create index if not exists client_addon_pack_events_client_idx on public.client_addon_pack_events (client_id, occurred_at desc);

insert into public.nxq_addon_pack_catalog (pack_key, label, description, monthly_price_cents, active) values
  ('team_hours', 'Team hours', 'Staff clock in and out from their phones; the owner sees the hours. Tracking only, not payroll.', 500, false)
on conflict (pack_key) do nothing;

alter table public.nxq_addon_pack_catalog enable row level security;
alter table public.client_addon_packs enable row level security;
alter table public.client_addon_pack_events enable row level security;
revoke all on table public.nxq_addon_pack_catalog, public.client_addon_packs, public.client_addon_pack_events from public, anon, authenticated;
grant select on table public.nxq_addon_pack_catalog, public.client_addon_packs, public.client_addon_pack_events to authenticated;
grant select, insert, update, delete on table public.nxq_addon_pack_catalog, public.client_addon_packs to service_role;
grant select, insert on table public.client_addon_pack_events to service_role;

-- Any signed-in user may see which ACTIVE packs exist (the catalog holds no private data).
create policy read_active_addon_catalog on public.nxq_addon_pack_catalog for select to authenticated
  using (active or exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy owner_read_client_addon_packs on public.client_addon_packs for select to authenticated
  using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_read_own_addon_packs on public.client_addon_packs for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_addon_packs.client_id and c.auth_user_id = auth.uid()));
create policy owner_read_addon_pack_events on public.client_addon_pack_events for select to authenticated
  using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_read_own_addon_pack_events on public.client_addon_pack_events for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_addon_pack_events.client_id and c.auth_user_id = auth.uid()));

-- Owner switches a pack on or off for one client. Idempotent: no change means no new event.
create or replace function public.owner_set_client_addon_pack(target_client_id uuid, target_pack_key text, target_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pack public.nxq_addon_pack_catalog%rowtype; cur public.client_addon_packs%rowtype;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null
     or not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.'; end if;
  if target_enabled is null then raise exception 'Say whether the pack is on or off.'; end if;
  if not exists (select 1 from public.clients where id = target_client_id) then raise exception 'Client not found.'; end if;
  select * into pack from public.nxq_addon_pack_catalog where pack_key = target_pack_key;
  if not found then raise exception 'Unknown add-on pack.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('client-addon-pack:' || target_client_id::text || ':' || target_pack_key, 0));
  select * into cur from public.client_addon_packs where client_id = target_client_id and pack_key = target_pack_key;
  if target_enabled then
    if not pack.active then raise exception 'This add-on pack is not on sale yet.'; end if;
    if found and cur.enabled then return jsonb_build_object('ok', true, 'changed', false, 'enabled', true); end if;
    insert into public.client_addon_packs(client_id, pack_key, enabled, price_cents_when_enabled, enabled_at)
      values (target_client_id, target_pack_key, true, pack.monthly_price_cents, now())
      on conflict (client_id, pack_key) do update set enabled = true, price_cents_when_enabled = excluded.price_cents_when_enabled,
        enabled_at = now(), updated_at = now();
    insert into public.client_addon_pack_events(client_id, pack_key, event_type, price_cents)
      values (target_client_id, target_pack_key, 'enabled', pack.monthly_price_cents);
    return jsonb_build_object('ok', true, 'changed', true, 'enabled', true, 'price_cents', pack.monthly_price_cents);
  end if;
  if not found or not cur.enabled then return jsonb_build_object('ok', true, 'changed', false, 'enabled', false); end if;
  update public.client_addon_packs set enabled = false, updated_at = now() where client_id = target_client_id and pack_key = target_pack_key;
  insert into public.client_addon_pack_events(client_id, pack_key, event_type, price_cents)
    values (target_client_id, target_pack_key, 'cancelled', cur.price_cents_when_enabled);
  return jsonb_build_object('ok', true, 'changed', true, 'enabled', false);
end $$;

revoke all on function public.owner_set_client_addon_pack(uuid, text, boolean) from public, anon;
grant execute on function public.owner_set_client_addon_pack(uuid, text, boolean) to authenticated;
