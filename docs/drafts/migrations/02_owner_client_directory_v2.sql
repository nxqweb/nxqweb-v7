-- DRAFT (not applied). Adds owner_client_directory_page_v2: the same owner-only, keyset-paginated client
-- directory as owner_client_directory_page (migration 217), plus two identifier columns and search by them:
--   client_code  e.g. WEB-3F9A1C2B7D4E  (clients.client_code)
--   nxq_id       e.g. NXQ-8B1D0E4F9A2C7F31  (nxq_accounts.nxq_id)
-- Additive: the original function is NOT changed or dropped, so the current owner page keeps working until
-- a later front-end change switches to v2. Owner check, page bound (100) and cursor rules are unchanged.
create or replace function public.owner_client_directory_page_v2(
  target_limit integer default 50,
  target_cursor_created_at timestamptz default null,
  target_cursor_id uuid default null,
  target_search text default null,
  target_status text default null
)
returns table (
  id uuid,
  business_name text,
  contact_name text,
  contact_email text,
  business_type text,
  status text,
  monthly_price numeric,
  billing_status text,
  billing_provider text,
  billing_overdue_since timestamptz,
  billing_frozen_at timestamptz,
  notes text,
  qa_only boolean,
  created_at timestamptz,
  project_id uuid,
  website_status text,
  build_plan jsonb,
  unread_message_count bigint,
  client_code text,
  nxq_id text
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
  if not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
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
    c.id, c.business_name, c.contact_name, c.contact_email, c.business_type, c.status::text, c.monthly_price,
    c.billing_status::text, c.billing_provider, c.billing_overdue_since, c.billing_frozen_at, c.notes, c.qa_only,
    c.created_at, p.id, p.website_status::text, p.build_plan, coalesce(u.unread_count, 0)::bigint,
    c.client_code, a.nxq_id
  from public.clients c
  left join public.nxq_accounts a on a.id = c.nxq_account_id
  left join lateral (
    select p0.id, p0.website_status, p0.build_plan
    from public.projects p0
    where p0.client_id = c.id
    order by p0.created_at desc, p0.id desc
    limit 1
  ) p on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.client_messages m
    where m.client_id = c.id and m.sender_type::text = 'client' and m.owner_seen_at is null
  ) u on true
  where
    (status_value is null or c.status::text = status_value)
    and (
      search_value is null
      or c.business_name ilike '%' || search_value || '%'
      or coalesce(c.contact_name, '') ilike '%' || search_value || '%'
      or coalesce(c.contact_email, '') ilike '%' || search_value || '%'
      or coalesce(c.client_code, '') ilike '%' || search_value || '%'
      or coalesce(a.nxq_id, '') ilike '%' || search_value || '%'
    )
    and (
      target_cursor_created_at is null
      or (c.created_at, c.id) < (target_cursor_created_at, target_cursor_id)
    )
  order by c.created_at desc, c.id desc
  limit page_limit;
end;
$$;

revoke all on function public.owner_client_directory_page_v2(integer, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.owner_client_directory_page_v2(integer, timestamptz, uuid, text, text) to authenticated, service_role;

comment on function public.owner_client_directory_page_v2(integer, timestamptz, uuid, text, text) is
  'Owner-only keyset-paginated client directory (same as v1) plus client_code and nxq_id, searchable by either.';
