-- Compile the complete synthetic validator as a transaction-local pg_temp
-- function inside a caught subtransaction. A nested DO command cannot be
-- prepared reliably through PL/pgSQL EXECUTE; CREATE FUNCTION is the supported
-- dynamic-DDL shape and still lets this wrapper sanitize compile failures. If
-- compilation or execution fails, the subtransaction rolls back the temporary
-- function and every synthetic fixture before emitting only its SQLSTATE.
do $nxq_paid_guard_wrapper$
begin
  begin
    execute $nxq_paid_guard_statement$
create function pg_temp.nxq_validate_paid_capability_guards()
returns void
language plpgsql
as $nxq_paid_guard_validation$
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
  resource_result jsonb;
  active_location_count integer;
  location_rejected boolean := false;
  resource_rejected boolean := false;
  spent_before_margin integer;
  hard_ceiling_before_margin integer;
  margin_test_cost integer;
  synthetic_role text;
  synthetic_uid uuid;
  storage_path text;
  storage_ticket_valid boolean := false;
  tenant_denied boolean := false;
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
      'Synthetic Validation', 'overdue', 50, 'active', 'synthetic', family_id, starter_tier_id, false),
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
     and coalesce((result->>'allowed')::boolean, false) then
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

  -- Exercise the same authenticated RPC used by the client portal. The first
  -- call must create one location and reach the canonical BEFORE INSERT
  -- entitlement trigger; the second must be rejected by the RPC's matching
  -- standard-tier limit. Keeping this client separate from the billing and
  -- economic phases prevents their state transitions from influencing the
  -- location result. The explicit no-project assertion keeps the unrelated
  -- active-client SEO queue trigger inert.
  begin
    if exists(select 1 from public.projects where client_id = client_two) then
      raise exception 'Synthetic location client unexpectedly has a project.';
    end if;
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', user_two::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'authenticated', 'sub', user_two)::text,
      true
    );
    select auth.role(), auth.uid() into synthetic_role, synthetic_uid;
    if synthetic_role <> 'authenticated' or synthetic_uid <> user_two then
      raise exception 'Synthetic location identity was not established.';
    end if;
    result := public.current_client_create_location(
      'Synthetic Primary', 'Synthetic City', 'CA',
      null, null, null, null, array[]::text[]
    );
    begin
      perform public.current_client_create_location(
        'Synthetic Extra', 'Synthetic City', 'CA',
        null, null, null, null, array[]::text[]
      );
    exception when others then
      location_rejected := sqlstate = 'P0001'
        and lower(sqlerrm) like '%location limit reached%';
    end;
    select count(*) into active_location_count
    from public.client_locations
    where client_id = client_two and status <> 'closed';
    if coalesce((result->>'ok')::boolean, false)
       and location_rejected and active_location_count = 1 then
      checks := jsonb_set(checks, '{business_location_limits}', 'true');
    end if;
  exception when others then
    null;
  end;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', user_one::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role', 'sub', user_one)::text,
    true
  );

  -- Keep the resource denial independently rollback-safe so it cannot mask the
  -- economic and storage phases when a staging schema differs unexpectedly.
  begin
    update public.nxq_client_resource_policies
    set monthly_limit = 1
    where client_id = client_one and resource_key = 'api_requests';
    resource_result := public.nxq_reserve_client_resource(
      client_one, 'api_requests', 2,
      'synthetic-resource-policy-probe', '{}'::jsonb
    );
    begin
      perform public.nxq_authorize_paid_capability(
        client_one, 'managed_website', jsonb_build_object('api_requests', 2), 0,
        'synthetic-resource-limit', '{}'::jsonb
      );
    exception when others then
      resource_rejected := lower(sqlerrm) like '%resource limit%';
    end;
    if resource_rejected
       and not coalesce((resource_result->>'allowed')::boolean, true)
       and resource_result->>'reason' = 'monthly_limit_reached'
       and not exists(
         select 1 from public.nxq_client_resource_reservations
         where client_id = client_one and resource_key = 'api_requests'
           and idempotency_key in (
             'synthetic-resource-policy-probe',
             'synthetic-resource-limit:api_requests'
           )
       ) then
      checks := jsonb_set(checks, '{resource_limit_rejection}', 'true');
    end if;
  exception when others then
    null;
  end;

  -- Credits may fund usage above the included budget, but never cross the
  -- subscription's hard economic ceiling required by the minimum margin.
  begin
    select coalesce(sum(amount_cents), 0)::integer into credit_balance_before_margin
    from public.nxq_usage_credit_ledger where client_id = client_one;
    select
      coalesce(sum(coalesce(reservation.actual_provider_cost_cents,
        reservation.estimated_provider_cost_cents)), 0)::integer,
      floor(client.monthly_price * 100 *
        ((100 - policy.minimum_margin_percent) / 100))::integer
    into spent_before_margin, hard_ceiling_before_margin
    from public.clients client
    join public.product_families family on family.id = client.product_family_id
    join public.product_family_tiers tier
      on tier.id = client.product_tier_id
     and tier.product_family_id = family.id
    join public.nxq_tier_economic_policies policy
      on policy.product_family_slug = family.slug
     and policy.tier_key = tier.tier_key
    left join public.nxq_economic_usage_reservations reservation
      on reservation.client_id = client.id
     and reservation.status <> 'released'
     and reservation.occurred_at >= date_trunc('month', now())
     and reservation.occurred_at < date_trunc('month', now()) + interval '1 month'
    where client.id = client_one
    group by client.monthly_price, policy.minimum_margin_percent;
    margin_test_cost := greatest(hard_ceiling_before_margin - spent_before_margin + 1, 1);
    result := public.nxq_reserve_economic_usage(
      client_one, margin_test_cost, 'synthetic-margin-rejection',
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
  exception when others then
    null;
  end;

  -- Storage authorization is exact-client, quota-reserved, and releasable.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', user_one::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', user_one)::text,
    true
  );
  storage_path := client_one::text || '/synthetic/fixture.txt';
  select auth.role(), auth.uid()
  into synthetic_role, synthetic_uid;
  if synthetic_role = 'authenticated' and synthetic_uid = user_one then
    begin
      result := public.nxq_authorize_storage_upload(
        'client-files', storage_path, 128::bigint, 'text/plain'
      );
      ticket_id := (result->>'ticket_id')::uuid;
      storage_ticket_valid := public.nxq_storage_upload_ticket_valid(
        'client-files', storage_path
      );
    exception when others then
      ticket_id := null;
      storage_ticket_valid := false;
    end;
  else
    checks := jsonb_set(checks, '{synthetic_fixtures_only}', 'false');
  end if;
  if ticket_id is not null and storage_ticket_valid then
    checks := jsonb_set(checks, '{storage_quota_authorization}', 'true');
  end if;

  if ticket_id is not null then
    perform set_config('request.jwt.claim.sub', user_two::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'authenticated', 'sub', user_two)::text,
      true
    );
    select auth.role(), auth.uid()
    into synthetic_role, synthetic_uid;
    if synthetic_role = 'authenticated' and synthetic_uid = user_two then
      begin
        perform public.nxq_cancel_storage_upload_ticket(ticket_id);
      exception when others then
        tenant_denied := lower(sqlerrm) like '%not found%';
      end;
      if tenant_denied then
        checks := jsonb_set(checks, '{tenant_isolation}', 'true');
      end if;
    else
      checks := jsonb_set(checks, '{synthetic_fixtures_only}', 'false');
    end if;

    perform set_config('request.jwt.claim.sub', user_one::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'authenticated', 'sub', user_one)::text,
      true
    );
    select auth.role(), auth.uid()
    into synthetic_role, synthetic_uid;
    if synthetic_role = 'authenticated' and synthetic_uid = user_one then
      begin
        perform public.nxq_cancel_storage_upload_ticket(ticket_id);
      exception when others then
        null;
      end;
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
             and name = storage_path
         ) then
        checks := jsonb_set(checks, '{storage_reservation_cleanup}', 'true');
      end if;
    else
      checks := jsonb_set(checks, '{synthetic_fixtures_only}', 'false');
    end if;
  end if;
  exception when others then
    -- The subtransaction has already discarded every synthetic fixture and
    -- reservation. False checks remain false and are the only reported detail.
    null;
  end;

  -- A final controlled error is the rollback mechanism. The runner accepts
  -- only this marker and reports the decoded boolean classifications.
  raise exception 'NXQ_PAID_GUARD_RESULT:%:NXQ_END',
    replace(encode(convert_to(checks::text, 'UTF8'), 'base64'), E'\n', '');
end;
$nxq_paid_guard_validation$;
$nxq_paid_guard_statement$;
    perform pg_temp.nxq_validate_paid_capability_guards();
  exception when others then
    if sqlerrm like 'NXQ_PAID_GUARD_RESULT:%:NXQ_END' then
      raise exception '%', sqlerrm;
    end if;
    raise exception 'NXQ_PAID_GUARD_FAILURE:database-sqlstate-%:NXQ_END',
      lower(sqlstate);
  end;
end;
$nxq_paid_guard_wrapper$;
