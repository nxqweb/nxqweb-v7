-- Prevent concurrent Commerce dashboard/setup requests from creating duplicate storefronts.
-- A client has exactly one storefront, so creation must be atomic and safely reusable.

create or replace function public.ensure_my_commerce_storefront()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  client_name text;
  clean_slug text;
begin
  client_uuid := public.current_client_id();

  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select s.id
  into storefront_uuid
  from public.commerce_storefronts s
  where s.client_id = client_uuid
  limit 1;

  if storefront_uuid is not null then
    return storefront_uuid;
  end if;

  select c.business_name
  into client_name
  from public.clients c
  where c.id = client_uuid;

  clean_slug := lower(regexp_replace(coalesce(client_name, 'nxq-store'), '[^a-zA-Z0-9]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);

  if clean_slug = '' then
    clean_slug := 'nxq-store';
  end if;

  clean_slug := left(clean_slug, 42) || '-' || left(replace(client_uuid::text, '-', ''), 8);

  insert into public.commerce_storefronts (
    client_id,
    store_name,
    store_slug,
    status,
    payment_mode
  ) values (
    client_uuid,
    coalesce(nullif(trim(client_name), ''), 'NXQ Commerce Store'),
    clean_slug,
    'setup_pending',
    'not_connected'
  )
  on conflict (client_id) do update
  set client_id = excluded.client_id
  returning id into storefront_uuid;

  if storefront_uuid is null then
    select s.id
    into storefront_uuid
    from public.commerce_storefronts s
    where s.client_id = client_uuid
    limit 1;
  end if;

  if storefront_uuid is null then
    raise exception 'Commerce storefront could not be created or loaded.';
  end if;

  return storefront_uuid;
end;
$$;

revoke all on function public.ensure_my_commerce_storefront() from public, anon;
grant execute on function public.ensure_my_commerce_storefront() to authenticated;

comment on function public.ensure_my_commerce_storefront() is
  'Returns the current client storefront and atomically creates it when missing, safely handling concurrent dashboard, setup, and product requests.';
