-- Owner-only Commerce readiness review and guarded intake decisions.

alter table public.commerce_intakes
  add column if not exists owner_review_status text not null default 'pending'
    check (owner_review_status in ('pending','revisions_requested','ready_for_build')),
  add column if not exists owner_reviewed_at timestamptz,
  add column if not exists build_plan jsonb;

create or replace function public.get_owner_commerce_reviews()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'client_id', c.id,
        'business_name', c.business_name,
        'contact_email', c.contact_email,
        'monthly_price', c.monthly_price,
        'intake', to_jsonb(i),
        'storefront_status', s.status,
        'product_count', (select count(*) from public.commerce_products p where p.client_id = c.id),
        'missing_image_count', (
          select count(*) from public.commerce_products p
          where p.client_id = c.id and not exists (
            select 1 from public.commerce_product_media m where m.product_id = p.id
          )
        ),
        'missing_category_count', (
          select count(*) from public.commerce_products p where p.client_id = c.id and p.category_id is null
        ),
        'low_stock_count', (
          select count(*) from public.commerce_product_variants v
          where v.client_id = c.id and greatest(v.on_hand_quantity - v.reserved_quantity, 0) <= v.low_stock_threshold
        ),
        'out_of_stock_count', (
          select count(*) from public.commerce_product_variants v
          where v.client_id = c.id and greatest(v.on_hand_quantity - v.reserved_quantity, 0) <= 0
        )
      ) order by coalesce(i.submitted_at, i.updated_at) desc nulls last
    )
    from public.clients c
    join public.product_families f on f.id = c.product_family_id and f.slug = 'commerce'
    left join public.commerce_intakes i on i.client_id = c.id
    left join public.commerce_storefronts s on s.client_id = c.id
  ), '[]'::jsonb);
end;
$$;

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
  plan jsonb;
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  if decision not in ('request_revisions','mark_ready') then raise exception 'Invalid Commerce review decision.'; end if;

  select * into intake_row from public.commerce_intakes where client_id = target_client_id for update;
  if intake_row.id is null then raise exception 'Commerce intake not found.'; end if;

  if decision = 'request_revisions' then
    update public.commerce_intakes
    set status = 'needs_more_info', owner_review_status = 'revisions_requested', owner_note = nullif(trim(owner_note_text), ''), owner_reviewed_at = now(), updated_at = now()
    where client_id = target_client_id;

    insert into public.client_messages (client_id, sender_type, message, needs_owner_review, ai_handled)
    values (target_client_id, 'owner', coalesce(nullif(trim(owner_note_text), ''), 'NXQ needs a few Commerce setup revisions before the storefront build can begin.'), false, false);

    return jsonb_build_object('status','revisions_requested');
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
    'generated_at', now()
  );

  update public.commerce_intakes
  set status = 'approved', owner_review_status = 'ready_for_build', owner_note = nullif(trim(owner_note_text), ''), owner_reviewed_at = now(), approved_at = now(), build_plan = plan, updated_at = now()
  where client_id = target_client_id;

  insert into public.client_messages (client_id, sender_type, message, needs_owner_review, ai_handled)
  values (target_client_id, 'owner', coalesce(nullif(trim(owner_note_text), ''), 'Your Commerce setup is approved and ready for the storefront build phase.'), false, false);

  return jsonb_build_object('status','ready_for_build','build_plan',plan);
end;
$$;

revoke all on function public.get_owner_commerce_reviews() from public, anon;
revoke all on function public.resolve_owner_commerce_review(uuid,text,text) from public, anon;
grant execute on function public.get_owner_commerce_reviews() to authenticated;
grant execute on function public.resolve_owner_commerce_review(uuid,text,text) to authenticated;
