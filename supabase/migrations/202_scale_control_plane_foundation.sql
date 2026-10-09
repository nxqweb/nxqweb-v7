-- NXQ scale control-plane foundation.
-- Adds provider pools, capacity budgets, tenant placement, and scale-mode configuration
-- without changing today's routing behavior. Existing deployments continue to use
-- the default placement until a trusted service-role allocator assigns otherwise.

create table if not exists public.nxq_scale_modes (
  mode_key text primary key check (mode_key in ('standard','high_capacity','massive')),
  is_active boolean not null default false,
  max_signup_admissions_per_minute integer not null check (max_signup_admissions_per_minute > 0),
  max_automation_claims_per_minute integer not null check (max_automation_claims_per_minute > 0),
  max_parallel_provider_mutations integer not null check (max_parallel_provider_mutations > 0),
  max_parallel_ai_jobs integer not null check (max_parallel_ai_jobs > 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.nxq_scale_modes (
  mode_key, is_active, max_signup_admissions_per_minute,
  max_automation_claims_per_minute, max_parallel_provider_mutations,
  max_parallel_ai_jobs, metadata
) values
  ('standard', true, 300, 300, 25, 25, jsonb_build_object('purpose','current-safe-default')),
  ('high_capacity', false, 3000, 3000, 100, 100, jsonb_build_object('purpose','pre-provisioned-growth-mode')),
  ('massive', false, 15000, 15000, 500, 500, jsonb_build_object('purpose','requires-sharded-provider-capacity'))
on conflict (mode_key) do nothing;

create unique index if not exists nxq_scale_modes_one_active_idx
  on public.nxq_scale_modes ((is_active)) where is_active;

create table if not exists public.nxq_provider_pools (
  id uuid primary key default gen_random_uuid(),
  provider_kind text not null check (provider_kind in (
    'source','hosting','ai','email','sms','storage','database','analytics','domain','notification'
  )),
  provider_key text not null,
  pool_key text not null,
  region_key text not null default 'us-central',
  status text not null default 'active' check (status in ('active','draining','paused','degraded','offline')),
  accepting_new_tenants boolean not null default true,
  priority integer not null default 100,
  weight integer not null default 100 check (weight >= 0),
  soft_capacity bigint,
  hard_capacity bigint,
  current_allocations bigint not null default 0 check (current_allocations >= 0),
  max_concurrency integer not null default 10 check (max_concurrency > 0),
  max_requests_per_minute integer,
  max_requests_per_hour integer,
  circuit_open_until timestamptz,
  last_health_status text not null default 'unknown' check (last_health_status in ('unknown','healthy','degraded','unhealthy')),
  last_health_at timestamptz,
  last_error text,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_kind, pool_key),
  check (hard_capacity is null or soft_capacity is null or hard_capacity >= soft_capacity),
  check (max_requests_per_minute is null or max_requests_per_minute > 0),
  check (max_requests_per_hour is null or max_requests_per_hour > 0)
);

create index if not exists nxq_provider_pools_allocator_idx
  on public.nxq_provider_pools(provider_kind, region_key, status, accepting_new_tenants, priority, current_allocations);

create table if not exists public.nxq_provider_capacity_windows (
  id bigint generated always as identity primary key,
  provider_pool_id uuid not null references public.nxq_provider_pools(id) on delete cascade,
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  reserved_units integer not null default 0 check (reserved_units >= 0),
  completed_units integer not null default 0 check (completed_units >= 0),
  failed_units integer not null default 0 check (failed_units >= 0),
  throttled_units integer not null default 0 check (throttled_units >= 0),
  updated_at timestamptz not null default now(),
  unique(provider_pool_id, window_started_at, window_seconds)
);

create index if not exists nxq_provider_capacity_windows_recent_idx
  on public.nxq_provider_capacity_windows(provider_pool_id, window_started_at desc);

create table if not exists public.client_infrastructure_placements (
  client_id uuid primary key references public.clients(id) on delete cascade,
  region_key text not null default 'us-central',
  database_shard_key text not null default 'primary',
  storage_shard_key text not null default 'primary',
  analytics_shard_key text not null default 'primary',
  source_pool_id uuid references public.nxq_provider_pools(id) on delete set null,
  hosting_pool_id uuid references public.nxq_provider_pools(id) on delete set null,
  ai_pool_id uuid references public.nxq_provider_pools(id) on delete set null,
  notification_pool_id uuid references public.nxq_provider_pools(id) on delete set null,
  placement_status text not null default 'active' check (placement_status in ('active','migrating','draining','blocked')),
  placement_version bigint not null default 1 check (placement_version > 0),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists client_infrastructure_placements_region_idx
  on public.client_infrastructure_placements(region_key, placement_status);
create index if not exists client_infrastructure_placements_source_pool_idx
  on public.client_infrastructure_placements(source_pool_id) where source_pool_id is not null;
create index if not exists client_infrastructure_placements_hosting_pool_idx
  on public.client_infrastructure_placements(hosting_pool_id) where hosting_pool_id is not null;

alter table public.nxq_scale_modes enable row level security;
alter table public.nxq_provider_pools enable row level security;
alter table public.nxq_provider_capacity_windows enable row level security;
alter table public.client_infrastructure_placements enable row level security;

revoke all on public.nxq_scale_modes from public, anon, authenticated;
revoke all on public.nxq_provider_pools from public, anon, authenticated;
revoke all on public.nxq_provider_capacity_windows from public, anon, authenticated;
revoke all on public.client_infrastructure_placements from public, anon, authenticated;

grant select, insert, update, delete on public.nxq_scale_modes to service_role;
grant select, insert, update, delete on public.nxq_provider_pools to service_role;
grant select, insert, update, delete on public.nxq_provider_capacity_windows to service_role;
grant select, insert, update, delete on public.client_infrastructure_placements to service_role;

create or replace function public.nxq_active_scale_mode()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select to_jsonb(m) from public.nxq_scale_modes m where m.is_active order by m.updated_at desc limit 1),
    '{}'::jsonb
  );
$$;

revoke all on function public.nxq_active_scale_mode() from public, anon, authenticated;
grant execute on function public.nxq_active_scale_mode() to service_role;

create or replace function public.nxq_choose_provider_pool(
  target_provider_kind text,
  target_region_key text default 'us-central'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select p.id into chosen
  from public.nxq_provider_pools p
  where p.provider_kind = target_provider_kind
    and p.region_key = coalesce(nullif(trim(target_region_key),''),'us-central')
    and p.status = 'active'
    and p.accepting_new_tenants
    and (p.circuit_open_until is null or p.circuit_open_until <= now())
    and (p.hard_capacity is null or p.current_allocations < p.hard_capacity)
  order by
    case when p.soft_capacity is not null and p.current_allocations >= p.soft_capacity then 1 else 0 end,
    p.priority asc,
    case when p.hard_capacity is null or p.hard_capacity = 0 then 0
         else p.current_allocations::numeric / p.hard_capacity::numeric end asc,
    p.current_allocations asc,
    p.id
  for update skip locked
  limit 1;

  return chosen;
end;
$$;

revoke all on function public.nxq_choose_provider_pool(text, text) from public, anon, authenticated;
grant execute on function public.nxq_choose_provider_pool(text, text) to service_role;

create or replace function public.nxq_ensure_client_placement(
  target_client_id uuid,
  target_region_key text default 'us-central'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  placement public.client_infrastructure_placements%rowtype;
  source_pool uuid;
  hosting_pool uuid;
  ai_pool uuid;
  notification_pool uuid;
  region_value text := coalesce(nullif(trim(target_region_key),''),'us-central');
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if not exists (select 1 from public.clients c where c.id = target_client_id) then
    raise exception 'Client not found.';
  end if;

  select * into placement
  from public.client_infrastructure_placements
  where client_id = target_client_id
  for update;

  if placement.client_id is not null then
    return to_jsonb(placement);
  end if;

  source_pool := public.nxq_choose_provider_pool('source', region_value);
  hosting_pool := public.nxq_choose_provider_pool('hosting', region_value);
  ai_pool := public.nxq_choose_provider_pool('ai', region_value);
  notification_pool := public.nxq_choose_provider_pool('notification', region_value);

  insert into public.client_infrastructure_placements (
    client_id, region_key, source_pool_id, hosting_pool_id, ai_pool_id, notification_pool_id
  ) values (
    target_client_id, region_value, source_pool, hosting_pool, ai_pool, notification_pool
  )
  on conflict (client_id) do nothing;

  if source_pool is not null then
    update public.nxq_provider_pools set current_allocations = current_allocations + 1, updated_at = now() where id = source_pool;
  end if;
  if hosting_pool is not null then
    update public.nxq_provider_pools set current_allocations = current_allocations + 1, updated_at = now() where id = hosting_pool;
  end if;
  if ai_pool is not null then
    update public.nxq_provider_pools set current_allocations = current_allocations + 1, updated_at = now() where id = ai_pool;
  end if;
  if notification_pool is not null then
    update public.nxq_provider_pools set current_allocations = current_allocations + 1, updated_at = now() where id = notification_pool;
  end if;

  select * into placement
  from public.client_infrastructure_placements
  where client_id = target_client_id;

  return to_jsonb(placement);
end;
$$;

revoke all on function public.nxq_ensure_client_placement(uuid, text) from public, anon, authenticated;
grant execute on function public.nxq_ensure_client_placement(uuid, text) to service_role;

comment on table public.nxq_provider_pools is
  'Provider-neutral capacity pool registry. Current single-provider operation can remain one active pool per kind; future capacity is added by registering more pools without changing portal/client contracts.';
comment on table public.client_infrastructure_placements is
  'Stable tenant placement record used to decouple NXQ client identity from physical database, storage, analytics, source, hosting, AI, and notification capacity.';
