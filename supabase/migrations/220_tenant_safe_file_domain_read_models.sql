-- Tenant-derived, cursor-paginated Client Portal read models for files and domains.
-- Keep page sizes bounded while allowing unbounded per-client history.

create index if not exists client_files_client_uploaded_id_desc_idx
  on public.client_files(client_id, uploaded_at desc, id desc);

create index if not exists client_domains_client_requested_id_desc_idx
  on public.client_domains(client_id, requested_at desc, id desc);

create or replace function public.current_client_file_page(
  target_limit integer default 50,
  target_cursor_uploaded_at timestamptz default null,
  target_cursor_id uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  bucket_id text,
  storage_path text,
  file_name text,
  file_type text,
  file_size bigint,
  status text,
  uploaded_at timestamptz,
  expires_at timestamptz,
  scan_status text,
  quarantine_status text,
  scan_last_error text,
  scanned_at timestamptz,
  findings jsonb
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

  return query
  select
    f.id,
    f.client_id,
    f.bucket_id::text,
    f.storage_path::text,
    f.file_name::text,
    f.file_type::text,
    f.file_size::bigint,
    f.status::text,
    f.uploaded_at,
    f.expires_at,
    s.status::text as scan_status,
    s.quarantine_status::text,
    s.last_error::text as scan_last_error,
    s.scanned_at,
    s.findings::jsonb
  from public.client_files f
  left join public.client_file_security_scans s on s.client_file_id = f.id and s.client_id = f.client_id
  where f.client_id = client_uuid
    and coalesce(f.status::text, '') <> 'deleted'
    and (
      target_cursor_uploaded_at is null
      or (f.uploaded_at, f.id) < (target_cursor_uploaded_at, target_cursor_id)
    )
  order by f.uploaded_at desc, f.id desc
  limit page_limit;
end;
$$;

create or replace function public.current_client_domain_page(
  target_limit integer default 50,
  target_cursor_requested_at timestamptz default null,
  target_cursor_id uuid default null
)
returns table (
  id uuid,
  domain_name text,
  status text,
  automation_state text,
  automation_enabled boolean,
  dns_status text,
  ssl_status text,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  automation_error text,
  action_required_message text,
  dns_instructions text,
  registrar_name text,
  dns_provider text,
  requested_at timestamptz
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

  return query
  select
    d.id,
    d.domain_name::text,
    d.status::text,
    d.automation_state::text,
    d.automation_enabled,
    d.dns_status::text,
    d.ssl_status::text,
    d.last_checked_at,
    d.next_check_at,
    d.automation_error::text,
    d.action_required_message::text,
    d.dns_instructions::text,
    d.registrar_name::text,
    d.dns_provider::text,
    d.requested_at
  from public.client_domains d
  where d.client_id = client_uuid
    and (
      target_cursor_requested_at is null
      or (d.requested_at, d.id) < (target_cursor_requested_at, target_cursor_id)
    )
  order by d.requested_at desc, d.id desc
  limit page_limit;
end;
$$;

revoke all on function public.current_client_file_page(integer, timestamptz, uuid) from public, anon;
revoke all on function public.current_client_domain_page(integer, timestamptz, uuid) from public, anon;
grant execute on function public.current_client_file_page(integer, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.current_client_domain_page(integer, timestamptz, uuid) to authenticated, service_role;

comment on function public.current_client_file_page(integer, timestamptz, uuid) is
  'Auth-derived, keyset-paginated client file read model. Page size is bounded; total tenant history is not.';
comment on function public.current_client_domain_page(integer, timestamptz, uuid) is
  'Auth-derived, keyset-paginated client domain read model. Stable contract can be moved behind future shard/region placement.';
