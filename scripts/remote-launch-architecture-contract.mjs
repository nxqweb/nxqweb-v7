// Single source of truth for the remote, read-only launch-architecture contract.
// check-runtime-stage-readiness.mjs and check-runtime-stage-readiness-readonly.mjs
// both call this instead of keeping their own copies, so they can no longer drift
// out of sync with each other.

export const remoteLaunchArchitectureQuery = String.raw`
with checks(label, ok) as (
  select 'architecture-economic-policy-exact'::text,
    (select count(*)=4
      and bool_and(preferred_margin_percent=95)
      and bool_and(target_margin_percent=90)
      and bool_and(minimum_margin_percent=85)
      and bool_and(topup_purchase_cents=1000)
      and bool_and(topup_usable_cents=900)
      and bool_and(recurring_topup_allowed=false)
      and bool_and(auto_refill_allowed=false)
     from public.nxq_tier_economic_policies where product_family_slug='business')
  union all
  select 'architecture-enterprise-custom-economics',
    coalesce((select custom_price_driven from public.nxq_tier_economic_policies where product_family_slug='business' and tier_key='enterprise'),false)
    and (select count(*)=3 from public.nxq_tier_economic_policies where product_family_slug='business' and tier_key<>'enterprise' and custom_price_driven=false)
  union all
  select 'architecture-starter-five-pages',
    coalesce((select enabled and coalesce((limits->>'core_pages')::int,0)=5 from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='starter' and feature_key='managed_website'),false)
  union all
  select 'architecture-starter-no-behavior-unlock',
    coalesce((select not enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='starter' and feature_key='mouse_tracking'),false)
    and coalesce((select not enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='starter' and feature_key='behavior_heatmaps'),false)
  union all
  select 'architecture-growth-events-not-mouse',
    coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='growth' and feature_key='event_conversion_tracking'),false)
    and coalesce((select not enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='growth' and feature_key='mouse_tracking'),false)
  union all
  select 'architecture-intelligence-behavior-and-experiments',
    coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='intelligence' and feature_key='mouse_tracking'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='intelligence' and feature_key='behavior_heatmaps'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='intelligence' and feature_key='ab_testing'),false)
  union all
  select 'architecture-enterprise-multilocation-integrations',
    coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='enterprise' and feature_key='multi_location'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='enterprise' and feature_key='custom_integrations'),false)
  union all
  select 'architecture-high-risk-flags-default-off',
    (select count(*)=7 and bool_and(not globally_enabled and not staging_enabled and not production_enabled)
       from public.nxq_feature_flags
      where feature_key in ('behavior_tracking','ai_optimization','ab_testing','crm_sync','custom_ai_agents','predictive_analytics','paid_usage_topups'))
  union all
  select 'architecture-provider-adapters-default-off',
    (select count(*)=6 and bool_and(not enabled and not staging_allowed and not production_allowed and not secret_values_stored_here)
       from public.nxq_provider_adapter_registry
      where adapter_key in ('ai-model','notification','malware','analytics-import','review-import','crm'))
  union all
  select 'architecture-provider-secrets-forbidden',
    not exists(select 1 from public.nxq_provider_adapter_registry where secret_values_stored_here)
  union all
  select 'architecture-usage-purchase-service-role-only',
    has_function_privilege('service_role','public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)','EXECUTE')
  union all
  select 'architecture-economic-reservation-service-role-only',
    has_function_privilege('service_role','public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)','EXECUTE')
  union all
  select 'architecture-usage-credit-never-entitlement-authority',
    position('nxq_tier_entitlements' in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))=0
    and position('nxq_tier_entitlements' in lower(pg_get_functiondef('public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)'::regprocedure)))=0
  union all
  select 'architecture-referral-credit-isolated-from-usage',
    position('referral' in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))=0
    and position('referral' in lower(pg_get_functiondef('public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)'::regprocedure)))=0
  union all
  select 'architecture-one-time-topup-contract',
    position('target_amount_paid_cents <> 1000' in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))>0
    and position("'purchase_credit'" in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))>0
    and position(', 900' in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))>0
    and position("'recurring', false" in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))>0
    and position("'auto_refill', false" in lower(pg_get_functiondef('public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)'::regprocedure)))>0
  union all
  select 'architecture-margin-reservation-contract',
    position('target_margin_percent' in lower(pg_get_functiondef('public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)'::regprocedure)))>0
    and position('minimum_margin_percent' in lower(pg_get_functiondef('public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)'::regprocedure)))>0
    and position('usage_credit_required' in lower(pg_get_functiondef('public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)'::regprocedure)))>0
    and position('date_trunc' in lower(pg_get_functiondef('public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)'::regprocedure)))>0
  union all
  select 'architecture-behavior-sensitive-field-block',
    exists(select 1 from pg_constraint where conrelid='public.nxq_behavior_events'::regclass and pg_get_constraintdef(oid) ilike '%sensitive_field_capture%false%')
  union all
  select 'architecture-sensitive-behavior-capture-forbidden',
    not exists(select 1 from public.nxq_behavior_events where sensitive_field_capture)
  union all
  select 'architecture-enterprise-price-floor',
    exists(select 1 from pg_constraint where conrelid='public.nxq_enterprise_account_policies'::regclass and pg_get_constraintdef(oid) ilike '%approved_monthly_price%150%')
  union all
  select 'architecture-client-value-credit-separation',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='nxq_client_value_snapshots' and column_name='paid_usage_credit_balance_cents')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='nxq_client_value_snapshots' and column_name='billing_credit_summary')
  union all
  select 'architecture-integration-secret-storage-forbidden',
    exists(select 1 from pg_constraint where conrelid='public.nxq_integration_connections'::regclass and pg_get_constraintdef(oid) ilike '%secret_values_stored_here%false%')
  union all
  select 'architecture-observability-sensitive-data-forbidden',
    exists(select 1 from pg_constraint where conrelid='public.nxq_observability_metrics'::regclass and pg_get_constraintdef(oid) ilike '%sensitive_data_present%false%')
  union all
  select 'architecture-qa-external-actions-hard-disabled',
    exists(select 1 from pg_constraint where conrelid='public.nxq_qa_fixture_registry'::regclass and pg_get_constraintdef(oid) ilike '%provider_calls_allowed%false%')
    and exists(select 1 from pg_constraint where conrelid='public.nxq_qa_fixture_registry'::regclass and pg_get_constraintdef(oid) ilike '%netlify_calls_allowed%false%')
    and exists(select 1 from pg_constraint where conrelid='public.nxq_qa_fixture_registry'::regclass and pg_get_constraintdef(oid) ilike '%production_changes_allowed%false%')
  union all
  select 'architecture-rls-enabled-on-new-control-tables',
    (select count(*)=12 and bool_and(c.relrowsecurity)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'nxq_usage_credit_purchases','nxq_usage_credit_ledger','nxq_economic_usage_reservations','nxq_consent_records',
        'nxq_behavior_events','nxq_optimization_findings','nxq_experiments','nxq_provider_adapter_registry',
        'nxq_automation_jobs_v2','nxq_enterprise_account_policies','nxq_integration_connections','nxq_qa_fixture_registry'
      ))
)
select label, ok from checks order by label;
`;

export async function runRemoteLaunchArchitectureChecks({ pass, fail }) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";
  const projectRef = process.env.SUPABASE_PROJECT_REF || "";
  if (!accessToken || !projectRef) {
    pass("Remote launch-architecture contract deferred because staging credentials are not present");
    return;
  }

  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: remoteLaunchArchitectureQuery }),
    });
  } catch {
    fail("Remote launch-architecture contract could not reach Supabase management API");
    return;
  }

  if (!response.ok) {
    fail(`Remote launch-architecture contract query failed with HTTP ${response.status}`);
    return;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("Remote launch-architecture contract returned invalid JSON");
    return;
  }

  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.result) ? payload.result : Array.isArray(payload?.data) ? payload.data : [];
  if (!rows.length) {
    fail("Remote launch-architecture contract returned no check rows");
    return;
  }

  for (const row of rows) {
    const label = typeof row?.label === "string" ? row.label : "architecture-unknown-check";
    const ok = row?.ok === true || row?.ok === "true" || row?.ok === "t";
    if (ok) pass(label);
    else fail(label);
  }
}
