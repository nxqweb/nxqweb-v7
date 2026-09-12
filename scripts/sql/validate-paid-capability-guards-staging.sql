do $nxq_paid_guard_validation$
declare
  family_id uuid;
  starter_tier_id uuid;
  user_one uuid := gen_random_uuid();
  user_two uuid := gen_random_uuid();
  client_one uuid := gen_random_uuid();
  client_two uuid := gen_random_uuid();
  ticket_id uuid;
  result jsonb;
  checks jsonb := jsonb_build_object(
    'tier_denial', false,
    'credits_usage_only', false,
    'billing_state_denial', false,
    'included_usage_accounting', false,
    'purchased_credit_accounting', false,
    'business_page_limits', false,
    'business_location_limits', false,
    'resource_limit_rejection', false,
    'economic_margin_rejection', false,
    'reservation_idempotency', false,
    'reservation_release', false,
    'reservation_reconciliation', false,
    'storage_quota_authorization', false,
    'storage_reservation_cleanup', false,
    'tenant_isolation', false,
    'synthetic_fixtures_only', true,
    'no_external_runtime', true,
    'rollback_forced', true
  );
  credit_entries integer;
  credit_balance integer;
  credit_balance_before_margin integer;
  credit_balance_after_margin integer;
  reservation_entries integer;
  resource_status text;
begin
  -- Keep all fixture work inside a subtransaction. An unexpected assertion or
  -- schema-compatibility error rolls back that phase before the outer block
  -- emits the same sanitized result marker used by successful executions.
  begin
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claim.sub', user_one::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'service_role', 'sub', user_one)::text,
      true
    );

  select family.id, tier.id
  into family_id, starter_tier_id
  from public.product_families family
  join public.product_family_tiers tier on tier.product_family_id = family.id
  where family.slug = 'business'
    and family.is_active
    and tier.tier_key = 'starter'
    and tier.is_active;

  if family_id is null or starter_tier_id is null then
    raise exception 'Required active Business Starter catalog entry is missing.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', user_one, 'authenticated', 'authenticated',
      'paid-guard-' || user_one::text || '@synthetic.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', user_two, 'authenticated', 'authenticated',
      'paid-guard-' || user_two::text || '@synthetic.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

  insert into public.clients (
    id, auth_user_id, business_name, contact_email, business_type, status,
    monthly_price, billing_status, billing_provider, product_family_id,
    product_tier_id, qa_only
  ) values
    (client_one, user_one, 'Synthetic Paid Guard One', 'paid-guard-' || user_one::text || '@synthetic.invalid',
      'Synthetic Validation', 'active', 50, 'active', 'synthetic', family_id, starter_tier_id, false),
    (client_two, user_two, 'Synthetic Paid Guard Two', 'paid-guard-' || user_two::text || '@synthetic.invalid',
      'Synthetic Validation', 'active', 50, 'active', 'synthetic', family_id, starter_tier_id, false);

  -- A Starter client must be denied a higher-tier feature before credits exist.
  begin
    perform public.nxq_authorize_paid_capability(
      client_one, 'advanced_analytics', '{}'::jsonb, 0,
      'synthetic-tier-denial-before-credit', '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%denied by subscription tier%' then
      checks := jsonb_set(checks, '{tier_denial}', 'true');
    end if;
  end;

  -- Included cost is available without purchased credit; overage is not.
  result := public.nxq_authorize_paid_capability(
    client_one, 'managed_website', '{}'::jsonb, 400,
    'synthetic-included-usage', '{}'::jsonb
  );
  if coalesce((result->>'allowed')::boolean, false) then
    checks := jsonb_set(checks, '{included_usage_accounting}', 'true');
  end if;

  begin
    perform public.nxq_authorize_paid_capability(
      client_one, 'managed_website', '{}'::jsonb, 200,
      'synthetic-credit-required', '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%usage credit is required%' then
      checks := jsonb_set(checks, '{purchased_credit_accounting}', 'true');
    end if;
  end;

  perform public.nxq_record_usage_credit_purchase(
    client_one, 'synthetic-provider', 'synthetic-paid-guard-event', 1000,
    jsonb_build_object('synthetic', true)
  );

  -- Credits must not change the tier result.
  begin
    perform public.nxq_authorize_paid_capability(
      client_one, 'advanced_analytics', '{}'::jsonb, 0,
      'synthetic-tier-denial-after-credit', '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%denied by subscription tier%' then
      checks := jsonb_set(checks, '{credits_usage_only}', 'true');
    end if;
  end;

  result := public.nxq_authorize_paid_capability(
    client_one, 'managed_website', '{}'::jsonb, 200,
    'synthetic-credit-reservation', '{}'::jsonb
  );
  result := public.nxq_authorize_paid_capability(
    client_one, 'managed_website', '{}'::jsonb, 200,
    'synthetic-credit-reservation', '{}'::jsonb
  );
  select count(*) into reservation_entries
  from public.nxq_economic_usage_reservations
  where client_id = client_one and idempotency_key = 'synthetic-credit-reservation';
  select count(*) into credit_entries
  from public.nxq_usage_credit_ledger
  where client_id = client_one and idempotency_key = 'usage-spend:synthetic-credit-reservation';
  if reservation_entries = 1 and credit_entries = 1
     and coalesce((result->>'allowed')::boolean, false)
     and coalesce((result->>'idempotent')::boolean, false) then
    checks := jsonb_set(checks, '{reservation_idempotency}', 'true');
    checks := jsonb_set(checks, '{purchased_credit_accounting}', 'true');
  end if;

  result := public.nxq_finalize_economic_usage(
    client_one, 'synthetic-credit-reservation', null, true
  );
  select coalesce(sum(amount_cents), 0)::integer into credit_balance
  from public.nxq_usage_credit_ledger where client_id = client_one;
  if (result->>'released')::boolean and credit_balance = 900 then
    checks := jsonb_set(checks, '{reservation_release}', 'true');
  end if;

  perform public.nxq_authorize_paid_capability(
    client_one, 'managed_website', jsonb_build_object('api_requests', 1), 200,
    'synthetic-reconciliation', '{}'::jsonb
  );
  result := public.nxq_finalize_economic_usage(
    client_one, 'synthetic-reconciliation', 150, false
  );
  select coalesce(sum(amount_cents), 0)::integer into credit_balance
  from public.nxq_usage_credit_ledger where client_id = client_one;
  select status into resource_status
  from public.nxq_client_resource_reservations
  where client_id = client_one
    and idempotency_key = 'synthetic-reconciliation:api_requests';
  if (result->>'credit_refunded_cents')::integer = 50
     and credit_balance = 850
     and resource_status = 'consumed' then
    checks := jsonb_set(checks, '{reservation_reconciliation}', 'true');
  end if;

  -- Billing state is authoritative even when tier and credits otherwise permit work.
  update public.clients set billing_status = 'frozen' where id = client_one;
  begin
    perform public.nxq_authorize_paid_capability(
      client_one, 'managed_website', '{}'::jsonb, 0,
      'synthetic-billing-denial', '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%denied by billing state%' then
      checks := jsonb_set(checks, '{billing_state_denial}', 'true');
    end if;
  end;
  update public.clients set billing_status = 'active' where id = client_one;

  -- Server-owned page limits remain the canonical Business matrix.
  if (select limits->>'core_pages' = '5'
      from public.nxq_tier_entitlements
      where product_family_slug = 'business'
        and tier_key = 'starter' and feature_key = 'managed_website' and enabled)
    and (select limits->>'core_pages' = '12'
      from public.nxq_tier_entitlements
      where product_family_slug = 'business'
        and tier_key = 'growth' and feature_key = 'managed_website' and enabled)
    and (select limits->>'core_pages' = '25'
      from public.nxq_tier_entitlements
      where product_family_slug = 'business'
        and tier_key = 'intelligence' and feature_key = 'managed_website' and enabled)
    and (select limits->>'core_pages' = 'custom'
      from public.nxq_tier_entitlements
      where product_family_slug = 'business'
        and tier_key = 'enterprise' and feature_key = 'managed_website' and enabled) then
    checks := jsonb_set(checks, '{business_page_limits}', 'true');
  end if;

  insert into public.client_locations(client_id, location_code, display_name, seo_slug)
  values(client_one, 'synthetic-primary', 'Synthetic Primary', 'synthetic-primary');
  begin
    insert into public.client_locations(client_id, location_code, display_name, seo_slug)
    values(client_one, 'synthetic-extra', 'Synthetic Extra', 'synthetic-extra');
  exception when others then
    if sqlerrm like '%location limit reached%' then
      checks := jsonb_set(checks, '{business_location_limits}', 'true');
    end if;
  end;

  update public.nxq_client_resource_policies
  set monthly_limit = 1
  where client_id = client_one and resource_key = 'api_requests';
  begin
    perform public.nxq_authorize_paid_capability(
      client_one, 'managed_website', jsonb_build_object('api_requests', 2), 0,
      'synthetic-resource-limit', '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%resource limit%' then
      checks := jsonb_set(checks, '{resource_limit_rejection}', 'true');
    end if;
  end;

  -- Credits may fund usage above the included budget, but never cross the
  -- subscription's hard economic ceiling required by the minimum margin.
  select coalesce(sum(amount_cents), 0)::integer into credit_balance_before_margin
  from public.nxq_usage_credit_ledger where client_id = client_one;
  result := public.nxq_reserve_economic_usage(
    client_one, 201, 'synthetic-margin-rejection',
    'provider_cost_cents', '{}'::jsonb
  );
  select coalesce(sum(amount_cents), 0)::integer into credit_balance_after_margin
  from public.nxq_usage_credit_ledger where client_id = client_one;
  if not coalesce((result->>'allowed')::boolean, true)
     and result->>'reason' = 'minimum_margin_ceiling_exceeded'
     and credit_balance_before_margin = credit_balance_after_margin
     and not exists(
       select 1 from public.nxq_economic_usage_reservations
       where client_id = client_one
         and idempotency_key = 'synthetic-margin-rejection'
     )
     and not exists(
       select 1 from public.nxq_usage_credit_ledger
       where client_id = client_one
         and idempotency_key = 'usage-spend:synthetic-margin-rejection'
     ) then
    checks := jsonb_set(checks, '{economic_margin_rejection}', 'true');
  end if;

  -- Storage authorization is exact-client, quota-reserved, and releasable.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', user_one::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', user_one)::text,
    true
  );
  result := public.nxq_authorize_storage_upload(
    'client-files', client_one::text || '/synthetic/fixture.txt', 128, 'text/plain'
  );
  ticket_id := (result->>'ticket_id')::uuid;
  if ticket_id is not null
     and public.nxq_storage_upload_ticket_valid(
       'client-files', client_one::text || '/synthetic/fixture.txt'
     ) then
    checks := jsonb_set(checks, '{storage_quota_authorization}', 'true');
  end if;

  perform set_config('request.jwt.claim.sub', user_two::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', user_two)::text,
    true
  );
  begin
    perform public.nxq_cancel_storage_upload_ticket(ticket_id);
  exception when others then
    if sqlerrm like '%not found%' then
      checks := jsonb_set(checks, '{tenant_isolation}', 'true');
    end if;
  end;

  perform set_config('request.jwt.claim.sub', user_one::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', user_one)::text,
    true
  );
  perform public.nxq_cancel_storage_upload_ticket(ticket_id);
  select status into resource_status
  from public.nxq_client_resource_reservations
  where client_id = client_one and resource_key = 'storage_bytes'
    and idempotency_key = (
      select resource_idempotency_key
      from public.nxq_storage_upload_tickets where id = ticket_id
    );
    if resource_status = 'released'
       and (select status = 'cancelled'
         from public.nxq_storage_upload_tickets where id = ticket_id)
       and not exists(
         select 1 from storage.objects
         where bucket_id = 'client-files'
           and name = client_one::text || '/synthetic/fixture.txt'
       ) then
      checks := jsonb_set(checks, '{storage_reservation_cleanup}', 'true');
    end if;
  exception when others then
    -- The subtransaction has already discarded every synthetic fixture and
    -- reservation. False checks remain false and are the only reported detail.
    null;
  end;

  -- A final controlled error is the rollback mechanism. The runner accepts
  -- only this marker and reports the decoded boolean classifications.
  raise exception 'NXQ_PAID_GUARD_RESULT:%',
    replace(encode(convert_to(checks::text, 'UTF8'), 'base64'), E'\n', '');
end;
$nxq_paid_guard_validation$;
