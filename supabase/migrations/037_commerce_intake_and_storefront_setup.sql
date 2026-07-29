-- Guarded NXQ Commerce intake and storefront setup.
-- Clients may save or submit their own setup details. Submission does not activate Commerce,
-- connect payments, publish a storefront, or change the client's product-family plan.

create table if not exists public.commerce_intakes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  storefront_id uuid references public.commerce_storefronts(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','submitted','needs_more_info','approved','archived')),
  store_name text,
  business_model text not null default 'physical_products'
    check (business_model in ('physical_products','digital_products','services','mixed')),
  product_count_range text,
  product_types text,
  category_plan text,
  inventory_method text not null default 'track_inventory'
    check (inventory_method in ('track_inventory','made_to_order','unlimited','not_sure')),
  low_stock_rules text,
  fulfillment_methods jsonb not null default '[]'::jsonb,
  shipping_regions text,
  local_pickup_details text,
  tax_requirements text,
  customer_accounts_preference text not null default 'optional'
    check (customer_accounts_preference in ('disabled','optional','required','not_sure')),
  guest_checkout_preference boolean not null default true,
  returns_policy text,
  refund_policy text,
  payment_requirements text,
  requested_payment_provider text,
  current_store_url text,
  product_data_source text,
  integrations text,
  storefront_style text,
  brand_assets_notes text,
  required_pages text,
  special_features text,
  launch_priority text,
  additional_notes text,
  submitted_at timestamptz,
  approved_at timestamptz,
  owner_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_intakes_status_idx
  on public.commerce_intakes(status, submitted_at desc);

alter table public.commerce_intakes enable row level security;

revoke all on table public.commerce_intakes from public, anon;
grant select, insert, update, delete on table public.commerce_intakes to authenticated;

drop policy if exists owner_manage_commerce_intakes on public.commerce_intakes;
create policy owner_manage_commerce_intakes
on public.commerce_intakes
for all
to authenticated
using (public.is_nxq_owner())
with check (public.is_nxq_owner());

drop policy if exists client_view_own_commerce_intake on public.commerce_intakes;
create policy client_view_own_commerce_intake
on public.commerce_intakes
for select
to authenticated
using (client_id = public.current_client_id());

-- Direct client writes stay blocked. The RPC below performs validated writes.

create or replace function public.get_my_commerce_intake()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  intake_row public.commerce_intakes%rowtype;
begin
  client_uuid := public.current_client_id();

  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select * into intake_row
  from public.commerce_intakes
  where client_id = client_uuid;

  if intake_row.id is null then
    return null;
  end if;

  return to_jsonb(intake_row) - 'client_id';
end;
$$;

create or replace function public.save_my_commerce_intake(
  intake_payload jsonb,
  submit_for_review boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  existing_row public.commerce_intakes%rowtype;
  saved_row public.commerce_intakes%rowtype;
  clean_store_name text;
  clean_status text;
  fulfillment_value jsonb;
begin
  client_uuid := public.current_client_id();

  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  if intake_payload is null or jsonb_typeof(intake_payload) <> 'object' then
    raise exception 'Commerce intake payload must be an object.';
  end if;

  select * into existing_row
  from public.commerce_intakes
  where client_id = client_uuid
  for update;

  if existing_row.status in ('approved','archived') then
    raise exception 'This Commerce intake can no longer be edited by the client.';
  end if;

  clean_store_name := nullif(trim(coalesce(intake_payload->>'store_name', '')), '');

  if submit_for_review and clean_store_name is null then
    raise exception 'Store name is required before submission.';
  end if;

  fulfillment_value := coalesce(intake_payload->'fulfillment_methods', '[]'::jsonb);
  if jsonb_typeof(fulfillment_value) <> 'array' then
    raise exception 'Fulfillment methods must be an array.';
  end if;

  clean_status := case when submit_for_review then 'submitted' else 'draft' end;

  insert into public.commerce_intakes (
    client_id,
    status,
    store_name,
    business_model,
    product_count_range,
    product_types,
    category_plan,
    inventory_method,
    low_stock_rules,
    fulfillment_methods,
    shipping_regions,
    local_pickup_details,
    tax_requirements,
    customer_accounts_preference,
    guest_checkout_preference,
    returns_policy,
    refund_policy,
    payment_requirements,
    requested_payment_provider,
    current_store_url,
    product_data_source,
    integrations,
    storefront_style,
    brand_assets_notes,
    required_pages,
    special_features,
    launch_priority,
    additional_notes,
    submitted_at,
    updated_at
  ) values (
    client_uuid,
    clean_status,
    clean_store_name,
    coalesce(nullif(intake_payload->>'business_model',''), 'physical_products'),
    nullif(trim(coalesce(intake_payload->>'product_count_range','')), ''),
    nullif(trim(coalesce(intake_payload->>'product_types','')), ''),
    nullif(trim(coalesce(intake_payload->>'category_plan','')), ''),
    coalesce(nullif(intake_payload->>'inventory_method',''), 'track_inventory'),
    nullif(trim(coalesce(intake_payload->>'low_stock_rules','')), ''),
    fulfillment_value,
    nullif(trim(coalesce(intake_payload->>'shipping_regions','')), ''),
    nullif(trim(coalesce(intake_payload->>'local_pickup_details','')), ''),
    nullif(trim(coalesce(intake_payload->>'tax_requirements','')), ''),
    coalesce(nullif(intake_payload->>'customer_accounts_preference',''), 'optional'),
    coalesce((intake_payload->>'guest_checkout_preference')::boolean, true),
    nullif(trim(coalesce(intake_payload->>'returns_policy','')), ''),
    nullif(trim(coalesce(intake_payload->>'refund_policy','')), ''),
    nullif(trim(coalesce(intake_payload->>'payment_requirements','')), ''),
    nullif(trim(coalesce(intake_payload->>'requested_payment_provider','')), ''),
    nullif(trim(coalesce(intake_payload->>'current_store_url','')), ''),
    nullif(trim(coalesce(intake_payload->>'product_data_source','')), ''),
    nullif(trim(coalesce(intake_payload->>'integrations','')), ''),
    nullif(trim(coalesce(intake_payload->>'storefront_style','')), ''),
    nullif(trim(coalesce(intake_payload->>'brand_assets_notes','')), ''),
    nullif(trim(coalesce(intake_payload->>'required_pages','')), ''),
    nullif(trim(coalesce(intake_payload->>'special_features','')), ''),
    nullif(trim(coalesce(intake_payload->>'launch_priority','')), ''),
    nullif(trim(coalesce(intake_payload->>'additional_notes','')), ''),
    case when submit_for_review then now() else null end,
    now()
  )
  on conflict (client_id) do update set
    status = excluded.status,
    store_name = excluded.store_name,
    business_model = excluded.business_model,
    product_count_range = excluded.product_count_range,
    product_types = excluded.product_types,
    category_plan = excluded.category_plan,
    inventory_method = excluded.inventory_method,
    low_stock_rules = excluded.low_stock_rules,
    fulfillment_methods = excluded.fulfillment_methods,
    shipping_regions = excluded.shipping_regions,
    local_pickup_details = excluded.local_pickup_details,
    tax_requirements = excluded.tax_requirements,
    customer_accounts_preference = excluded.customer_accounts_preference,
    guest_checkout_preference = excluded.guest_checkout_preference,
    returns_policy = excluded.returns_policy,
    refund_policy = excluded.refund_policy,
    payment_requirements = excluded.payment_requirements,
    requested_payment_provider = excluded.requested_payment_provider,
    current_store_url = excluded.current_store_url,
    product_data_source = excluded.product_data_source,
    integrations = excluded.integrations,
    storefront_style = excluded.storefront_style,
    brand_assets_notes = excluded.brand_assets_notes,
    required_pages = excluded.required_pages,
    special_features = excluded.special_features,
    launch_priority = excluded.launch_priority,
    additional_notes = excluded.additional_notes,
    submitted_at = case
      when submit_for_review then now()
      else public.commerce_intakes.submitted_at
    end,
    updated_at = now()
  returning * into saved_row;

  if submit_for_review then
    insert into public.owner_approval_requests (
      client_id,
      request_type,
      title,
      summary,
      recommended_action,
      risk_level,
      options
    )
    select
      client_uuid,
      'commerce_intake_review',
      'Commerce intake ready for review',
      format('Commerce setup for %s has been submitted.', clean_store_name),
      'Review store requirements before enabling Commerce or beginning storefront generation.',
      'medium'::public.risk_level,
      '["review_commerce_intake"]'::jsonb
    where not exists (
      select 1
      from public.owner_approval_requests
      where client_id = client_uuid
        and request_type = 'commerce_intake_review'
        and status = 'pending'
    );
  end if;

  return jsonb_build_object(
    'id', saved_row.id,
    'status', saved_row.status,
    'submitted_at', saved_row.submitted_at,
    'message', case
      when submit_for_review then 'Commerce intake submitted for NXQ review.'
      else 'Commerce intake draft saved.'
    end
  );
end;
$$;

revoke all on function public.get_my_commerce_intake() from public, anon;
revoke all on function public.save_my_commerce_intake(jsonb, boolean) from public, anon;
grant execute on function public.get_my_commerce_intake() to authenticated;
grant execute on function public.save_my_commerce_intake(jsonb, boolean) to authenticated;

comment on table public.commerce_intakes is
  'Structured client Commerce setup requirements. Submission creates an owner review request but does not activate or publish Commerce.';
