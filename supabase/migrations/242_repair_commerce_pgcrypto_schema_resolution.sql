begin;

create or replace function public.submit_public_commerce_customer_request(
  store_slug_input text,
  request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_storefront public.commerce_storefronts%rowtype;
  v_settings public.commerce_request_settings%rowtype;
  v_request_type text;
  v_customer_name text;
  v_customer_email text;
  v_product_name text;
  v_description text;
  v_budget text;
  v_needed_by date;
  v_quantity integer;
  v_preferred_contact text;
  v_upload_count integer := 0;
  v_upload_ticket text;
  v_upload_ticket_expires_at timestamptz;
  v_row public.commerce_customer_requests%rowtype;
  v_recent_count integer;
begin
  if nullif(trim(coalesce(request_payload->>'company_website', '')), '') is not null then
    raise exception 'Request could not be submitted';
  end if;

  select * into v_storefront
  from public.commerce_storefronts
  where store_slug = lower(trim(store_slug_input))
  limit 1;

  if v_storefront.id is null then raise exception 'Storefront not found'; end if;

  select * into v_settings
  from public.commerce_request_settings
  where client_id = v_storefront.client_id;

  if v_settings.client_id is null or not v_settings.enabled then
    raise exception 'Customer requests are not enabled for this storefront';
  end if;

  if auth.uid() is null and not v_settings.allow_guest_requests then
    raise exception 'Guest requests are not enabled for this storefront';
  end if;

  v_request_type := lower(trim(coalesce(request_payload->>'request_type', '')));
  v_customer_name := trim(coalesce(request_payload->>'customer_name', ''));
  v_customer_email := lower(trim(coalesce(request_payload->>'customer_email', '')));
  v_product_name := trim(coalesce(request_payload->>'product_name', ''));
  v_description := trim(coalesce(request_payload->>'description', ''));
  v_budget := nullif(trim(coalesce(request_payload->>'budget_range', '')), '');
  v_preferred_contact := lower(trim(coalesce(request_payload->>'preferred_contact_method', 'email')));

  if not (v_request_type = any(v_settings.allowed_request_types)) then raise exception 'That request type is not available'; end if;
  if length(v_customer_name) < 2 or length(v_customer_name) > 120 then raise exception 'Enter a valid name'; end if;
  if v_customer_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  if length(v_product_name) < 2 or length(v_product_name) > 160 then raise exception 'Enter a valid request title'; end if;
  if length(v_description) < 10 or length(v_description) > 5000 then raise exception 'Request details must be between 10 and 5000 characters'; end if;
  if v_preferred_contact not in ('email','phone','text') then v_preferred_contact := 'email'; end if;
  if v_settings.require_budget and v_budget is null then raise exception 'A budget is required'; end if;

  begin
    v_quantity := nullif(request_payload->>'desired_quantity', '')::integer;
  exception when others then
    raise exception 'Quantity must be a whole number';
  end;
  if v_quantity is not null and (v_quantity < 1 or v_quantity > 100000) then raise exception 'Quantity is outside the allowed range'; end if;

  begin
    v_needed_by := nullif(request_payload->>'needed_by_date', '')::date;
  exception when others then
    raise exception 'Enter a valid needed-by date';
  end;
  if v_settings.require_needed_by_date and v_needed_by is null then raise exception 'A needed-by date is required'; end if;

  begin
    v_upload_count := coalesce(nullif(request_payload->>'reference_upload_count', '')::integer, 0);
  exception when others then
    raise exception 'Reference image count must be a whole number';
  end;
  if v_upload_count < 0 or v_upload_count > v_settings.max_images_per_request then
    raise exception 'Too many reference images were selected';
  end if;
  if v_upload_count > 0 and not v_settings.allow_image_uploads then
    raise exception 'Reference image uploads are not enabled';
  end if;

  select count(*) into v_recent_count
  from public.commerce_customer_requests
  where client_id = v_storefront.client_id
    and customer_email = v_customer_email
    and created_at > now() - interval '1 hour';

  if v_recent_count >= 5 then raise exception 'Too many recent requests. Please try again later'; end if;

  insert into public.commerce_customer_requests (
    client_id, request_type, customer_name, customer_email,
    preferred_contact_method, product_name, description,
    desired_quantity, budget_range, needed_by_date, reference_urls
  ) values (
    v_storefront.client_id, v_request_type, v_customer_name, v_customer_email,
    v_preferred_contact, v_product_name, v_description,
    v_quantity, v_budget, v_needed_by, '{}'
  ) returning * into v_row;

  if v_upload_count > 0 then
    v_upload_ticket := encode(gen_random_bytes(32), 'hex');
    v_upload_ticket_expires_at := now() + interval '15 minutes';
    insert into public.commerce_request_reference_upload_tickets (
      request_id, client_id, token_hash, expected_file_count,
      max_file_size_bytes, expires_at
    ) values (
      v_row.id, v_row.client_id, encode(extensions.digest(v_upload_ticket, 'sha256'), 'hex'),
      v_upload_count, v_settings.max_image_size_mb::bigint * 1024 * 1024,
      v_upload_ticket_expires_at
    );
  end if;

  return jsonb_build_object(
    'request_id', v_row.id,
    'confirmation_message', v_settings.confirmation_message,
    'response_time_text', v_settings.response_time_text,
    'upload_ticket', v_upload_ticket,
    'upload_ticket_expires_at', v_upload_ticket_expires_at
  );
end;
$$;

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
    and token_hash = encode(extensions.digest(upload_ticket, 'sha256'), 'hex');

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
    and token_hash = encode(extensions.digest(upload_ticket, 'sha256'), 'hex')
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

revoke all on function public.submit_public_commerce_customer_request(text, jsonb)
  from public;
revoke all on function public.resolve_commerce_request_reference_upload(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.register_commerce_request_reference_upload(uuid, text, text, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_public_commerce_customer_request(text, jsonb) to anon, authenticated;
grant execute on function public.resolve_commerce_request_reference_upload(uuid, text) to service_role;
grant execute on function public.register_commerce_request_reference_upload(uuid, text, text, text, text, bigint) to service_role;

commit;
