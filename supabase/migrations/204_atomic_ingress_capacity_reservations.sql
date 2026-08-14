-- Shared atomic ingress-capacity reservations for burst safety.
-- Public/Edge callers should hash identities before passing them here; raw PII does not belong in this table.

create table if not exists public.nxq_ingress_capacity_windows (
  id bigint generated always as identity primary key,
  scope_key text not null,
  operation_key text not null,
  identity_hash text not null,
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  limit_units integer not null check (limit_units > 0),
  used_units integer not null default 0 check (used_units >= 0),
  denied_units bigint not null default 0 check (denied_units >= 0),
  updated_at timestamptz not null default now(),
  unique(scope_key, operation_key, identity_hash, window_started_at, window_seconds)
);

create index if not exists nxq_ingress_capacity_windows_expiry_idx
  on public.nxq_ingress_capacity_windows(window_started_at, window_seconds);

alter table public.nxq_ingress_capacity_windows enable row level security;
revoke all on public.nxq_ingress_capacity_windows from public, anon, authenticated;
grant select, insert, update, delete on public.nxq_ingress_capacity_windows to service_role;

create or replace function public.nxq_reserve_ingress_capacity(
  target_scope_key text,
  target_operation_key text,
  target_identity_hash text,
  target_units integer,
  target_limit_units integer,
  target_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_value text := nullif(trim(target_scope_key), '');
  operation_value text := nullif(trim(target_operation_key), '');
  identity_value text := nullif(trim(target_identity_hash), '');
  window_start timestamptz;
  reserved_row public.nxq_ingress_capacity_windows%rowtype;
  current_used integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;
  if scope_value is null or length(scope_value) > 120 then raise exception 'Invalid ingress scope.'; end if;
  if operation_value is null or length(operation_value) > 120 then raise exception 'Invalid ingress operation.'; end if;
  if identity_value is null or length(identity_value) > 200 then raise exception 'Invalid ingress identity hash.'; end if;
  if target_units is null or target_units < 1 or target_units > 10000 then raise exception 'Invalid reservation units.'; end if;
  if target_limit_units is null or target_limit_units < 1 then raise exception 'Invalid capacity limit.'; end if;
  if target_window_seconds is null or target_window_seconds < 1 or target_window_seconds > 86400 then
    raise exception 'Invalid capacity window.';
  end if;
  if target_units > target_limit_units then
    return jsonb_build_object(
      'allowed', false,
      'used_units', 0,
      'limit_units', target_limit_units,
      'retry_after_seconds', target_window_seconds
    );
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / target_window_seconds) * target_window_seconds
  );

  -- Upsert is serialized by PostgreSQL on the unique window key. The conditional
  -- UPDATE makes the check + increment one atomic operation under concurrency.
  insert into public.nxq_ingress_capacity_windows (
    scope_key,
    operation_key,
    identity_hash,
    window_started_at,
    window_seconds,
    limit_units,
    used_units,
    denied_units
  ) values (
    scope_value,
    operation_value,
    identity_value,
    window_start,
    target_window_seconds,
    target_limit_units,
    target_units,
    0
  )
  on conflict (scope_key, operation_key, identity_hash, window_started_at, window_seconds)
  do update
  set used_units = public.nxq_ingress_capacity_windows.used_units + excluded.used_units,
      limit_units = excluded.limit_units,
      updated_at = now()
  where public.nxq_ingress_capacity_windows.used_units + excluded.used_units <= excluded.limit_units
  returning * into reserved_row;

  if reserved_row.id is not null then
    return jsonb_build_object(
      'allowed', true,
      'used_units', reserved_row.used_units,
      'remaining_units', greatest(reserved_row.limit_units - reserved_row.used_units, 0),
      'limit_units', reserved_row.limit_units,
      'window_started_at', reserved_row.window_started_at,
      'window_seconds', reserved_row.window_seconds
    );
  end if;

  update public.nxq_ingress_capacity_windows
  set denied_units = denied_units + target_units,
      limit_units = target_limit_units,
      updated_at = now()
  where scope_key = scope_value
    and operation_key = operation_value
    and identity_hash = identity_value
    and window_started_at = window_start
    and window_seconds = target_window_seconds
  returning used_units into current_used;

  return jsonb_build_object(
    'allowed', false,
    'used_units', coalesce(current_used, target_limit_units),
    'remaining_units', greatest(target_limit_units - coalesce(current_used, target_limit_units), 0),
    'limit_units', target_limit_units,
    'window_started_at', window_start,
    'window_seconds', target_window_seconds,
    'retry_after_seconds', greatest(
      1,
      ceil(extract(epoch from (window_start + make_interval(secs => target_window_seconds) - clock_timestamp())))::integer
    )
  );
end;
$$;

revoke all on function public.nxq_reserve_ingress_capacity(text, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.nxq_reserve_ingress_capacity(text, text, text, integer, integer, integer)
  to service_role;

create or replace function public.cleanup_expired_nxq_ingress_capacity_windows()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'Trusted backend access required.';
  end if;

  delete from public.nxq_ingress_capacity_windows
  where window_started_at < now() - interval '2 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_nxq_ingress_capacity_windows() from public, anon, authenticated;
grant execute on function public.cleanup_expired_nxq_ingress_capacity_windows() to service_role;

comment on table public.nxq_ingress_capacity_windows is
  'Atomic shared admission/quota windows for public ingress. Designed to replace race-prone count-then-insert rate limiting across leads, analytics, Commerce, signup admission, and future public APIs.';
