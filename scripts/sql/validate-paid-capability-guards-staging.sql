-- Compile the complete synthetic validator as a transaction-local pg_temp
-- function inside a caught subtransaction. A nested DO command cannot be
-- prepared reliably through PL/pgSQL EXECUTE; CREATE FUNCTION is the supported
-- dynamic-DDL shape and still lets this wrapper sanitize compile failures. If
-- compilation or execution fails, the subtransaction rolls back the temporary
-- function and every synthetic fixture before emitting only its SQLSTATE.
do $nxq_paid_guard_wrapper$
begin
  begin
    execute $nxq_location_queue_probe_statement$
create function pg_temp.nxq_probe_location_queue_dependency(
  target_client_id uuid,
  target_user_id uuid
)
returns jsonb
language plpgsql
as $nxq_location_queue_probe$
declare
  probe_checks jsonb := '{}'::jsonb;
  probe_job_id uuid;
begin
  -- This compact helper isolates only the location-trigger queue dependency.
  -- It returns true booleans only, so it cannot erase an earlier failure.
  if to_regprocedure('public.enqueue_automation_job(uuid,uuid,text,text,jsonb,timestamptz,integer)') is not null then
    probe_checks := jsonb_set(probe_checks, '{location_queue_enqueue_function_compatible}', 'true');
  end if;

  if not exists(
    select 1
    from unnest(array[
      'id', 'client_id', 'project_id', 'job_type', 'status', 'priority',
      'run_after', 'attempts', 'max_attempts', 'idempotency_key', 'payload',
      'result', 'last_error', 'locked_at', 'locked_by', 'completed_at',
      'created_at', 'updated_at'
    ]::text[]) as required(column_name)
    where not exists(
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('public.automation_jobs')
        and attribute.attname = required.column_name
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  ) then
    probe_checks := jsonb_set(probe_checks, '{location_queue_automation_jobs_base_columns_compatible}', 'true');
  end if;

  if exists(
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = to_regclass('public.automation_jobs')
      and attribute.attname = 'execution_target'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    probe_checks := jsonb_set(probe_checks, '{location_queue_execution_target_column_compatible}', 'true');
  end if;

  if to_regprocedure('public.classify_automation_execution_target()') is not null
     and exists(
       select 1 from pg_catalog.pg_trigger
       where tgrelid = to_regclass('public.automation_jobs')
         and tgname = 'classify_automation_execution_target'
         and not tgisinternal
     ) then
    probe_checks := jsonb_set(probe_checks, '{location_queue_execution_target_trigger_compatible}', 'true');
  end if;

  begin
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claim.sub', target_user_id::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'service_role', 'sub', target_user_id)::text,
      true
    );
    probe_job_id := public.enqueue_automation_job(
      target_client_id,
      null,
      'website_location_seo_refresh',
      'synthetic-location-queue-dependency',
      jsonb_build_object('execution_target', 'edge', 'requires_external_worker', true),
      now() + interval '2 minutes',
      55
    );
    if probe_job_id is not null then
      probe_checks := jsonb_set(probe_checks, '{location_queue_enqueue_runtime_probe}', 'true');
    end if;
  exception when others then
    if left(sqlstate, 2) = '23' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_integrity_constraint}', 'true');
    elsif sqlstate = '42501' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_permission}', 'true');
    elsif sqlstate = '42703' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_missing_schema_object}', 'true');
      probe_checks := jsonb_set(probe_checks, '{location_failure_undefined_column}', 'true');
    elsif sqlstate = '42883' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_missing_schema_object}', 'true');
      probe_checks := jsonb_set(probe_checks, '{location_failure_undefined_function}', 'true');
    elsif sqlstate = '42P01' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_missing_schema_object}', 'true');
      probe_checks := jsonb_set(probe_checks, '{location_failure_undefined_table}', 'true');
    elsif sqlstate = '42704' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_missing_schema_object}', 'true');
      probe_checks := jsonb_set(probe_checks, '{location_failure_undefined_object}', 'true');
    elsif sqlstate = 'P0001' then
      probe_checks := jsonb_set(probe_checks, '{location_failure_trigger_rejection}', 'true');
    else
      probe_checks := jsonb_set(probe_checks, '{location_failure_unknown_downstream}', 'true');
    end if;
  end;

  return probe_checks;
end;
$nxq_location_queue_probe$;
$nxq_location_queue_probe_statement$;

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
  checks jsonb;
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
  location_probe public.client_locations%rowtype;
  location_probe_result jsonb;
  location_probe_audit_id uuid;
  storage_path text;
  storage_ticket_valid boolean := false;
  tenant_denied boolean := false;
begin
  -- Keep the complete, fixed result shape without exceeding PostgreSQL's
  -- 100-argument limit for a single jsonb_build_object call.
  select jsonb_object_agg(check_name, false)
  into checks
  from unnest(array[
    'tier_denial', 'credits_usage_only', 'billing_state_denial',
    'included_usage_accounting', 'purchased_credit_accounting',
    'business_page_limits', 'business_location_limits',
    'location_identity_established', 'location_client_visible',
    'location_lifecycle_eligible', 'location_business_tier_compatible',
    'location_billing_eligible', 'location_zero_existing',
    'location_schema_client_locations_columns',
    'location_trigger_set_expected',
    'location_no_unexpected_user_triggers', 'location_no_user_rules',
    'location_column_defaults_generated_compatible',
    'location_constraints_compatible',
    'location_entitlement_trigger_phase_compatible',
    'location_queue_trigger_phase_compatible',
    'location_queue_enqueue_function_compatible',
    'location_queue_automation_jobs_base_columns_compatible',
    'location_queue_execution_target_column_compatible',
    'location_queue_execution_target_trigger_compatible',
    'location_queue_enqueue_runtime_probe', 'location_insert_trigger_probe',
    'location_audit_write_probe', 'location_result_construction_probe',
    'location_first_created', 'location_second_denied',
    'location_denial_classified', 'location_active_count_one',
    'location_first_failure_authentication',
    'location_first_failure_client_not_found',
    'location_first_failure_lifecycle', 'location_first_failure_tier',
    'location_first_failure_subscription',
    'location_first_failure_input_validation',
    'location_first_failure_downstream_schema_write',
    'location_failure_integrity_constraint', 'location_failure_permission',
    'location_failure_missing_schema_object',
    'location_failure_undefined_column', 'location_failure_undefined_function',
    'location_failure_undefined_table', 'location_failure_undefined_object',
    'location_failure_trigger_rejection', 'location_failure_unknown_downstream',
    'resource_limit_rejection', 'economic_margin_rejection',
    'reservation_idempotency', 'reservation_release',
    'reservation_reconciliation', 'storage_quota_authorization',
    'storage_reservation_cleanup', 'tenant_isolation',
    'synthetic_fixtures_only', 'no_external_runtime', 'rollback_forced'
  ]::text[]) as check_name;
  checks := jsonb_set(checks, '{synthetic_fixtures_only}', 'true');
  checks := jsonb_set(checks, '{no_external_runtime}', 'true');
  checks := jsonb_set(checks, '{rollback_forced}', 'true');

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

  -- Exercise the same authenticated RPC used by the client portal. Each
  -- location checkpoint is reported as a boolean-only classification so a
  -- fixture or schema mismatch cannot be hidden behind one silent phase
  -- failure. The overall guard passes only when every checkpoint proves the
  -- canonical standard-tier denial. Keeping this client separate from the
  -- billing and economic phases prevents their state transitions from
  -- influencing the location result. The explicit no-project assertion keeps
  -- the unrelated active-client SEO queue trigger inert.
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
    checks := jsonb_set(checks, '{location_identity_established}', 'true');

    if exists(
      select 1 from public.clients where id = client_two and auth_user_id = user_two
    ) then
      checks := jsonb_set(checks, '{location_client_visible}', 'true');
    end if;
    if exists(
      select 1 from public.clients
      where id = client_two and not qa_only and pipeline_stopped_at is null
        and status::text in ('approved', 'active')
    ) then
      checks := jsonb_set(checks, '{location_lifecycle_eligible}', 'true');
    end if;
    if exists(
      select 1
      from public.clients client
      join public.product_families family
        on family.id = client.product_family_id and family.is_active
      join public.product_family_tiers tier
        on tier.id = client.product_tier_id
       and tier.product_family_id = family.id
       and tier.is_active
      where client.id = client_two
        and family.slug = 'business' and tier.tier_key = 'starter'
    ) then
      checks := jsonb_set(checks, '{location_business_tier_compatible}', 'true');
    end if;
    if exists(
      select 1 from public.clients
      where id = client_two and billing_status::text in ('active', 'past_due')
    ) then
      checks := jsonb_set(checks, '{location_billing_eligible}', 'true');
    end if;
    if not exists(
      select 1 from public.client_locations
      where client_id = client_two and status <> 'closed'
    ) then
      checks := jsonb_set(checks, '{location_zero_existing}', 'true');
    end if;

    -- Compare only allowlisted schema facts. These probes return booleans and
    -- never expose catalog rows, definitions, identifiers, or error text.
    if not exists(
      select 1
      from unnest(array[
        'id', 'client_id', 'location_code', 'display_name', 'is_primary',
        'status', 'address_line1', 'address_line2', 'city', 'state_region',
        'postal_code', 'country_code', 'phone', 'email', 'service_area',
        'timezone', 'latitude', 'longitude', 'seo_slug', 'seo_title',
        'seo_description', 'structured_data', 'created_at', 'updated_at'
      ]::text[]) as required(column_name)
      where not exists(
        select 1
        from pg_catalog.pg_attribute attribute
        where attribute.attrelid = to_regclass('public.client_locations')
          and attribute.attname = required.column_name
          and attribute.attnum > 0
          and not attribute.attisdropped
      )
    ) then
      checks := jsonb_set(checks, '{location_schema_client_locations_columns}', 'true');
    end if;

    -- Report only boolean compatibility for every remaining insert-time
    -- database surface. Catalog rows and object definitions stay private.
    if (
      select count(*) = 2
         and bool_and(tgname in (
           'nxq_enforce_location_entitlement',
           'queue_location_seo_refresh_from_location'
         ))
      from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.client_locations')
        and not tgisinternal
    ) then
      checks := jsonb_set(checks, '{location_trigger_set_expected}', 'true');
    end if;

    if not exists(
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.client_locations')
        and not tgisinternal
        and tgname not in (
          'nxq_enforce_location_entitlement',
          'queue_location_seo_refresh_from_location'
        )
    ) then
      checks := jsonb_set(checks, '{location_no_unexpected_user_triggers}', 'true');
    end if;

    if not exists(
      select 1
      from pg_catalog.pg_rewrite rewrite
      where rewrite.ev_class = to_regclass('public.client_locations')
        and rewrite.rulename <> '_RETURN'
    ) then
      checks := jsonb_set(checks, '{location_no_user_rules}', 'true');
    end if;

    if not exists(
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = to_regclass('public.client_locations')
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attgenerated <> ''
    )
       and not exists(
         select 1
         from unnest(array[
           'id', 'country_code', 'structured_data', 'created_at', 'updated_at'
         ]::text[]) as required(column_name)
         where not exists(
           select 1
           from pg_catalog.pg_attribute attribute
           where attribute.attrelid = to_regclass('public.client_locations')
             and attribute.attname = required.column_name
             and attribute.attnum > 0
             and not attribute.attisdropped
             and attribute.atthasdef
         )
       ) then
      checks := jsonb_set(checks, '{location_column_defaults_generated_compatible}', 'true');
    end if;

    if (
      select count(*) = 6
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.client_locations')
        and constraint_row.contype in ('p', 'u', 'f', 'c')
    ) then
      checks := jsonb_set(checks, '{location_constraints_compatible}', 'true');
    end if;

    if to_regprocedure('public.nxq_enforce_location_entitlement()') is not null
       and exists(
         select 1 from pg_catalog.pg_trigger
         where tgrelid = to_regclass('public.client_locations')
           and tgname = 'nxq_enforce_location_entitlement'
           and not tgisinternal
       )
       and not exists(
         select 1
         from (
           values
             ('public.clients', 'id'),
             ('public.clients', 'status'),
             ('public.clients', 'billing_status'),
             ('public.clients', 'pipeline_stopped_at'),
             ('public.clients', 'product_family_id'),
             ('public.clients', 'product_tier_id'),
             ('public.product_families', 'id'),
             ('public.product_families', 'slug'),
             ('public.product_families', 'is_active'),
             ('public.product_family_tiers', 'id'),
             ('public.product_family_tiers', 'product_family_id'),
             ('public.product_family_tiers', 'tier_key'),
             ('public.product_family_tiers', 'is_active'),
             ('public.nxq_tier_entitlements', 'product_family_slug'),
             ('public.nxq_tier_entitlements', 'tier_key'),
             ('public.nxq_tier_entitlements', 'feature_key'),
             ('public.nxq_tier_entitlements', 'enabled'),
             ('public.nxq_tier_entitlements', 'limits')
         ) as required(relation_name, column_name)
         where not exists(
           select 1
           from pg_catalog.pg_attribute attribute
           where attribute.attrelid = to_regclass(required.relation_name)
             and attribute.attname = required.column_name
             and attribute.attnum > 0
             and not attribute.attisdropped
         )
       ) then
      checks := jsonb_set(checks, '{location_entitlement_trigger_phase_compatible}', 'true');
    end if;

    if to_regprocedure('public.queue_location_seo_refresh()') is not null
       and exists(
         select 1 from pg_catalog.pg_trigger
         where tgrelid = to_regclass('public.client_locations')
           and tgname = 'queue_location_seo_refresh_from_location'
           and not tgisinternal
       )
       and not exists(
         select 1
         from (
           values
             ('public.clients', 'id'),
             ('public.clients', 'status'),
             ('public.projects', 'id'),
             ('public.projects', 'client_id'),
             ('public.projects', 'created_at')
         ) as required(relation_name, column_name)
         where not exists(
           select 1
           from pg_catalog.pg_attribute attribute
           where attribute.attrelid = to_regclass(required.relation_name)
             and attribute.attname = required.column_name
             and attribute.attnum > 0
             and not attribute.attisdropped
         )
       ) then
      checks := jsonb_set(checks, '{location_queue_trigger_phase_compatible}', 'true');
    end if;

    checks := checks || pg_temp.nxq_probe_location_queue_dependency(client_two, user_one);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', user_two::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'authenticated', 'sub', user_two)::text,
      true
    );

    -- Isolate the three downstream write stages without bypassing the
    -- canonical entitlement trigger. Successful probe rows are deleted before
    -- the client RPC runs, and the outer controlled exception still rolls the
    -- complete synthetic transaction back.
    begin
      insert into public.client_locations(
        client_id, location_code, display_name, is_primary, status, city,
        state_region, seo_slug, seo_title, seo_description
      ) values(
        client_two, 'SYNTHETIC-PROBE', 'Synthetic Probe', true, 'active',
        'Synthetic City', 'CA', 'synthetic-probe',
        'Synthetic Probe | Synthetic City, CA',
        'Synthetic location write-path probe.'
      ) returning * into location_probe;
      checks := jsonb_set(checks, '{location_insert_trigger_probe}', 'true');

      begin
        insert into public.automation_audit_log(
          client_id, event_type, actor_type, details
        ) values(
          client_two, 'synthetic_location_write_probe', 'client',
          jsonb_build_object('synthetic', true, 'service_count', 0)
        ) returning id into location_probe_audit_id;
        checks := jsonb_set(checks, '{location_audit_write_probe}', 'true');
      exception when others then
        if left(sqlstate, 2) = '23' then
          checks := jsonb_set(checks, '{location_failure_integrity_constraint}', 'true');
        elsif sqlstate = '42501' then
          checks := jsonb_set(checks, '{location_failure_permission}', 'true');
        elsif sqlstate = '42703' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_column}', 'true');
        elsif sqlstate = '42883' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_function}', 'true');
        elsif sqlstate = '42P01' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_table}', 'true');
        elsif sqlstate = '42704' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_object}', 'true');
        elsif sqlstate = 'P0001' then
          checks := jsonb_set(checks, '{location_failure_trigger_rejection}', 'true');
        else
          checks := jsonb_set(checks, '{location_failure_unknown_downstream}', 'true');
        end if;
      end;

      begin
        location_probe_result := jsonb_build_object(
          'ok', true,
          'location', to_jsonb(location_probe),
          'service_count', 0
        );
        if coalesce((location_probe_result->>'ok')::boolean, false)
           and jsonb_typeof(location_probe_result->'location') = 'object' then
          checks := jsonb_set(checks, '{location_result_construction_probe}', 'true');
        end if;
      exception when others then
        if left(sqlstate, 2) = '23' then
          checks := jsonb_set(checks, '{location_failure_integrity_constraint}', 'true');
        elsif sqlstate = '42501' then
          checks := jsonb_set(checks, '{location_failure_permission}', 'true');
        elsif sqlstate = '42703' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_column}', 'true');
        elsif sqlstate = '42883' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_function}', 'true');
        elsif sqlstate = '42P01' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_table}', 'true');
        elsif sqlstate = '42704' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_object}', 'true');
        elsif sqlstate = 'P0001' then
          checks := jsonb_set(checks, '{location_failure_trigger_rejection}', 'true');
        else
          checks := jsonb_set(checks, '{location_failure_unknown_downstream}', 'true');
        end if;
      end;

      if location_probe_audit_id is not null then
        delete from public.automation_audit_log where id = location_probe_audit_id;
      end if;
      delete from public.client_locations where id = location_probe.id;
    exception when others then
      if left(sqlstate, 2) = '23' then
        checks := jsonb_set(checks, '{location_failure_integrity_constraint}', 'true');
      elsif sqlstate = '42501' then
        checks := jsonb_set(checks, '{location_failure_permission}', 'true');
      elsif sqlstate = '42703' then
        checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
        checks := jsonb_set(checks, '{location_failure_undefined_column}', 'true');
      elsif sqlstate = '42883' then
        checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
        checks := jsonb_set(checks, '{location_failure_undefined_function}', 'true');
      elsif sqlstate = '42P01' then
        checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
        checks := jsonb_set(checks, '{location_failure_undefined_table}', 'true');
      elsif sqlstate = '42704' then
        checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
        checks := jsonb_set(checks, '{location_failure_undefined_object}', 'true');
      elsif sqlstate = 'P0001' then
        checks := jsonb_set(checks, '{location_failure_trigger_rejection}', 'true');
      else
        checks := jsonb_set(checks, '{location_failure_unknown_downstream}', 'true');
      end if;
    end;

    begin
      result := public.current_client_create_location(
        'Synthetic Primary', 'Synthetic City', 'CA',
        null, null, null, null, array[]::text[]
      );
      if coalesce((result->>'ok')::boolean, false) then
        checks := jsonb_set(checks, '{location_first_created}', 'true');
      end if;
    exception when others then
      result := null;
      if lower(sqlerrm) like '%authenticated client access required%' then
        checks := jsonb_set(checks, '{location_first_failure_authentication}', 'true');
      elsif lower(sqlerrm) like '%client account was not found%' then
        checks := jsonb_set(checks, '{location_first_failure_client_not_found}', 'true');
      elsif lower(sqlerrm) like '%client lifecycle does not allow location changes%' then
        checks := jsonb_set(checks, '{location_first_failure_lifecycle}', 'true');
      elsif lower(sqlerrm) like '%active business tier is required%' then
        checks := jsonb_set(checks, '{location_first_failure_tier}', 'true');
      elsif lower(sqlerrm) like '%current subscription does not permit location creation%' then
        checks := jsonb_set(checks, '{location_first_failure_subscription}', 'true');
      elsif lower(sqlerrm) like any(array[
        '%location name, city, and state/region are required%',
        '%postal code is too long%',
        '%phone number contains unsupported characters%',
        '%email address is invalid%',
        '%service area is too long%',
        '%location supports at most 30 services%'
      ]) then
        checks := jsonb_set(checks, '{location_first_failure_input_validation}', 'true');
      else
        checks := jsonb_set(checks, '{location_first_failure_downstream_schema_write}', 'true');
        if left(sqlstate, 2) = '23' then
          checks := jsonb_set(checks, '{location_failure_integrity_constraint}', 'true');
        elsif sqlstate = '42501' then
          checks := jsonb_set(checks, '{location_failure_permission}', 'true');
        elsif sqlstate = '42703' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_column}', 'true');
        elsif sqlstate = '42883' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_function}', 'true');
        elsif sqlstate = '42P01' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_table}', 'true');
        elsif sqlstate = '42704' then
          checks := jsonb_set(checks, '{location_failure_missing_schema_object}', 'true');
          checks := jsonb_set(checks, '{location_failure_undefined_object}', 'true');
        elsif sqlstate = 'P0001' then
          checks := jsonb_set(checks, '{location_failure_trigger_rejection}', 'true');
        else
          checks := jsonb_set(checks, '{location_failure_unknown_downstream}', 'true');
        end if;
      end if;
    end;
    begin
      perform public.current_client_create_location(
        'Synthetic Extra', 'Synthetic City', 'CA',
        null, null, null, null, array[]::text[]
      );
    exception when others then
      checks := jsonb_set(checks, '{location_second_denied}', 'true');
      location_rejected := sqlstate = 'P0001'
        and lower(sqlerrm) like '%location limit reached%';
      if location_rejected then
        checks := jsonb_set(checks, '{location_denial_classified}', 'true');
      end if;
    end;
    select count(*) into active_location_count
    from public.client_locations
    where client_id = client_two and status <> 'closed';
    if active_location_count = 1 then
      checks := jsonb_set(checks, '{location_active_count_one}', 'true');
    end if;
    if checks->>'location_identity_established' = 'true'
       and checks->>'location_client_visible' = 'true'
       and checks->>'location_lifecycle_eligible' = 'true'
       and checks->>'location_business_tier_compatible' = 'true'
       and checks->>'location_billing_eligible' = 'true'
       and checks->>'location_zero_existing' = 'true'
       and checks->>'location_first_created' = 'true'
       and checks->>'location_second_denied' = 'true'
       and checks->>'location_denial_classified' = 'true'
       and checks->>'location_active_count_one' = 'true' then
      checks := jsonb_set(checks, '{business_location_limits}', 'true');
    end if;
  exception when others then
    checks := jsonb_set(checks, '{business_location_limits}', 'false');
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
