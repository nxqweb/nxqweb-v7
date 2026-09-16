begin;

create or replace function public.resolve_commerce_request_reference_upload(
  target_request_id uuid,
  upload_ticket text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.commerce_request_reference_upload_tickets%rowtype;
begin
  if target_request_id is null or length(coalesce(upload_ticket, '')) <> 64 then
    raise exception 'Upload authorization is invalid.';
  end if;

  select * into v_ticket
  from public.commerce_request_reference_upload_tickets
  where request_id = target_request_id
    and token_hash = encode(digest(upload_ticket, 'sha256'), 'hex');

  if not found or v_ticket.revoked_at is not null or v_ticket.expires_at <= now()
     or v_ticket.uploaded_file_count >= v_ticket.expected_file_count then
    raise exception 'Upload authorization is invalid or expired.';
  end if;

  return jsonb_build_object(
    'client_id', v_ticket.client_id,
    'remaining_file_count', v_ticket.expected_file_count - v_ticket.uploaded_file_count,
    'max_file_size_bytes', v_ticket.max_file_size_bytes,
    'expires_at', v_ticket.expires_at
  );
end;
$$;

create or replace function public.register_commerce_request_reference_upload(
  target_request_id uuid,
  upload_ticket text,
  target_storage_path text,
  target_file_name text,
  target_file_type text,
  target_file_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_ticket public.commerce_request_reference_upload_tickets%rowtype;
  v_file public.client_files%rowtype;
  v_path text := btrim(coalesce(target_storage_path, ''));
  v_name text := btrim(coalesce(target_file_name, ''));
  v_type text := lower(btrim(coalesce(target_file_type, '')));
  v_prefix text;
begin
  if target_request_id is null or length(coalesce(upload_ticket, '')) <> 64 then
    raise exception 'Upload authorization is invalid.';
  end if;

  select * into v_ticket
  from public.commerce_request_reference_upload_tickets
  where request_id = target_request_id
    and token_hash = encode(digest(upload_ticket, 'sha256'), 'hex')
  for update;

  if not found or v_ticket.revoked_at is not null or v_ticket.expires_at <= now()
     or v_ticket.uploaded_file_count >= v_ticket.expected_file_count then
    raise exception 'Upload authorization is invalid or expired.';
  end if;

  v_prefix := v_ticket.client_id::text || '/commerce-requests/' || target_request_id::text || '/';
  if v_path not like (v_prefix || '%') or substring(v_path from length(v_prefix) + 1) !~ '^[0-9a-f-]+\.(jpg|png|webp)$'
     or v_path like '%..%' or v_path like '%//%' then
    raise exception 'Storage path is outside the request tenant namespace.';
  end if;
  if length(v_name) not between 1 and 255 or v_name like '%/%' or position(chr(92) in v_name) > 0
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'File name is invalid.';
  end if;
  if v_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Only JPEG, PNG, and WebP reference images are supported.';
  end if;
  if target_file_size is null or target_file_size < 1 or target_file_size > v_ticket.max_file_size_bytes then
    raise exception 'Reference image size is outside the configured limit.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'client-files' and name = v_path
  ) then
    raise exception 'Uploaded storage object was not found.';
  end if;

  insert into public.client_files (
    client_id, bucket_name, bucket_id, storage_path, file_name, file_type,
    file_size, status, uploaded_at, expires_at
  ) values (
    v_ticket.client_id, 'client-files', 'client-files', v_path, v_name, v_type,
    target_file_size, 'uploaded', now(), now() + interval '30 days'
  ) returning * into v_file;

  insert into public.commerce_customer_request_reference_files (
    request_id, client_file_id, client_id, customer_file_name
  ) values (target_request_id, v_file.id, v_ticket.client_id, v_name);

  update public.commerce_request_reference_upload_tickets
  set uploaded_file_count = uploaded_file_count + 1,
      revoked_at = case when uploaded_file_count + 1 >= expected_file_count then now() else null end
  where request_id = target_request_id;

  insert into public.activity_logs (client_id, actor_type, action, details)
  values (v_ticket.client_id, 'system', 'commerce_request_reference_uploaded', jsonb_build_object(
    'request_id', target_request_id,
    'client_file_id', v_file.id,
    'file_name', v_name,
    'file_size', target_file_size,
    'file_type', v_type,
    'tenant_namespaced', true,
    'quarantine_required', true
  ));

  return jsonb_build_object(
    'ok', true,
    'client_file_id', v_file.id,
    'quarantine_status', 'restricted',
    'scan_required', true
  );
end;
$$;

revoke all on function public.resolve_commerce_request_reference_upload(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.register_commerce_request_reference_upload(uuid, text, text, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_commerce_request_reference_upload(uuid, text) to service_role;
grant execute on function public.register_commerce_request_reference_upload(uuid, text, text, text, text, bigint) to service_role;

commit;
