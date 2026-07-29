begin;

create table if not exists public.commerce_request_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default false,
  allow_guest_requests boolean not null default true,
  allow_image_uploads boolean not null default true,
  require_budget boolean not null default false,
  require_needed_by_date boolean not null default false,
  max_images_per_request integer not null default 3 check (max_images_per_request between 0 and 10),
  max_image_size_mb integer not null default 8 check (max_image_size_mb between 1 and 20),
  response_time_text text not null default 'We usually respond within 2 business days.',
  custom_instructions text not null default '',
  confirmation_message text not null default 'Your request was sent successfully. We will review it and contact you soon.',
  notification_email text,
  allowed_request_types text[] not null default array['custom_product','new_option','restock','bulk_order','personalized','general_suggestion']::text[],
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_customer_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  request_type text not null,
  customer_name text not null,
  customer_email text not null,
  preferred_contact_method text not null default 'email',
  product_name text not null,
  description text not null,
  desired_quantity integer,
  budget_range text,
  needed_by_date date,
  reference_urls text[] not null default '{}',
  status text not null default 'new' check (status in ('new','reviewing','need_more_information','accepted','declined','quoted','in_progress','completed')),
  client_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_customer_requests_client_created_idx
  on public.commerce_customer_requests (client_id, created_at desc);

alter table public.commerce_request_settings enable row level security;
alter table public.commerce_customer_requests enable row level security;

revoke all on public.commerce_request_settings from anon, authenticated;
revoke all on public.commerce_customer_requests from anon, authenticated;

grant select, insert, update on public.commerce_request_settings to authenticated;
grant select, insert, update on public.commerce_customer_requests to authenticated;

create or replace function public.get_my_commerce_request_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_result jsonb;
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then raise exception 'Client workspace not found'; end if;

  insert into public.commerce_request_settings (client_id)
  values (v_client_id)
  on conflict (client_id) do nothing;

  select to_jsonb(s) into v_result
  from public.commerce_request_settings s
  where s.client_id = v_client_id;

  return v_result;
end;
$$;

create or replace function public.save_my_commerce_request_settings(settings_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_allowed text[];
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then raise exception 'Client workspace not found'; end if;

  select coalesce(array_agg(value), '{}') into v_allowed
  from jsonb_array_elements_text(coalesce(settings_payload->'allowed_request_types', '[]'::jsonb));

  insert into public.commerce_request_settings (
    client_id, enabled, allow_guest_requests, allow_image_uploads, require_budget,
    require_needed_by_date, max_images_per_request, max_image_size_mb,
    response_time_text, custom_instructions, confirmation_message,
    notification_email, allowed_request_types, updated_at
  ) values (
    v_client_id,
    coalesce((settings_payload->>'enabled')::boolean, false),
    coalesce((settings_payload->>'allow_guest_requests')::boolean, true),
    coalesce((settings_payload->>'allow_image_uploads')::boolean, true),
    coalesce((settings_payload->>'require_budget')::boolean, false),
    coalesce((settings_payload->>'require_needed_by_date')::boolean, false),
    greatest(0, least(10, coalesce((settings_payload->>'max_images_per_request')::integer, 3))),
    greatest(1, least(20, coalesce((settings_payload->>'max_image_size_mb')::integer, 8))),
    coalesce(settings_payload->>'response_time_text', ''),
    coalesce(settings_payload->>'custom_instructions', ''),
    coalesce(settings_payload->>'confirmation_message', ''),
    nullif(settings_payload->>'notification_email', ''),
    v_allowed,
    now()
  )
  on conflict (client_id) do update set
    enabled = excluded.enabled,
    allow_guest_requests = excluded.allow_guest_requests,
    allow_image_uploads = excluded.allow_image_uploads,
    require_budget = excluded.require_budget,
    require_needed_by_date = excluded.require_needed_by_date,
    max_images_per_request = excluded.max_images_per_request,
    max_image_size_mb = excluded.max_image_size_mb,
    response_time_text = excluded.response_time_text,
    custom_instructions = excluded.custom_instructions,
    confirmation_message = excluded.confirmation_message,
    notification_email = excluded.notification_email,
    allowed_request_types = excluded.allowed_request_types,
    updated_at = now();

  return public.get_my_commerce_request_settings();
end;
$$;

create or replace function public.list_my_commerce_customer_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then raise exception 'Client workspace not found'; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_at desc)
    from public.commerce_customer_requests r
    where r.client_id = v_client_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.update_my_commerce_customer_request(
  request_id uuid,
  new_status text,
  new_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_row public.commerce_customer_requests;
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then raise exception 'Client workspace not found'; end if;
  if new_status not in ('new','reviewing','need_more_information','accepted','declined','quoted','in_progress','completed') then
    raise exception 'Invalid request status';
  end if;

  update public.commerce_customer_requests
  set status = new_status, client_note = coalesce(new_note, ''), updated_at = now()
  where id = request_id and client_id = v_client_id
  returning * into v_row;

  if v_row.id is null then raise exception 'Request not found'; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.create_protected_test_commerce_request()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_row public.commerce_customer_requests;
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then raise exception 'Client workspace not found'; end if;

  insert into public.commerce_customer_requests (
    client_id, request_type, customer_name, customer_email, product_name,
    description, desired_quantity, budget_range, preferred_contact_method
  ) values (
    v_client_id, 'custom_product', 'Protected Test Customer', 'test@example.com',
    'Custom candle request', 'Testing only. No customer was contacted and no order was created.',
    1, '$20-$40', 'email'
  ) returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.get_my_commerce_request_settings() to authenticated;
grant execute on function public.save_my_commerce_request_settings(jsonb) to authenticated;
grant execute on function public.list_my_commerce_customer_requests() to authenticated;
grant execute on function public.update_my_commerce_customer_request(uuid, text, text) to authenticated;
grant execute on function public.create_protected_test_commerce_request() to authenticated;

commit;
