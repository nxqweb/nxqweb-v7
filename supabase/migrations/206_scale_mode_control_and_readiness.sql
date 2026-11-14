-- Owner/service-role scale-mode control and readiness evidence.
-- Switching a mode changes policy ceilings only; it does not magically create provider capacity.
-- High-capacity/massive activation is therefore blocked unless required capacity pools exist.

create or replace function public.nxq_scale_readiness(target_mode_key text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mode_value text;
  source_pools integer := 0;
  hosting_pools integer := 0;
  ai_pools integer := 0;
  notification_pools integer := 0;
  active_mode text;
  ready boolean := false;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;

  select m.mode_key into active_mode
  from public.nxq_scale_modes m
  where m.is_active
  order by m.updated_at desc
  limit 1;

  mode_value := coalesce(nullif(trim(target_mode_key), ''), active_mode, 'standard');
  if mode_value not in ('standard','high_capacity','massive') then
    raise exception 'Unknown scale mode.';
  end if;

  select count(*)::integer into source_pools
  from public.nxq_provider_pools p
  where p.provider_kind = 'source' and p.status = 'active' and p.accepting_new_tenants
    and (p.circuit_open_until is null or p.circuit_open_until <= now());

  select count(*)::integer into hosting_pools
  from public.nxq_provider_pools p
  where p.provider_kind = 'hosting' and p.status = 'active' and p.accepting_new_tenants
    and (p.circuit_open_until is null or p.circuit_open_until <= now());

  select count(*)::integer into ai_pools
  from public.nxq_provider_pools p
  where p.provider_kind = 'ai' and p.status = 'active' and p.accepting_new_tenants
    and (p.circuit_open_until is null or p.circuit_open_until <= now());

  select count(*)::integer into notification_pools
  from public.nxq_provider_pools p
  where p.provider_kind = 'notification' and p.status = 'active' and p.accepting_new_tenants
    and (p.circuit_open_until is null or p.circuit_open_until <= now());

  ready := case mode_value
    when 'standard' then true
    when 'high_capacity' then source_pools >= 1 and hosting_pools >= 1
    when 'massive' then source_pools >= 2 and hosting_pools >= 2 and ai_pools >= 1 and notification_pools >= 1
    else false
  end;

  return jsonb_build_object(
    'ready', ready,
    'requested_mode', mode_value,
    'active_mode', active_mode,
    'active_source_pools', source_pools,
    'active_hosting_pools', hosting_pools,
    'active_ai_pools', ai_pools,
    'active_notification_pools', notification_pools,
    'requirements', case mode_value
      when 'standard' then jsonb_build_object('provider_pools_required', false)
      when 'high_capacity' then jsonb_build_object('source_pools',1,'hosting_pools',1)
      else jsonb_build_object('source_pools',2,'hosting_pools',2,'ai_pools',1,'notification_pools',1)
    end,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.nxq_scale_readiness(text) from public, anon;
grant execute on function public.nxq_scale_readiness(text) to authenticated, service_role;

create or replace function public.owner_set_nxq_scale_mode(target_mode_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  mode_value text := nullif(trim(target_mode_key), '');
  readiness jsonb;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;
  if mode_value not in ('standard','high_capacity','massive') then
    raise exception 'Unknown scale mode.';
  end if;

  -- Prevent two concurrent mode changes from producing contradictory active rows.
  perform pg_advisory_xact_lock(hashtextextended('nxq-scale-mode', 0));

  readiness := public.nxq_scale_readiness(mode_value);
  if not coalesce((readiness->>'ready')::boolean, false) then
    raise exception 'Scale mode % is not ready for activation. Add/restore required provider capacity first.', mode_value;
  end if;

  update public.nxq_scale_modes
  set is_active = false,
      updated_at = now()
  where is_active and mode_key <> mode_value;

  update public.nxq_scale_modes
  set is_active = true,
      updated_at = now()
  where mode_key = mode_value;

  if not found then
    raise exception 'Scale mode configuration is missing.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'active_mode', mode_value,
    'readiness', readiness,
    'activated_at', now()
  );
end;
$$;

revoke all on function public.owner_set_nxq_scale_mode(text) from public, anon;
grant execute on function public.owner_set_nxq_scale_mode(text) to authenticated, service_role;

comment on function public.owner_set_nxq_scale_mode(text) is
  'Guarded quick-switch for NXQ capacity policy. High-capacity and massive modes cannot activate unless provider-pool readiness requirements are satisfied.';
