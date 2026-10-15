-- DRAFT (not applied): store-branded order numbers (owner request 2026-10-15: customers of a client's store should not see 'NXQ-').
--
-- Today every direct-payment order number starts with 'NXQ-' (set inside create_public_direct_payment_order, migration 115). This draft
-- leaves that function untouched and changes only the wrapper the storefront actually calls (create_public_stripe_ready_direct_payment_order,
-- migration 227): after the order is created it swaps the 'NXQ' prefix for the store's own prefix, keeping the same random suffix.
--  * Prefix: an owner/ops override in storefront settings->>'order_prefix' (2-6 letters/digits), otherwise the initials of the store name
--    (up to 4 words, e.g. 'Rehearsal Candle Co' -> RCC), otherwise the first 3 letters of a one-word name (Candles -> CAN), otherwise ORD.
--    A derived prefix of 'NXQ' falls back to ORD so a store never shows the platform name by accident.
--  * Existing orders keep their numbers. Inventory reservations and order events reference the order id, not the number, so nothing else changes.
--  * Orders created through other paths (protected test checkout, legacy primitive called directly) are not touched.
--  * The swap is inside the same transaction as the order, so a failure rolls the whole order back.

create or replace function public.nxq_store_order_prefix(store_name_value text, settings_value jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  custom_value text := upper(coalesce(settings_value->>'order_prefix', ''));
  initials text;
  cleaned text;
  derived text;
begin
  if custom_value ~ '^[A-Z0-9]{2,6}$' then
    return custom_value;
  end if;

  select string_agg(upper(substr(word, 1, 1)), '' order by word_no) into initials
  from (
    select word, word_no
    from regexp_split_to_table(regexp_replace(coalesce(store_name_value, ''), '[^A-Za-z0-9 ]', '', 'g'), '\s+') with ordinality as parts(word, word_no)
    where word <> ''
    order by word_no
    limit 4
  ) first_words;

  if length(coalesce(initials, '')) >= 2 then
    derived := initials;
  else
    cleaned := upper(regexp_replace(coalesce(store_name_value, ''), '[^A-Za-z0-9]', '', 'g'));
    derived := case when length(cleaned) >= 2 then substr(cleaned, 1, 3) else 'ORD' end;
  end if;

  if derived = 'NXQ' then derived := 'ORD'; end if;
  return derived;
end;
$$;

create or replace function public.create_public_stripe_ready_direct_payment_order(
  store_slug_value text,
  items_payload jsonb,
  customer_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  result jsonb;
  stripe_link text;
  storefront_uuid uuid;
  original_settings jsonb;
  legacy_link_present boolean:=false;
  qa_only_client boolean:=false;
  store_name_value text;
  prefix_value text;
  new_number text;
  changed integer;
begin
  select s.id,s.settings,nullif(s.settings->>'stripe_payment_link',''),
         nullif(s.settings->>'paypal_url','') is not null or nullif(s.settings->>'venmo_url','') is not null,
         coalesce(c.qa_only,false),s.store_name
  into storefront_uuid,original_settings,stripe_link,legacy_link_present,qa_only_client,store_name_value
  from public.commerce_storefronts s
  join public.clients c on c.id=s.client_id
  where s.store_slug=store_slug_value and s.status='active'
  for update of s;

  if storefront_uuid is null then raise exception 'Storefront is not available.'; end if;
  if qa_only_client then raise exception 'Billing artifacts are forbidden for QA-only clients.'; end if;
  if stripe_link is null and not legacy_link_present then raise exception 'This storefront does not have a direct payment method available.'; end if;

  -- The hardened legacy order primitive validates PayPal/Venmo before creating
  -- inventory reservations. For a Stripe-only storefront, provide the verified
  -- public Stripe link as a transaction-local compatibility value, invoke the
  -- same hardened primitive, then restore the exact settings before commit.
  -- Other sessions never observe the temporary value.
  if stripe_link is not null and not legacy_link_present then
    update public.commerce_storefronts
    set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{paypal_url}',to_jsonb(stripe_link),true)
    where id=storefront_uuid;
  end if;

  result:=public.create_public_direct_payment_order(store_slug_value,items_payload,customer_payload);

  if stripe_link is not null and not legacy_link_present then
    update public.commerce_storefronts set settings=original_settings where id=storefront_uuid;
    result:=(result-'paypal_url'-'venmo_url');
  end if;

  -- Customer-facing order numbers carry the store's own prefix instead of the platform's 'NXQ-'. Only the number changes: inventory
  -- reservations and order events point at the order id. The random suffix is the one the order primitive already generated.
  prefix_value:=public.nxq_store_order_prefix(store_name_value,original_settings);
  new_number:=prefix_value||'-'||split_part(result->>'order_number','-',2);
  update public.commerce_orders
  set order_number=new_number,updated_at=now()
  where id=(result->>'order_id')::uuid and storefront_id=storefront_uuid and order_number=result->>'order_number';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Order number could not be assigned.'; end if;
  result:=result||jsonb_build_object('order_number',new_number);

  return result||jsonb_build_object(
    'stripe_payment_link',stripe_link,
    'preferred_payment_provider',case when stripe_link is not null then 'stripe' else 'legacy_direct_link' end
  );
end;
$$;

revoke all on function public.nxq_store_order_prefix(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_public_stripe_ready_direct_payment_order(text,jsonb,jsonb) from public;
grant execute on function public.create_public_stripe_ready_direct_payment_order(text,jsonb,jsonb) to anon,authenticated;
