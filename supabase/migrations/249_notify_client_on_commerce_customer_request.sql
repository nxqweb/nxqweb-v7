-- Continuation of the read-only end-to-end audit, now covering the Commerce
-- flow. submit_public_commerce_customer_request() (last redefined in
-- migration 242) creates a real commerce_customer_requests row from a real
-- customer's real request, but never notifies the NXQ client that a new
-- request arrived. The parallel event on the Business side
-- (ingest-business-lead/index.ts) already does this correctly
-- ("new_lead"/"urgent_new_lead" notifications) -- Commerce customer
-- requests had no equivalent.
--
-- This migration only adds a notification_deliveries insert to the
-- already-existing function, on the same successful-submission path, using
-- the same channel/recipient_kind pattern already established elsewhere in
-- this schema. No new table, no privilege change: notification_deliveries
-- and its dispatch worker already exist. Every other line of the function
-- body is unchanged from migration 242.
--
-- Note: create_public_protected_commerce_checkout (migrations 090/091) was
-- also checked and is intentionally excluded from this fix -- it is an
-- explicitly test/protected checkout path (is_test: true, payment_provider
-- 'protected_test', metadata.no_customer_contact: true, "no real payment
-- was charged and no customer was contacted"), not a real customer
-- transaction. Real Commerce purchases go through external Stripe Payment
-- Links, not this RPC.
--
-- This migration is staged for review; it has not been applied to any
-- database.

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

  insert into public.notification_deliveries(
    client_id,channel,recipient_kind,template_key,subject,body,priority,metadata
  ) values (
    v_storefront.client_id,'in_app','client','new_commerce_request',
    'New Commerce customer request',
    v_customer_name||' submitted a '||v_request_type||' request: '||v_product_name||'.',
    'normal',
    jsonb_build_object('request_id',v_row.id,'request_type',v_request_type,'product_name',v_product_name)
  );

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

revoke all on function public.submit_public_commerce_customer_request(text, jsonb)
  from public;
grant execute on function public.submit_public_commerce_customer_request(text, jsonb) to anon, authenticated;

comment on function public.submit_public_commerce_customer_request(text, jsonb) is
  'Accepts a public Commerce customer request and notifies the client in-app -- identical to migration 242''s version except for the added notification_deliveries insert.';
