-- Million-row portal search/pagination hardening.

create extension if not exists pg_trgm;

create index if not exists clients_business_name_trgm_idx
  on public.clients using gin (business_name gin_trgm_ops);

create or replace function public.owner_client_list_page(
  target_limit integer default 50,
  target_cursor_created_at timestamptz default null,
  target_cursor_id uuid default null,
  target_search text default null,
  target_status text default null
)
returns table (
  id uuid,
  business_name text,
  status text,
  billing_status text,
  monthly_price numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  page_limit integer := least(greatest(coalesce(target_limit, 50), 1), 100);
  search_value text := nullif(trim(coalesce(target_search, '')), '');
  status_value text := nullif(trim(coalesce(target_status, '')), '');
begin
  if not exists (
    select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  if (target_cursor_created_at is null) <> (target_cursor_id is null) then
    raise exception 'Pagination cursor is incomplete.';
  end if;
  if search_value is not null and length(search_value) > 160 then
    raise exception 'Search query is too long.';
  end if;

  return query
  select
    c.id,
    c.business_name,
    c.status::text,
    c.billing_status::text,
    c.monthly_price,
    c.created_at
  from public.clients c
  where
    (status_value is null or c.status::text = status_value)
    and (search_value is null or c.business_name ilike '%' || search_value || '%')
    and (
      target_cursor_created_at is null
      or (c.created_at, c.id) < (target_cursor_created_at, target_cursor_id)
    )
  order by c.created_at desc, c.id desc
  limit page_limit;
end;
$$;

revoke all on function public.owner_client_list_page(integer, timestamptz, uuid, text, text)
  from public, anon;
grant execute on function public.owner_client_list_page(integer, timestamptz, uuid, text, text)
  to authenticated, service_role;

create or replace function public.current_client_message_page(
  target_limit integer default 50,
  target_cursor_created_at timestamptz default null,
  target_cursor_id uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  sender_type text,
  message text,
  needs_owner_review boolean,
  ai_handled boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  page_limit integer := least(greatest(coalesce(target_limit, 50), 1), 100);
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;
  if (target_cursor_created_at is null) <> (target_cursor_id is null) then
    raise exception 'Pagination cursor is incomplete.';
  end if;

  return query
  select
    m.id,
    m.client_id,
    m.sender_type::text,
    m.message,
    m.needs_owner_review,
    m.ai_handled,
    m.created_at
  from public.client_messages m
  where m.client_id = client_uuid
    and (
      target_cursor_created_at is null
      or (m.created_at, m.id) < (target_cursor_created_at, target_cursor_id)
    )
  order by m.created_at desc, m.id desc
  limit page_limit;
end;
$$;

revoke all on function public.current_client_message_page(integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.current_client_message_page(integer, timestamptz, uuid)
  to authenticated, service_role;
