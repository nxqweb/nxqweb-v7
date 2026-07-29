-- Guarded monthly usage limits for NXQ Commerce.
-- Normal edits do not count. New product records and newly registered product images do.
-- Owner/system actions bypass client limits; owners can set per-client overrides.

create table if not exists public.commerce_usage_limit_overrides (
  client_id uuid primary key references public.clients(id) on delete cascade,
  monthly_product_limit integer check (monthly_product_limit is null or monthly_product_limit >= 0),
  monthly_image_limit integer check (monthly_image_limit is null or monthly_image_limit >= 0),
  max_image_bytes bigint check (max_image_bytes is null or max_image_bytes > 0),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.commerce_usage_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  usage_type text not null check (usage_type in ('product_created','image_uploaded')),
  resource_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (usage_type, resource_id)
);

create index if not exists commerce_usage_events_client_month_idx
  on public.commerce_usage_events(client_id, occurred_at, usage_type);

alter table public.commerce_usage_limit_overrides enable row level security;
alter table public.commerce_usage_events enable row level security;

revoke all on table public.commerce_usage_limit_overrides from public, anon;
revoke all on table public.commerce_usage_events from public, anon;
grant select, insert, update, delete on table public.commerce_usage_limit_overrides to authenticated;
grant select on table public.commerce_usage_events to authenticated;

drop policy if exists owner_manage_commerce_usage_overrides on public.commerce_usage_limit_overrides;
create policy owner_manage_commerce_usage_overrides
on public.commerce_usage_limit_overrides
for all to authenticated
using (public.is_nxq_owner())
with check (public.is_nxq_owner());

drop policy if exists owner_view_commerce_usage_events on public.commerce_usage_events;
create policy owner_view_commerce_usage_events
on public.commerce_usage_events
for select to authenticated
using (public.is_nxq_owner());

drop policy if exists client_view_own_commerce_usage_events on public.commerce_usage_events;
create policy client_view_own_commerce_usage_events
on public.commerce_usage_events
for select to authenticated
using (client_id = public.current_client_id());

create or replace function public.get_commerce_usage_limits(target_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tier_key_value text := 'starter';
  product_limit_value integer;
  image_limit_value integer;
  image_bytes_value bigint;
  override_row public.commerce_usage_limit_overrides%rowtype;
begin
  select coalesce(tier.tier_key, 'starter')
  into tier_key_value
  from public.clients client
  left join public.product_family_tiers tier on tier.id = client.product_tier_id
  where client.id = target_client_id;

  product_limit_value := case tier_key_value
    when 'growth' then 75
    when 'intelligence' then 150
    when 'enterprise' then 500
    else 20
  end;

  image_limit_value := case tier_key_value
    when 'growth' then 300
    when 'intelligence' then 600
    when 'enterprise' then 2000
    else 100
  end;

  image_bytes_value := 8388608;

  select * into override_row
  from public.commerce_usage_limit_overrides
  where client_id = target_client_id;

  return jsonb_build_object(
    'tier_key', tier_key_value,
    'monthly_product_limit', coalesce(override_row.monthly_product_limit, product_limit_value),
    'monthly_image_limit', coalesce(override_row.monthly_image_limit, image_limit_value),
    'max_image_bytes', coalesce(override_row.max_image_bytes, image_bytes_value),
    'has_override', override_row.client_id is not null
  );
end;
$$;

create or replace function public.get_commerce_usage_summary(target_client_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  limits jsonb;
  month_start timestamptz := date_trunc('month', now());
  next_month timestamptz := date_trunc('month', now()) + interval '1 month';
  products_used integer;
  images_used integer;
begin
  client_uuid := coalesce(target_client_id, public.current_client_id());

  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  if target_client_id is not null
     and target_client_id <> public.current_client_id()
     and not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  limits := public.get_commerce_usage_limits(client_uuid);

  select count(*) filter (where usage_type = 'product_created'),
         count(*) filter (where usage_type = 'image_uploaded')
  into products_used, images_used
  from public.commerce_usage_events
  where client_id = client_uuid
    and occurred_at >= month_start
    and occurred_at < next_month;

  return limits || jsonb_build_object(
    'client_id', client_uuid,
    'month_start', month_start,
    'resets_at', next_month,
    'products_used', coalesce(products_used, 0),
    'images_used', coalesce(images_used, 0),
    'products_remaining', greatest((limits->>'monthly_product_limit')::integer - coalesce(products_used, 0), 0),
    'images_remaining', greatest((limits->>'monthly_image_limit')::integer - coalesce(images_used, 0), 0)
  );
end;
$$;

create or replace function public.enforce_and_record_commerce_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_client uuid;
  limits jsonb;
  used_count integer;
  limit_count integer;
  usage_name text;
begin
  acting_client := public.current_client_id();

  -- Owner, service-role, and system imports are governed by owner controls instead.
  if acting_client is null or acting_client <> new.client_id then
    return new;
  end if;

  limits := public.get_commerce_usage_limits(new.client_id);

  if tg_table_name = 'commerce_products' then
    usage_name := 'product_created';
    limit_count := (limits->>'monthly_product_limit')::integer;
  elsif tg_table_name = 'commerce_product_media' then
    usage_name := 'image_uploaded';
    limit_count := (limits->>'monthly_image_limit')::integer;

    if new.file_size is not null and new.file_size > (limits->>'max_image_bytes')::bigint then
      raise exception 'Image exceeds the % MB file limit.', round(((limits->>'max_image_bytes')::numeric / 1048576), 0);
    end if;
  else
    return new;
  end if;

  select count(*) into used_count
  from public.commerce_usage_events
  where client_id = new.client_id
    and usage_type = usage_name
    and occurred_at >= date_trunc('month', now())
    and occurred_at < date_trunc('month', now()) + interval '1 month';

  if used_count >= limit_count then
    raise exception 'Monthly Commerce % limit reached (%). Existing items can still be edited.',
      case when usage_name = 'product_created' then 'product' else 'image' end,
      limit_count;
  end if;

  insert into public.commerce_usage_events(client_id, usage_type, resource_id)
  values (new.client_id, usage_name, new.id)
  on conflict (usage_type, resource_id) do nothing;

  return new;
end;
$$;

drop trigger if exists enforce_commerce_product_usage on public.commerce_products;
create trigger enforce_commerce_product_usage
before insert on public.commerce_products
for each row execute function public.enforce_and_record_commerce_usage();

drop trigger if exists enforce_commerce_media_usage on public.commerce_product_media;
create trigger enforce_commerce_media_usage
before insert on public.commerce_product_media
for each row execute function public.enforce_and_record_commerce_usage();

create or replace function public.get_owner_commerce_usage_summaries()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_nxq_owner() then coalesce(jsonb_agg(
    public.get_commerce_usage_summary(client.id)
    || jsonb_build_object(
      'business_name', client.business_name,
      'contact_email', client.contact_email,
      'monthly_price', client.monthly_price
    ) order by client.business_name
  ), '[]'::jsonb) else '[]'::jsonb end
  from public.clients client
  join public.product_families family on family.id = client.product_family_id
  where family.slug = 'commerce'
$$;

revoke all on function public.get_commerce_usage_limits(uuid) from public, anon;
revoke all on function public.get_commerce_usage_summary(uuid) from public, anon;
revoke all on function public.get_owner_commerce_usage_summaries() from public, anon;
grant execute on function public.get_commerce_usage_summary(uuid) to authenticated;
grant execute on function public.get_owner_commerce_usage_summaries() to authenticated;
