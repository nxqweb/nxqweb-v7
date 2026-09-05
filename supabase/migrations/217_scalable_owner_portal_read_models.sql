-- Scalable Owner Portal read models.
-- Keeps browser payloads bounded and gives the UI stable contracts that can later
-- be backed by rollups, shards, regions, or provider pools without a frontend rewrite.

create index if not exists owner_approval_requests_created_id_desc_idx
  on public.owner_approval_requests(created_at desc, id desc);

create index if not exists owner_approval_requests_status_created_id_desc_idx
  on public.owner_approval_requests(status, created_at desc, id desc);

create index if not exists client_messages_owner_unread_client_created_idx
  on public.client_messages(client_id, created_at desc, id desc)
  where sender_type = 'client' and owner_seen_at is null;

create index if not exists client_messages_owner_unread_created_id_desc_idx
  on public.client_messages(created_at desc, id desc)
  where sender_type = 'client' and owner_seen_at is null;

create index if not exists projects_client_created_desc_idx
  on public.projects(client_id, created_at desc, id desc);

create or replace function public.owner_portal_summary()
returns table (
  total_clients bigint,
  active_clients bigint,
  active_monthly_revenue numeric,
  pipeline_clients bigint,
  pipeline_monthly_value numeric,
  unread_client_messages bigint,
  pending_approvals bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  return query
  select
    (select count(*) from public.clients)::bigint,
    (select count(*) from public.clients c where c.billing_status::text = 'active')::bigint,
    coalesce((select sum(c.monthly_price) from public.clients c where c.billing_status::text = 'active'), 0)::numeric,
    (select count(*) from public.clients c where c.status::text not in ('archived', 'denied', 'dormant'))::bigint,
    coalesce((select sum(c.monthly_price) from public.clients c where c.status::text not in ('archived', 'denied', 'dormant')), 0)::numeric,
    (select count(*) from public.client_messages m where m.sender_type::text = 'client' and m.owner_seen_at is null)::bigint,
    (select count(*) from public.owner_approval_requests a where a.status::text = 'pending')::bigint;
end;
$$;

revoke all on function public.owner_portal_summary() from public, anon;
grant execute on function public.owner_portal_summary() to authenticated, service_role;

comment on function public.owner_portal_summary() is
  'Owner-only global portal metrics. The UI depends on this stable contract instead of deriving company totals from a paged client list; implementation may later move to maintained rollups without changing the frontend.';

create or replace function public.owner_client_directory_page(
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
  unread_message_count bigint
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
    c.id,
    c.business_name,
    c.contact_name,
    c.contact_email,
    c.business_type,
    c.status::text,
    c.monthly_price,
    c.billing_status::text,
    c.billing_provider,
    c.billing_overdue_since,
    c.billing_frozen_at,
    c.notes,
    c.qa_only,
    c.created_at,
    p.id,
    p.website_status::text,
    p.build_plan,
    coalesce(u.unread_count, 0)::bigint
  from public.clients c
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
    where m.client_id = c.id
      and m.sender_type::text = 'client'
      and m.owner_seen_at is null
  ) u on true
  where
    (status_value is null or c.status::text = status_value)
    and (
      search_value is null
      or c.business_name ilike '%' || search_value || '%'
      or coalesce(c.contact_name, '') ilike '%' || search_value || '%'
      or coalesce(c.contact_email, '') ilike '%' || search_value || '%'
    )
    and (
      target_cursor_created_at is null
      or (c.created_at, c.id) < (target_cursor_created_at, target_cursor_id)
    )
  order by c.created_at desc, c.id desc
  limit page_limit;
end;
$$;

revoke all on function public.owner_client_directory_page(integer, timestamptz, uuid, text, text)
  from public, anon;
grant execute on function public.owner_client_directory_page(integer, timestamptz, uuid, text, text)
  to authenticated, service_role;

comment on function public.owner_client_directory_page(integer, timestamptz, uuid, text, text) is
  'Owner-only keyset-paginated client directory. Page size is bounded to 100 but total clients are not capped. Includes latest project summary and per-client unread count.';

create or replace function public.owner_approval_page(
  target_limit integer default 50,
  target_cursor_created_at timestamptz default null,
  target_cursor_id uuid default null,
  target_status text default null
)
returns table (
  id uuid,
  client_id uuid,
  project_id uuid,
  request_type text,
  title text,
  summary text,
  recommended_action text,
  risk_level text,
  status text,
  owner_response text,
  options jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  page_limit integer := least(greatest(coalesce(target_limit, 50), 1), 100);
  status_value text := nullif(trim(coalesce(target_status, '')), '');
begin
  if not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;

  if (target_cursor_created_at is null) <> (target_cursor_id is null) then
    raise exception 'Pagination cursor is incomplete.';
  end if;

  return query
  select
    a.id,
    a.client_id,
    a.project_id,
    a.request_type::text,
    a.title,
    a.summary,
    a.recommended_action,
    a.risk_level::text,
    a.status::text,
    a.owner_response,
    a.options,
    a.created_at
  from public.owner_approval_requests a
  where
    (status_value is null or a.status::text = status_value)
    and (
      target_cursor_created_at is null
      or (a.created_at, a.id) < (target_cursor_created_at, target_cursor_id)
    )
  order by a.created_at desc, a.id desc
  limit page_limit;
end;
$$;

revoke all on function public.owner_approval_page(integer, timestamptz, uuid, text)
  from public, anon;
grant execute on function public.owner_approval_page(integer, timestamptz, uuid, text)
  to authenticated, service_role;

comment on function public.owner_approval_page(integer, timestamptz, uuid, text) is
  'Owner-only keyset-paginated approval history. Page size is bounded to 100 with no total-history ceiling.';

create or replace function public.owner_client_message_page(
  target_client_id uuid,
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
  owner_seen_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  page_limit integer := least(greatest(coalesce(target_limit, 50), 1), 100);
begin
  if not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  if target_client_id is null then raise exception 'Client id is required.'; end if;
  if (target_cursor_created_at is null) <> (target_cursor_id is null) then
    raise exception 'Pagination cursor is incomplete.';
  end if;

  return query
  select m.id, m.client_id, m.sender_type::text, m.message, m.needs_owner_review,
         m.ai_handled, m.owner_seen_at, m.created_at
  from public.client_messages m
  where m.client_id = target_client_id
    and (target_cursor_created_at is null or (m.created_at, m.id) < (target_cursor_created_at, target_cursor_id))
  order by m.created_at desc, m.id desc
  limit page_limit;
end;
$$;

revoke all on function public.owner_client_message_page(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.owner_client_message_page(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

comment on function public.owner_client_message_page(uuid, integer, timestamptz, uuid) is
  'Owner-only per-client keyset-paginated message thread. Never loads all tenants messages into one browser request.';

create or replace function public.owner_unread_message_page(
  target_limit integer default 25,
  target_cursor_created_at timestamptz default null,
  target_cursor_id uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  business_name text,
  sender_type text,
  message text,
  needs_owner_review boolean,
  ai_handled boolean,
  owner_seen_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  page_limit integer := least(greatest(coalesce(target_limit, 25), 1), 100);
begin
  if not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  if (target_cursor_created_at is null) <> (target_cursor_id is null) then
    raise exception 'Pagination cursor is incomplete.';
  end if;

  return query
  select m.id, m.client_id, c.business_name, m.sender_type::text, m.message,
         m.needs_owner_review, m.ai_handled, m.owner_seen_at, m.created_at
  from public.client_messages m
  join public.clients c on c.id = m.client_id
  where m.sender_type::text = 'client'
    and m.owner_seen_at is null
    and (target_cursor_created_at is null or (m.created_at, m.id) < (target_cursor_created_at, target_cursor_id))
  order by m.created_at desc, m.id desc
  limit page_limit;
end;
$$;

revoke all on function public.owner_unread_message_page(integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.owner_unread_message_page(integer, timestamptz, uuid)
  to authenticated, service_role;

comment on function public.owner_unread_message_page(integer, timestamptz, uuid) is
  'Owner-only keyset-paginated unread client-message feed. Keeps the exception/ping surface bounded while total unread history remains uncapped.';
