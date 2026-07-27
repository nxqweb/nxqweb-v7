-- Owner-only per-client usage and cost ledger.
-- Records estimated infrastructure cost and margin without exposing internal costs to clients.
-- Provider usage collection is added separately; this migration creates the guarded ledger and RPCs.

create table if not exists public.client_cost_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  target_max_monthly_cost numeric(12,2) not null default 10 check (target_max_monthly_cost >= 0),
  target_min_monthly_margin numeric(12,2) not null default 40 check (target_min_monthly_margin >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_monthly_usage_costs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_month date not null,
  hosting_cost numeric(12,4) not null default 0 check (hosting_cost >= 0),
  database_auth_cost numeric(12,4) not null default 0 check (database_auth_cost >= 0),
  storage_cost numeric(12,4) not null default 0 check (storage_cost >= 0),
  bandwidth_cost numeric(12,4) not null default 0 check (bandwidth_cost >= 0),
  ai_cost numeric(12,4) not null default 0 check (ai_cost >= 0),
  email_notification_cost numeric(12,4) not null default 0 check (email_notification_cost >= 0),
  monitoring_backup_cost numeric(12,4) not null default 0 check (monitoring_backup_cost >= 0),
  other_cost numeric(12,4) not null default 0 check (other_cost >= 0),
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  bandwidth_bytes bigint not null default 0 check (bandwidth_bytes >= 0),
  ai_input_tokens bigint not null default 0 check (ai_input_tokens >= 0),
  ai_output_tokens bigint not null default 0 check (ai_output_tokens >= 0),
  emails_sent integer not null default 0 check (emails_sent >= 0),
  builds_count integer not null default 0 check (builds_count >= 0),
  monthly_revenue numeric(12,2) not null default 0 check (monthly_revenue >= 0),
  source_status text not null default 'estimated'
    check (source_status in ('estimated','partial','provider_verified','manual_override')),
  source_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period_month),
  check (period_month = date_trunc('month', period_month)::date)
);

create index if not exists client_monthly_usage_costs_period_idx
  on public.client_monthly_usage_costs(period_month desc, client_id);

create or replace function public.touch_client_cost_ledger_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_client_cost_profiles_updated_at on public.client_cost_profiles;
create trigger touch_client_cost_profiles_updated_at
before update on public.client_cost_profiles
for each row execute function public.touch_client_cost_ledger_updated_at();

drop trigger if exists touch_client_monthly_usage_costs_updated_at on public.client_monthly_usage_costs;
create trigger touch_client_monthly_usage_costs_updated_at
before update on public.client_monthly_usage_costs
for each row execute function public.touch_client_cost_ledger_updated_at();

alter table public.client_cost_profiles enable row level security;
alter table public.client_monthly_usage_costs enable row level security;

revoke all on table public.client_cost_profiles from public, anon;
revoke all on table public.client_monthly_usage_costs from public, anon;
grant select, insert, update, delete on table public.client_cost_profiles to authenticated;
grant select, insert, update, delete on table public.client_monthly_usage_costs to authenticated;

drop policy if exists owner_manage_client_cost_profiles on public.client_cost_profiles;
create policy owner_manage_client_cost_profiles
on public.client_cost_profiles
for all
to authenticated
using (public.is_nxq_owner())
with check (public.is_nxq_owner());

drop policy if exists owner_manage_client_monthly_usage_costs on public.client_monthly_usage_costs;
create policy owner_manage_client_monthly_usage_costs
on public.client_monthly_usage_costs
for all
to authenticated
using (public.is_nxq_owner())
with check (public.is_nxq_owner());

create or replace function public.owner_upsert_client_monthly_cost(
  target_client_id uuid,
  target_period_month date,
  usage_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_month date;
  client_row public.clients%rowtype;
  saved_row public.client_monthly_usage_costs%rowtype;
  profile_row public.client_cost_profiles%rowtype;
  total_cost numeric;
  margin numeric;
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access is required.';
  end if;

  if usage_payload is null or jsonb_typeof(usage_payload) <> 'object' then
    raise exception 'Usage payload must be an object.';
  end if;

  normalized_month := date_trunc('month', coalesce(target_period_month, current_date))::date;

  select * into client_row
  from public.clients
  where id = target_client_id;

  if client_row.id is null then
    raise exception 'Client was not found.';
  end if;

  insert into public.client_cost_profiles (client_id)
  values (client_row.id)
  on conflict (client_id) do nothing;

  insert into public.client_monthly_usage_costs (
    client_id,
    period_month,
    hosting_cost,
    database_auth_cost,
    storage_cost,
    bandwidth_cost,
    ai_cost,
    email_notification_cost,
    monitoring_backup_cost,
    other_cost,
    storage_bytes,
    bandwidth_bytes,
    ai_input_tokens,
    ai_output_tokens,
    emails_sent,
    builds_count,
    monthly_revenue,
    source_status,
    source_details
  ) values (
    client_row.id,
    normalized_month,
    greatest(coalesce((usage_payload->>'hosting_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'database_auth_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'storage_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'bandwidth_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'ai_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'email_notification_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'monitoring_backup_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'other_cost')::numeric, 0), 0),
    greatest(coalesce((usage_payload->>'storage_bytes')::bigint, 0), 0),
    greatest(coalesce((usage_payload->>'bandwidth_bytes')::bigint, 0), 0),
    greatest(coalesce((usage_payload->>'ai_input_tokens')::bigint, 0), 0),
    greatest(coalesce((usage_payload->>'ai_output_tokens')::bigint, 0), 0),
    greatest(coalesce((usage_payload->>'emails_sent')::integer, 0), 0),
    greatest(coalesce((usage_payload->>'builds_count')::integer, 0), 0),
    greatest(coalesce((usage_payload->>'monthly_revenue')::numeric, client_row.monthly_price, 0), 0),
    coalesce(nullif(usage_payload->>'source_status',''), 'estimated'),
    coalesce(usage_payload->'source_details', '{}'::jsonb)
  )
  on conflict (client_id, period_month) do update set
    hosting_cost = excluded.hosting_cost,
    database_auth_cost = excluded.database_auth_cost,
    storage_cost = excluded.storage_cost,
    bandwidth_cost = excluded.bandwidth_cost,
    ai_cost = excluded.ai_cost,
    email_notification_cost = excluded.email_notification_cost,
    monitoring_backup_cost = excluded.monitoring_backup_cost,
    other_cost = excluded.other_cost,
    storage_bytes = excluded.storage_bytes,
    bandwidth_bytes = excluded.bandwidth_bytes,
    ai_input_tokens = excluded.ai_input_tokens,
    ai_output_tokens = excluded.ai_output_tokens,
    emails_sent = excluded.emails_sent,
    builds_count = excluded.builds_count,
    monthly_revenue = excluded.monthly_revenue,
    source_status = excluded.source_status,
    source_details = excluded.source_details,
    updated_at = now()
  returning * into saved_row;

  select * into profile_row
  from public.client_cost_profiles
  where client_id = client_row.id;

  total_cost :=
    saved_row.hosting_cost +
    saved_row.database_auth_cost +
    saved_row.storage_cost +
    saved_row.bandwidth_cost +
    saved_row.ai_cost +
    saved_row.email_notification_cost +
    saved_row.monitoring_backup_cost +
    saved_row.other_cost;

  margin := saved_row.monthly_revenue - total_cost;

  return jsonb_build_object(
    'client_id', saved_row.client_id,
    'period_month', saved_row.period_month,
    'monthly_revenue', saved_row.monthly_revenue,
    'total_cost', round(total_cost, 2),
    'estimated_margin', round(margin, 2),
    'target_max_monthly_cost', profile_row.target_max_monthly_cost,
    'target_min_monthly_margin', profile_row.target_min_monthly_margin,
    'cost_target_met', total_cost <= profile_row.target_max_monthly_cost,
    'margin_target_met', margin >= profile_row.target_min_monthly_margin,
    'source_status', saved_row.source_status
  );
end;
$$;

create or replace function public.owner_get_client_cost_summary(
  target_period_month date default null
)
returns table (
  client_id uuid,
  business_name text,
  period_month date,
  monthly_revenue numeric,
  total_cost numeric,
  estimated_margin numeric,
  target_max_monthly_cost numeric,
  target_min_monthly_margin numeric,
  cost_target_met boolean,
  margin_target_met boolean,
  storage_bytes bigint,
  bandwidth_bytes bigint,
  ai_input_tokens bigint,
  ai_output_tokens bigint,
  emails_sent integer,
  builds_count integer,
  source_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access is required.';
  end if;

  return query
  select
    c.id,
    c.business_name,
    u.period_month,
    u.monthly_revenue,
    round((
      u.hosting_cost + u.database_auth_cost + u.storage_cost + u.bandwidth_cost +
      u.ai_cost + u.email_notification_cost + u.monitoring_backup_cost + u.other_cost
    ), 2) as total_cost,
    round((
      u.monthly_revenue - (
        u.hosting_cost + u.database_auth_cost + u.storage_cost + u.bandwidth_cost +
        u.ai_cost + u.email_notification_cost + u.monitoring_backup_cost + u.other_cost
      )
    ), 2) as estimated_margin,
    p.target_max_monthly_cost,
    p.target_min_monthly_margin,
    (
      u.hosting_cost + u.database_auth_cost + u.storage_cost + u.bandwidth_cost +
      u.ai_cost + u.email_notification_cost + u.monitoring_backup_cost + u.other_cost
    ) <= p.target_max_monthly_cost,
    (
      u.monthly_revenue - (
        u.hosting_cost + u.database_auth_cost + u.storage_cost + u.bandwidth_cost +
        u.ai_cost + u.email_notification_cost + u.monitoring_backup_cost + u.other_cost
      )
    ) >= p.target_min_monthly_margin,
    u.storage_bytes,
    u.bandwidth_bytes,
    u.ai_input_tokens,
    u.ai_output_tokens,
    u.emails_sent,
    u.builds_count,
    u.source_status
  from public.clients c
  join public.client_monthly_usage_costs u on u.client_id = c.id
  join public.client_cost_profiles p on p.client_id = c.id
  where u.period_month = date_trunc('month', coalesce(target_period_month, current_date))::date
  order by estimated_margin asc, c.business_name asc;
end;
$$;

revoke all on function public.touch_client_cost_ledger_updated_at() from public, anon;
revoke all on function public.owner_upsert_client_monthly_cost(uuid, date, jsonb) from public, anon;
revoke all on function public.owner_get_client_cost_summary(date) from public, anon;
grant execute on function public.owner_upsert_client_monthly_cost(uuid, date, jsonb) to authenticated;
grant execute on function public.owner_get_client_cost_summary(date) to authenticated;

comment on table public.client_cost_profiles is
  'Owner-only cost and margin targets for each client workspace.';
comment on table public.client_monthly_usage_costs is
  'Owner-only monthly usage and estimated infrastructure cost ledger per client.';
comment on function public.owner_get_client_cost_summary(date) is
  'Owner-only monthly client revenue, cost, and margin summary.';
