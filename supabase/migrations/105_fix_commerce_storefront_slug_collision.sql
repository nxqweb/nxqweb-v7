-- Make Commerce storefront creation resilient to rare or stale slug collisions.
-- A client still receives exactly one storefront; slug conflicts are retried safely.

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
  slug_base text;
  candidate_slug text;
  attempt integer := 0;
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

  slug_base := lower(regexp_replace(coalesce(client_name, 'nxq-store'), '[^a-zA-Z0-9]+', '-', 'g'));
  slug_base := trim(both '-' from slug_base);

  if slug_base = '' then
    slug_base := 'nxq-store';
  end if;

  slug_base := left(slug_base, 42);

  loop
    attempt := attempt + 1;

    candidate_slug := case
      when attempt = 1 then slug_base || '-' || replace(client_uuid::text, '-', '')
      else slug_base || '-' || replace(client_uuid::text, '-', '') || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8)
    end;

    candidate_slug := left(candidate_slug, 96);

    begin
      insert into public.commerce_storefronts (
        client_id,
        store_name,
        store_slug,
        status,
        payment_mode
      ) values (
        client_uuid,
        coalesce(nullif(trim(client_name), ''), 'NXQ Commerce Store'),
        candidate_slug,
        'setup_pending',
        'not_connected'
      )
      on conflict (client_id) do update
      set client_id = excluded.client_id
      returning id into storefront_uuid;

      exit;
    exception
      when unique_violation then
        select s.id
        into storefront_uuid
        from public.commerce_storefronts s
        where s.client_id = client_uuid
        limit 1;

        if storefront_uuid is not null then
          exit;
        end if;

        if attempt >= 5 then
          raise exception 'Commerce storefront could not be assigned a unique public address.';
        end if;
    end;
  end loop;

  if storefront_uuid is null then
    raise exception 'Commerce storefront could not be created or loaded.';
  end if;

  return storefront_uuid;
end;
$$;

revoke all on function public.ensure_my_commerce_storefront() from public, anon;
grant execute on function public.ensure_my_commerce_storefront() to authenticated;

comment on function public.ensure_my_commerce_storefront() is
  'Returns the current client storefront and creates it atomically with collision-safe unique slug retries.';
