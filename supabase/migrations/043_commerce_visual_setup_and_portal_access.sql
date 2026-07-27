-- Advanced Commerce design intake and guarded client portal access.
-- These settings describe the future storefront; they do not publish code or activate payments.

alter table public.commerce_intakes
  add column if not exists scroll_behavior text not null default 'smooth'
    check (scroll_behavior in ('standard','smooth','section_snap','custom')),
  add column if not exists animation_intensity text not null default 'balanced'
    check (animation_intensity in ('none','subtle','balanced','cinematic','custom')),
  add column if not exists section_reveal_style text not null default 'fade_up'
    check (section_reveal_style in ('none','fade_up','slide_up','slide_side','scale','mixed','custom')),
  add column if not exists page_transition_style text not null default 'fade'
    check (page_transition_style in ('none','fade','slide','morph','custom')),
  add column if not exists product_card_hover_style text not null default 'lift'
    check (product_card_hover_style in ('none','lift','image_swap','zoom','glow','custom')),
  add column if not exists layout_style text not null default 'modern_grid'
    check (layout_style in ('modern_grid','editorial','minimal','luxury','bold','custom')),
  add column if not exists parallax_enabled boolean not null default false,
  add column if not exists sticky_sections_enabled boolean not null default false,
  add column if not exists horizontal_scroll_enabled boolean not null default false,
  add column if not exists reduce_motion_mobile boolean not null default true,
  add column if not exists inspiration_urls text,
  add column if not exists animation_notes text;

create or replace function public.get_my_commerce_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  family_slug text;
  intake_status text;
begin
  client_uuid := public.current_client_id();

  if client_uuid is null then
    return jsonb_build_object('allowed', false, 'reason', 'client_not_found');
  end if;

  select family.slug
  into family_slug
  from public.clients client
  left join public.product_families family on family.id = client.product_family_id
  where client.id = client_uuid;

  select status
  into intake_status
  from public.commerce_intakes
  where client_id = client_uuid;

  return jsonb_build_object(
    'allowed', family_slug = 'commerce',
    'family_slug', family_slug,
    'setup_status', intake_status
  );
end;
$$;

revoke all on function public.get_my_commerce_access() from public, anon;
grant execute on function public.get_my_commerce_access() to authenticated;

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
  transition_value text;
  scroll_value text;
  animation_value text;
  reveal_value text;
  transition_style_value text;
  hover_value text;
  layout_value text;
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

  transition_value := coalesce(nullif(intake_payload->>'website_transition_mode',''), existing_row.website_transition_mode, 'not_selected');
  scroll_value := coalesce(nullif(intake_payload->>'scroll_behavior',''), 'smooth');
  animation_value := coalesce(nullif(intake_payload->>'animation_intensity',''), 'balanced');
  reveal_value := coalesce(nullif(intake_payload->>'section_reveal_style',''), 'fade_up');
  transition_style_value := coalesce(nullif(intake_payload->>'page_transition_style',''), 'fade');
  hover_value := coalesce(nullif(intake_payload->>'product_card_hover_style',''), 'lift');
  layout_value := coalesce(nullif(intake_payload->>'layout_style',''), 'modern_grid');

  if transition_value not in ('not_selected','new_build','replace_existing','rebuild_with_existing_content','connect_existing_supported_site','nxq_review') then
    raise exception 'Invalid website transition choice.';
  end if;
  if scroll_value not in ('standard','smooth','section_snap','custom') then raise exception 'Invalid scroll behavior.'; end if;
  if animation_value not in ('none','subtle','balanced','cinematic','custom') then raise exception 'Invalid animation intensity.'; end if;
  if reveal_value not in ('none','fade_up','slide_up','slide_side','scale','mixed','custom') then raise exception 'Invalid section reveal style.'; end if;
  if transition_style_value not in ('none','fade','slide','morph','custom') then raise exception 'Invalid page transition style.'; end if;
  if hover_value not in ('none','lift','image_swap','zoom','glow','custom') then raise exception 'Invalid product card hover style.'; end if;
  if layout_value not in ('modern_grid','editorial','minimal','luxury','bold','custom') then raise exception 'Invalid storefront layout style.'; end if;

  clean_status := case when submit_for_review then 'submitted' else 'draft' end;

  insert into public.commerce_intakes (
    client_id, status, store_name, business_model, product_count_range, product_types,
    category_plan, inventory_method, low_stock_rules, fulfillment_methods, shipping_regions,
    local_pickup_details, tax_requirements, customer_accounts_preference,
    guest_checkout_preference, returns_policy, refund_policy, payment_requirements,
    requested_payment_provider, current_store_url, product_data_source, integrations,
    storefront_style, brand_assets_notes, required_pages, special_features,
    launch_priority, additional_notes, website_transition_mode, scroll_behavior,
    animation_intensity, section_reveal_style, page_transition_style,
    product_card_hover_style, layout_style, parallax_enabled,
    sticky_sections_enabled, horizontal_scroll_enabled, reduce_motion_mobile,
    inspiration_urls, animation_notes, submitted_at, updated_at
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
    transition_value,
    scroll_value,
    animation_value,
    reveal_value,
    transition_style_value,
    hover_value,
    layout_value,
    coalesce((intake_payload->>'parallax_enabled')::boolean, false),
    coalesce((intake_payload->>'sticky_sections_enabled')::boolean, false),
    coalesce((intake_payload->>'horizontal_scroll_enabled')::boolean, false),
    coalesce((intake_payload->>'reduce_motion_mobile')::boolean, true),
    nullif(trim(coalesce(intake_payload->>'inspiration_urls','')), ''),
    nullif(trim(coalesce(intake_payload->>'animation_notes','')), ''),
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
    website_transition_mode = excluded.website_transition_mode,
    scroll_behavior = excluded.scroll_behavior,
    animation_intensity = excluded.animation_intensity,
    section_reveal_style = excluded.section_reveal_style,
    page_transition_style = excluded.page_transition_style,
    product_card_hover_style = excluded.product_card_hover_style,
    layout_style = excluded.layout_style,
    parallax_enabled = excluded.parallax_enabled,
    sticky_sections_enabled = excluded.sticky_sections_enabled,
    horizontal_scroll_enabled = excluded.horizontal_scroll_enabled,
    reduce_motion_mobile = excluded.reduce_motion_mobile,
    inspiration_urls = excluded.inspiration_urls,
    animation_notes = excluded.animation_notes,
    submitted_at = case when submit_for_review then now() else public.commerce_intakes.submitted_at end,
    updated_at = now()
  returning * into saved_row;

  if submit_for_review then
    insert into public.owner_approval_requests (
      client_id, request_type, title, summary, recommended_action, risk_level, options
    )
    select
      client_uuid,
      'commerce_intake_review',
      'Commerce intake ready for review',
      format('Commerce setup for %s has been submitted. Transition: %s. Layout: %s. Motion: %s.', clean_store_name, transition_value, layout_value, animation_value),
      'Review migration, storefront design, motion settings, fulfillment, and checkout requirements before beginning the build.',
      'medium'::public.risk_level,
      '["review_commerce_intake"]'::jsonb
    where not exists (
      select 1 from public.owner_approval_requests
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

revoke all on function public.get_my_commerce_access() from public, anon;
revoke all on function public.save_my_commerce_intake(jsonb, boolean) from public, anon;
grant execute on function public.get_my_commerce_access() to authenticated;
grant execute on function public.save_my_commerce_intake(jsonb, boolean) to authenticated;

comment on function public.get_my_commerce_access() is
  'Returns whether the authenticated client is currently assigned to NXQ Commerce.';
