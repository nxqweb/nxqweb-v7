-- Make tenant placement allocation safe under concurrent first-use requests.
-- A per-client transaction advisory lock guarantees exactly one allocator mutates
-- provider allocation counters for a new client placement.

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
  if target_client_id is null then
    raise exception 'Client id is required.';
  end if;

  -- Serializes only placement creation for this tenant, not the whole allocator.
  perform pg_advisory_xact_lock(hashtextextended('nxq-placement:' || target_client_id::text, 0));

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
    client_id,
    region_key,
    source_pool_id,
    hosting_pool_id,
    ai_pool_id,
    notification_pool_id
  ) values (
    target_client_id,
    region_value,
    source_pool,
    hosting_pool,
    ai_pool,
    notification_pool
  )
  returning * into placement;

  if source_pool is not null then
    update public.nxq_provider_pools
    set current_allocations = current_allocations + 1,
        updated_at = now()
    where id = source_pool;
  end if;

  if hosting_pool is not null then
    update public.nxq_provider_pools
    set current_allocations = current_allocations + 1,
        updated_at = now()
    where id = hosting_pool;
  end if;

  if ai_pool is not null then
    update public.nxq_provider_pools
    set current_allocations = current_allocations + 1,
        updated_at = now()
    where id = ai_pool;
  end if;

  if notification_pool is not null then
    update public.nxq_provider_pools
    set current_allocations = current_allocations + 1,
        updated_at = now()
    where id = notification_pool;
  end if;

  return to_jsonb(placement);
end;
$$;

revoke all on function public.nxq_ensure_client_placement(uuid, text) from public, anon, authenticated;
grant execute on function public.nxq_ensure_client_placement(uuid, text) to service_role;

comment on function public.nxq_ensure_client_placement(uuid, text) is
  'Concurrency-safe tenant allocator. A per-client transaction lease prevents duplicate placement and provider allocation-counter inflation during burst traffic.';
