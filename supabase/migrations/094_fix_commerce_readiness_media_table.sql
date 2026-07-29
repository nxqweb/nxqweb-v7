-- Forward-only repair for Commerce launch readiness.
-- The catalog media table is commerce_product_media, not commerce_product_images.

create or replace function public.get_my_commerce_launch_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_row public.commerce_storefronts%rowtype;
  intake_row public.commerce_intakes%rowtype;
  readiness jsonb;
  product_count integer;
  active_variant_count integer;
  image_count integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  select * into storefront_row
  from public.commerce_storefronts
  where client_id = client_uuid;

  if storefront_row.id is null then
    perform public.ensure_my_commerce_storefront();
    select * into storefront_row
    from public.commerce_storefronts
    where client_id = client_uuid;
  end if;

  select * into intake_row
  from public.commerce_intakes
  where client_id = client_uuid;

  perform public.release_expired_commerce_reservations(storefront_row.id);

  readiness := coalesce(storefront_row.settings->'launch_readiness', '{}'::jsonb);

  select count(*) into product_count
  from public.commerce_products
  where storefront_id = storefront_row.id
    and status <> 'archived';

  select count(*) into active_variant_count
  from public.commerce_product_variants
  where storefront_id = storefront_row.id
    and is_active = true;

  select count(*) into image_count
  from public.commerce_product_media
  where storefront_id = storefront_row.id;

  return jsonb_build_object(
    'storefront', jsonb_build_object(
      'id', storefront_row.id,
      'store_name', storefront_row.store_name,
      'status', storefront_row.status,
      'payment_mode', storefront_row.payment_mode,
      'shipping_mode', storefront_row.shipping_mode,
      'tax_mode', storefront_row.tax_mode
    ),
    'settings', readiness,
    'checks', jsonb_build_array(
      jsonb_build_object('key','setup','label','Commerce setup submitted or approved','passed',coalesce(intake_row.status,'draft') in ('submitted','approved')),
      jsonb_build_object('key','products','label','At least one product exists','passed',product_count > 0),
      jsonb_build_object('key','variants','label','At least one active product variant exists','passed',active_variant_count > 0),
      jsonb_build_object('key','images','label','At least one product image exists','passed',image_count > 0),
      jsonb_build_object('key','fulfillment','label','Shipping regions or local pickup configured','passed',trim(coalesce(readiness->>'shipping_regions','')) <> '' or coalesce((readiness->>'pickup_enabled')::boolean,false)),
      jsonb_build_object('key','tax','label','Tax requirements confirmed','passed',coalesce((readiness->>'tax_registration_confirmed')::boolean,false),'note','Confirm requirements with a qualified professional or government source.'),
      jsonb_build_object('key','policies','label','Returns, refund, privacy, and terms are written','passed',
        trim(coalesce(readiness->>'returns_policy','')) <> '' and trim(coalesce(readiness->>'refund_policy','')) <> '' and
        trim(coalesce(readiness->>'privacy_policy','')) <> '' and trim(coalesce(readiness->>'terms_of_sale','')) <> ''),
      jsonb_build_object('key','support','label','Customer support email is configured','passed',trim(coalesce(readiness->>'support_email','')) <> ''),
      jsonb_build_object('key','payment','label','Live payment provider connected','passed',false,'blocked',true,'note','Intentionally disabled in this non-payment readiness update.')
    ),
    'payment_blocked', true,
    'can_publish_without_payments', false,
    'notification_delivery_connected', false,
    'notification_events', (select count(*) from public.commerce_notification_events where storefront_id = storefront_row.id)
  );
end;
$$;

revoke all on function public.get_my_commerce_launch_readiness() from public;
grant execute on function public.get_my_commerce_launch_readiness() to authenticated;
