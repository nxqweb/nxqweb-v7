import { spawnSync } from "node:child_process";

const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";

const childEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: "" };
const local = spawnSync(process.execPath, ["scripts/check-runtime-stage-readiness.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: childEnv,
});
if ((local.status ?? 1) !== 0) process.exit(local.status ?? 1);

const pass = (label) => console.log(`PASS  ${label}`);
const fail = (label) => { console.error(`FAIL  ${label}`); process.exitCode = 1; };

if (!accessToken || !projectRef) {
  pass("Remote launch-architecture contract deferred because staging credentials are not present");
  process.exit(0);
}

const query = String.raw`
with checks(label, ok) as (
  select 'architecture-economic-policy-exact'::text,
    count(*)=4
    and bool_and(preferred_margin_percent=95)
    and bool_and(target_margin_percent=90)
    and bool_and(minimum_margin_percent=85)
    and bool_and(topup_purchase_cents=1000)
    and bool_and(topup_usable_cents=900)
    and bool_and(not recurring_topup_allowed)
    and bool_and(not auto_refill_allowed)
  from public.nxq_tier_economic_policies where product_family_slug='business'
  union all
  select 'architecture-enterprise-custom-economics',
    coalesce((select custom_price_driven from public.nxq_tier_economic_policies where product_family_slug='business' and tier_key='enterprise'),false)
    and (select count(*)=3 from public.nxq_tier_economic_policies where product_family_slug='business' and tier_key<>'enterprise' and not custom_price_driven)
  union all
  select 'architecture-tier-separation',
    coalesce((select not enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='starter' and feature_key='mouse_tracking'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='growth' and feature_key='event_conversion_tracking'),false)
    and coalesce((select not enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='growth' and feature_key='mouse_tracking'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='intelligence' and feature_key='mouse_tracking'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='intelligence' and feature_key='ab_testing'),false)
    and coalesce((select enabled from public.nxq_tier_entitlements where product_family_slug='business' and tier_key='enterprise' and feature_key='multi_location'),false)
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
  select 'architecture-usage-purchase-service-role-only',
    has_function_privilege('service_role','public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.nxq_record_usage_credit_purchase(uuid,text,text,integer,jsonb)','EXECUTE')
  union all
  select 'architecture-economic-reservation-service-role-only',
    has_function_privilege('service_role','public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.nxq_reserve_economic_usage(uuid,integer,text,text,jsonb)','EXECUTE')
  union all
  select 'architecture-provider-secrets-forbidden',
    not exists(select 1 from public.nxq_provider_adapter_registry where secret_values_stored_here)
  union all
  select 'architecture-sensitive-behavior-capture-forbidden',
    not exists(select 1 from public.nxq_behavior_events where sensitive_field_capture)
)
select label, ok from checks order by label;
`;

let response;
try {
  response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
} catch {
  fail("Remote launch-architecture contract could not reach Supabase management API");
  process.exit(1);
}

if (!response.ok) {
  fail(`Remote launch-architecture contract query failed with HTTP ${response.status}`);
  process.exit(1);
}

let payload;
try {
  payload = await response.json();
} catch {
  fail("Remote launch-architecture contract returned invalid JSON");
  process.exit(1);
}

const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.result) ? payload.result : Array.isArray(payload?.data) ? payload.data : [];
if (!rows.length) {
  fail("Remote launch-architecture contract returned no checks");
  process.exit(1);
}

for (const row of rows) {
  const label = typeof row?.label === "string" ? row.label : "architecture-unknown-check";
  if (row?.ok === true) pass(label);
  else fail(label);
}

if (process.exitCode) process.exit(process.exitCode);
pass("Remote launch-architecture contract passed through read-only Supabase query endpoint");
