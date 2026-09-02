import fs from "node:fs";
import path from "node:path";
import {
  edgeFunctionManifest,
  functionNames,
  managedEdgeSecrets,
  runtimeSecretProfiles,
  vaultRuntimeRoutes,
} from "./edge-function-manifest.mjs";

const root = process.cwd();
const functionRoot = path.join(root, "supabase", "functions");
const pass = (message) => console.log(`PASS  ${message}`);
const fail = (message) => { console.error(`FAIL  ${message}`); process.exitCode = 1; };

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function equalSets(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function jsonNames(file, likelyKeys) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const names = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (likelyKeys.has(key) && typeof child === "string") names.add(child);
      else visit(child);
    }
  };
  visit(value);
  return names;
}

const discovered = fs.readdirSync(functionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(functionRoot, entry.name, "index.ts")))
  .map((entry) => entry.name)
  .sort();
const declared = functionNames().sort();
if (equalSets(discovered, declared)) pass(`Manifest covers all ${declared.length} Edge functions exactly`);
else {
  fail("Edge-function manifest does not match the function directory");
  console.error(`Missing from manifest: ${discovered.filter((name) => !declared.includes(name)).join(", ") || "none"}`);
  console.error(`Missing from source: ${declared.filter((name) => !discovered.includes(name)).join(", ") || "none"}`);
}

const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
for (const item of edgeFunctionManifest) {
  const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(`\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1] || "";
  const expected = `verify_jwt = ${String(item.verifyJwt)}`;
  if (!section.includes(expected)) fail(`${item.name} is missing ${expected} in supabase/config.toml`);
}
if (!process.exitCode) pass("Supabase config explicitly preserves every JWT boundary");

const sourceByName = new Map(discovered.map((name) => [name, fs.readFileSync(path.join(functionRoot, name, "index.ts"), "utf8")]));
const authMarkers = {
  "worker-token": ["x-nxq-worker-token"],
  "trusted-worker-or-owner": ["x-nxq-worker-token", "auth.getUser"],
  "adapter-token": ["NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN", "Authorization"],
  "malware-adapter-token": ["NXQ_MALWARE_SCAN_ADAPTER_TOKEN", "Authorization", "constantTimeEqual"],
  "notification-adapter-token": ["NXQ_NOTIFICATION_ADAPTER_TOKEN", "Authorization", "constantTimeEqual"],
  "provider-health-adapter-token": ["NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN", "Authorization", "constantTimeEqual"],
  "billing-adapter-token": ["NXQ_BILLING_ADAPTER_TOKEN", "x-nxq-billing-adapter-token"],
  "public-ingest-key": ["public_ingest_key"],
  "public-form-key": ["business_lead_forms", '.eq("form_key"'],
  "owner-jwt": ["auth.getUser", "owner_users"],
  "client-jwt": ["auth.getUser", "clients"],
};
for (const item of edgeFunctionManifest) {
  const source = sourceByName.get(item.name) || "";
  const markers = authMarkers[item.authBoundary] || [];
  if (!markers.every((marker) => source.includes(marker))) fail(`${item.name} does not prove its declared ${item.authBoundary} boundary`);
}
if (!process.exitCode) pass("Every gateway exception has an independent source-level authentication boundary");

const migrationText = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8"))
  .join("\n");
for (const [secretName, functionName] of vaultRuntimeRoutes) {
  if (!migrationText.includes(`'${secretName}'`)) fail(`Vault route ${secretName} is not used by a captured migration`);
  if (!declared.includes(functionName)) fail(`Vault route ${secretName} targets unknown function ${functionName}`);
}
if (!process.exitCode) pass(`All ${vaultRuntimeRoutes.length} Vault routes target captured Edge functions`);

const allFunctionSource = [...sourceByName.values()].join("\n");
const referencedSecretNames = new Set();
for (const regex of [
  /Deno\.env\.get\(["']([A-Z0-9_]+)["']\)/g,
  /Deno\.env\.([A-Z][A-Z0-9_]*)/g,
  /(?:secret|requiredSecret|optionalSecret|environmentSecret)\(["']([A-Z0-9_]+)["']\)/g,
]) {
  for (const match of allFunctionSource.matchAll(regex)) referencedSecretNames.add(match[1]);
}
for (const secrets of Object.values(runtimeSecretProfiles)) {
  for (const name of secrets) if (!referencedSecretNames.has(name)) fail(`Runtime profile contains unreferenced secret name ${name}`);
}
for (const name of managedEdgeSecrets) if (!referencedSecretNames.has(name)) fail(`Managed Edge secret ${name} is not referenced`);
if (!process.exitCode) pass("Runtime profiles contain names only and match actual Edge-function configuration reads");

const launchSecrets = [...runtimeSecretProfiles["business-launch"]].sort();
const expectedPrelaunchSecrets = launchSecrets.filter((name) => name !== "NXQ_AI_MODEL_PROVIDER_TOKEN");
const actualPrelaunchSecrets = [...runtimeSecretProfiles["business-prelaunch"]].sort();
if (equalSets(expectedPrelaunchSecrets, actualPrelaunchSecrets)) {
  pass("Prelaunch requires every launch secret except the model-provider token");
} else {
  fail("Prelaunch secret profile does not exactly match launch-minus-model-token");
}

const expectedZeroKeySecrets = [
  ...runtimeSecretProfiles["business-non-ai-staging"],
  "NXQ_LEAD_FINGERPRINT_SALT",
  "NXQ_PUBLIC_ANALYTICS_ENDPOINT",
  "NXQ_PUBLIC_LEAD_ENDPOINT",
].sort();
const actualZeroKeySecrets = [...runtimeSecretProfiles["business-zero-key-staging"]].sort();
if (equalSets(expectedZeroKeySecrets, actualZeroKeySecrets)) {
  pass("Zero-key staging requires public runtime wiring without external challenge, malware, or notification adapters");
} else {
  fail("Zero-key staging profile must equal non-AI staging plus public endpoints and fingerprint salt");
}

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "manual-supabase-stage.yml"), "utf8");
const workflowProof = [
  'environment: nxq-staging',
  'npm ci',
  'npm run test:runtime-stage',
  'npx --no-install supabase db push --dry-run --linked',
  'edge-function-manifest.mjs --group=no-verify-jwt',
  'edge-function-manifest.mjs --group=verify-jwt',
  'check-runtime-stage-readiness.mjs --profile=business-configured-foundation',
  'check-runtime-stage-readiness.mjs --profile=business-non-ai-staging',
  'check-runtime-stage-readiness.mjs --profile=business-zero-key-staging',
  'check-runtime-stage-readiness.mjs --profile=business-prelaunch',
  'check-runtime-stage-readiness.mjs --profile=business-external-qa',
  'check-runtime-stage-readiness.mjs --supabase-functions-json=',
  'APPLY-NXQ-SUPABASE-STAGING',
];
for (const proof of workflowProof) if (!workflow.includes(proof)) fail(`Manual staging workflow is missing: ${proof}`);
const nonAiDeployGate = 'elif [ "${{ inputs.action }}" = "validate_non_ai" ] || [ "${{ inputs.action }}" = "deploy_functions" ]; then';
if (!workflow.includes(nonAiDeployGate)) fail("deploy_functions must use the non-AI staging profile");
if (!workflow.includes('inputs.action != \'validate_prelaunch\'')) fail("Prelaunch validation must never require mutation confirmation");
if (!workflow.includes('inputs.action != \'validate_zero_key\'')) fail("Zero-key validation must never require mutation confirmation");
if (!workflow.includes("else\n            node scripts/check-runtime-stage-readiness.mjs --profile=business-external-qa")) {
  fail("The strict external-QA profile must remain the fallback for apply_all");
}
if (!workflow.includes("--no-verify-jwt")) fail("Manual staging workflow does not preserve custom-auth gateway exceptions");
if (workflow.includes("environment: nxq-production")) fail("Manual staging workflow still targets the production GitHub environment");
if (!process.exitCode) pass("Manual workflow is staging-only, dry-runs first, and deploys from the exact manifest");

const profile = option("profile");
const secretsFile = option("supabase-secrets-json");
if (profile) {
  const required = runtimeSecretProfiles[profile];
  if (!required) fail(`Unknown runtime secret profile: ${profile}`);
  else if (!secretsFile) fail(`Profile ${profile} requires --supabase-secrets-json=<path>`);
  else {
    const available = jsonNames(secretsFile, new Set(["name"]));
    const missing = required.filter((name) => !available.has(name));
    if (missing.length) fail(`${profile} is missing ${missing.length} Supabase Edge secret name(s): ${missing.join(", ")}`);
    else pass(`${profile} has all ${required.length} required Supabase Edge secret names`);
  }
}

const functionsFile = option("supabase-functions-json");
if (functionsFile) {
  const deployed = jsonNames(functionsFile, new Set(["name", "slug"]));
  const missing = declared.filter((name) => !deployed.has(name));
  if (missing.length) fail(`Remote Supabase project is missing ${missing.length} function(s): ${missing.join(", ")}`);
  else pass(`Remote Supabase project reports all ${declared.length} required Edge functions`);
}

async function validateRemoteLaunchArchitecture() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";
  const projectRef = process.env.SUPABASE_PROJECT_REF || "";
  if (!accessToken || !projectRef) {
    pass("Remote launch-architecture contract deferred because staging credentials are not present");
    return;
  }

  const query = String.raw`
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

  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
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

await validateRemoteLaunchArchitecture();

if (process.exitCode) process.exit(process.exitCode);
console.log("\nNXQ runtime staging preflight passed without reading or printing any secret value.");
