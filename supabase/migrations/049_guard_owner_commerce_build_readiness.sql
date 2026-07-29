-- Guard Commerce build readiness at the database boundary.
-- Draft or incomplete Commerce workspaces cannot be marked ready for build.

create or replace function public.resolve_owner_commerce_review(
  target_client_id uuid,
  decision text,
  owner_note_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  intake_row public.commerce_intakes%rowtype;
  product_total integer;
  missing_images integer;
  missing_categories integer;
  blockers jsonb := '[]'::jsonb;
  plan jsonb;
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  if decision not in ('request_revisions','mark_ready') then
    raise exception 'Invalid Commerce review decision.';
  end if;

  select *
  into intake_row
  from public.commerce_intakes
  where client_id = target_client_id
  for update;

  if intake_row.id is null then
    raise exception 'Commerce intake not found.';
  end if;

  if decision = 'request_revisions' then
    update public.commerce_intakes
    set status = 'needs_more_info',
        owner_review_status = 'revisions_requested',
        owner_note = nullif(trim(owner_note_text), ''),
        owner_reviewed_at = now(),
        updated_at = now()
    where client_id = target_client_id;

    insert into public.client_messages (
      client_id, sender_type, message, needs_owner_review, ai_handled
    ) values (
      target_client_id,
      'owner',
      coalesce(
        nullif(trim(owner_note_text), ''),
        'NXQ needs a few Commerce setup revisions before the storefront build can begin.'
      ),
      false,
      false
    );

    return jsonb_build_object('status','revisions_requested');
  end if;

  select count(*)::integer
  into product_total
  from public.commerce_products
  where client_id = target_client_id;

  select count(*)::integer
  into missing_images
  from public.commerce_products p
  where p.client_id = target_client_id
    and not exists (
      select 1
      from public.commerce_product_media m
      where m.product_id = p.id
    );

  select count(*)::integer
  into missing_categories
  from public.commerce_products
  where client_id = target_client_id
    and category_id is null;

  if intake_row.status not in ('submitted','approved') then
    blockers := blockers || jsonb_build_array('Submit the Commerce setup sheet for owner review.');
  end if;

  if product_total <= 0 then
    blockers := blockers || jsonb_build_array('Add at least one product draft.');
  end if;

  if missing_images > 0 then
    blockers := blockers || jsonb_build_array(format('%s product(s) still need a photo.', missing_images));
  end if;

  if missing_categories > 0 then
    blockers := blockers || jsonb_build_array(format('%s product(s) still need a category.', missing_categories));
  end if;

  if jsonb_array_length(blockers) > 0 then
    raise exception 'Commerce workspace is not ready for build: %', blockers::text;
  end if;

  plan := jsonb_build_object(
    'store_name', intake_row.store_name,
    'website_transition_mode', intake_row.website_transition_mode,
    'layout_style', intake_row.layout_style,
    'scroll_behavior', intake_row.scroll_behavior,
    'animation_intensity', intake_row.animation_intensity,
    'fulfillment_methods', intake_row.fulfillment_methods,
    'shipping_regions', intake_row.shipping_regions,
    'payment_provider', intake_row.requested_payment_provider,
    'required_pages', intake_row.required_pages,
    'special_features', intake_row.special_features,
    'product_count', product_total,
    'generated_at', now()
  );

  update public.commerce_intakes
  set status = 'approved',
      owner_review_status = 'ready_for_build',
      owner_note = nullif(trim(owner_note_text), ''),
      owner_reviewed_at = now(),
      approved_at = now(),
      build_plan = plan,
      updated_at = now()
  where client_id = target_client_id;

  insert into public.client_messages (
    client_id, sender_type, message, needs_owner_review, ai_handled
  ) values (
    target_client_id,
    'owner',
    coalesce(
      nullif(trim(owner_note_text), ''),
      'Your Commerce setup is approved and ready for the storefront build phase.'
    ),
    false,
    false
  );

  return jsonb_build_object(
    'status','ready_for_build',
    'build_plan',plan
  );
end;
$$;

revoke all on function public.resolve_owner_commerce_review(uuid,text,text) from public, anon;
grant execute on function public.resolve_owner_commerce_review(uuid,text,text) to authenticated;

comment on function public.resolve_owner_commerce_review(uuid,text,text) is
  'Owner-only Commerce review resolver. Build readiness requires a submitted intake, products, product photos, and categories.';
