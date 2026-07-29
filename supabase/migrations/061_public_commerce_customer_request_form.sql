begin;

create or replace function public.get_public_commerce_request_form(store_slug_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_storefront public.commerce_storefronts%rowtype;
  v_settings public.commerce_request_settings%rowtype;
begin
  select * into v_storefront
  from public.commerce_storefronts
  where store_slug = lower(trim(store_slug_input))
  limit 1;

  if v_storefront.id is null then
    raise exception 'Storefront not found';
  end if;

  select * into v_settings
  from public.commerce_request_settings
  where client_id = v_storefront.client_id;

  if v_settings.client_id is null or not v_settings.enabled then
    raise exception 'Customer requests are not enabled for this storefront';
  end if;

  return jsonb_build_object(
    'storefront', jsonb_build_object(
      'store_name', v_storefront.store_name,
      'store_slug', v_storefront.store_slug
    ),
    'settings', jsonb_build_object(
      'allow_guest_requests', v_settings.allow_guest_requests,
      'allow_image_uploads', v_settings.allow_image_uploads,
      'require_budget', v_settings.require_budget,
      'require_needed_by_date', v_settings.require_needed_by_date,
      'max_images_per_request', v_settings.max_images_per_request,
      'max_image_size_mb', v_settings.max_image_size_mb,
      'response_time_text', v_settings.response_time_text,
      'custom_instructions', v_settings.custom_instructions,
      'confirmation_message', v_settings.confirmation_message,
      'allowed_request_types', v_settings.allowed_request_types
    )
  );
end;
$$;

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
  v_reference_urls text[] := '{}';
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

  if v_settings.allow_image_uploads then
    select coalesce(array_agg(trim(value)), '{}') into v_reference_urls
    from jsonb_array_elements_text(coalesce(request_payload->'reference_urls', '[]'::jsonb))
    where nullif(trim(value), '') is not null;

    if cardinality(v_reference_urls) > v_settings.max_images_per_request then
      raise exception 'Too many reference images were provided';
    end if;
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
    v_quantity, v_budget, v_needed_by, v_reference_urls
  ) returning * into v_row;

  return jsonb_build_object(
    'request_id', v_row.id,
    'confirmation_message', v_settings.confirmation_message,
    'response_time_text', v_settings.response_time_text
  );
end;
$$;

revoke all on function public.get_public_commerce_request_form(text) from public;
revoke all on function public.submit_public_commerce_customer_request(text, jsonb) from public;
grant execute on function public.get_public_commerce_request_form(text) to anon, authenticated;
grant execute on function public.submit_public_commerce_customer_request(text, jsonb) to anon, authenticated;

commit;
