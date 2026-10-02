-- Stripe-first billing preparation. Billing and checkout remain disabled until
-- an adult owner explicitly enables them after account and webhook verification.

insert into public.nxq_provider_connections(
  provider_key,provider_category,scope_type,status,capabilities,required_secret_names,config
)
select
  'stripe','payments','global','not_configured',
  array['signed_webhooks','idempotent_event_ingest','ordered_event_apply','server_mapped_customers','payment_restore','past_due_start'],
  array['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],
  jsonb_build_object(
    'webhook_function','ingest-stripe-webhook',
    'online_billing_enabled',false,
    'activation_requires_owner',true,
    'qa_billing_forbidden',true,
    'auto_freeze',false,
    'signature_tolerance_seconds',300
  )
where not exists(
  select 1
  from public.nxq_provider_connections
  where provider_key='stripe' and scope_type='global' and scope_id is null
);

update public.nxq_provider_connections
set capabilities=array['signed_webhooks','idempotent_event_ingest','ordered_event_apply','server_mapped_customers','payment_restore','past_due_start'],
    required_secret_names=array['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'webhook_function','ingest-stripe-webhook',
      'online_billing_enabled',false,
      'activation_requires_owner',true,
      'qa_billing_forbidden',true,
      'auto_freeze',false,
      'signature_tolerance_seconds',300
    ),
    updated_at=now()
where provider_key='stripe' and scope_type='global' and scope_id is null;

create or replace function public.get_my_stripe_ready_storefront_settings()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  result jsonb;
  storefront_uuid uuid;
begin
  result:=public.get_my_live_storefront_settings();
  storefront_uuid:=(result->>'id')::uuid;
  return result||jsonb_build_object(
    'stripe_payment_link',(
      select nullif(settings->>'stripe_payment_link','')
      from public.commerce_storefronts where id=storefront_uuid
    )
  );
end;
$$;

create or replace function public.get_public_stripe_ready_commerce_storefront(store_slug_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
  stripe_link text;
begin
  result:=public.get_public_commerce_storefront(store_slug_value);
  if result is null then return null; end if;
  select nullif(settings->>'stripe_payment_link','') into stripe_link
  from public.commerce_storefronts where store_slug=store_slug_value and status='active';
  return jsonb_set(result,'{store}',coalesce(result->'store','{}'::jsonb)||jsonb_build_object('stripe_payment_link',stripe_link));
end;
$$;

create or replace function public.save_my_stripe_ready_storefront_settings(
  store_name_value text,
  stripe_payment_link_value text default null,
  legacy_paypal_url_value text default null,
  legacy_venmo_url_value text default null,
  payment_note_value text default null,
  make_live boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  client_qa_only boolean:=false;
  clean_stripe text:=nullif(btrim(coalesce(stripe_payment_link_value,'')),'');
  clean_paypal text:=nullif(btrim(coalesce(legacy_paypal_url_value,'')),'');
  clean_venmo text:=nullif(btrim(coalesce(legacy_venmo_url_value,'')),'');
begin
  client_uuid:=public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select coalesce(qa_only,false) into client_qa_only from public.clients where id=client_uuid;
  if client_qa_only then raise exception 'Billing artifacts are forbidden for QA-only clients.'; end if;
  storefront_uuid:=public.ensure_my_commerce_storefront();
  if nullif(btrim(store_name_value),'') is null then raise exception 'Store name is required.'; end if;
  if clean_stripe is not null and clean_stripe !~* '^https://buy\.stripe\.com/[A-Za-z0-9]+' then
    raise exception 'Enter a public Stripe Payment Link beginning with https://buy.stripe.com/.';
  end if;
  if clean_paypal is not null and clean_paypal !~* '^https://(www\.)?(paypal\.me|paypal\.com)/' then raise exception 'Enter a valid legacy PayPal link.'; end if;
  if clean_venmo is not null and clean_venmo !~* '^https://(www\.)?venmo\.com/' then raise exception 'Enter a valid legacy Venmo link.'; end if;
  if make_live and clean_stripe is null and clean_paypal is null and clean_venmo is null then raise exception 'Add a public payment link before opening the store.'; end if;

  update public.commerce_storefronts
  set store_name=btrim(store_name_value),
      status=case when make_live then 'active' else 'draft' end,
      payment_mode=case when clean_stripe is not null or clean_paypal is not null or clean_venmo is not null then 'live' else 'not_connected' end,
      payment_provider=case when clean_stripe is not null then 'stripe_payment_link' when clean_paypal is not null then 'paypal_link_legacy' when clean_venmo is not null then 'venmo_link_legacy' else null end,
      settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('stripe_payment_link',clean_stripe,'paypal_url',clean_paypal,'venmo_url',clean_venmo),
      public_payment_note=nullif(btrim(coalesce(payment_note_value,'')),''),
      updated_at=now()
  where id=storefront_uuid;

  return jsonb_build_object('ok',true,'status',case when make_live then 'active' else 'draft' end,'public_url','/store/'||(select store_slug from public.commerce_storefronts where id=storefront_uuid),'provider',case when clean_stripe is not null then 'stripe' else 'legacy_direct_link' end);
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
begin
  select s.id,s.settings,nullif(s.settings->>'stripe_payment_link',''),
         nullif(s.settings->>'paypal_url','') is not null or nullif(s.settings->>'venmo_url','') is not null,
         coalesce(c.qa_only,false)
  into storefront_uuid,original_settings,stripe_link,legacy_link_present,qa_only_client
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

  return result||jsonb_build_object(
    'stripe_payment_link',stripe_link,
    'preferred_payment_provider',case when stripe_link is not null then 'stripe' else 'legacy_direct_link' end
  );
end;
$$;

revoke all on function public.get_my_stripe_ready_storefront_settings() from public,anon;
grant execute on function public.get_my_stripe_ready_storefront_settings() to authenticated;
revoke all on function public.get_public_stripe_ready_commerce_storefront(text) from public;
grant execute on function public.get_public_stripe_ready_commerce_storefront(text) to anon,authenticated;
revoke all on function public.save_my_stripe_ready_storefront_settings(text,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_my_stripe_ready_storefront_settings(text,text,text,text,text,boolean) to authenticated;
revoke all on function public.create_public_stripe_ready_direct_payment_order(text,jsonb,jsonb) from public;
grant execute on function public.create_public_stripe_ready_direct_payment_order(text,jsonb,jsonb) to anon,authenticated;

comment on function public.save_my_stripe_ready_storefront_settings(text,text,text,text,text,boolean) is
  'Stores public payment links only. It never receives Stripe API keys, creates charges, or enables subscription billing.';
