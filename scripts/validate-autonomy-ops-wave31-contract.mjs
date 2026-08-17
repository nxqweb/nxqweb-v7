import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const manifest = read("scripts/edge-function-manifest.mjs");
const preflight = read("scripts/check-runtime-stage-readiness.mjs");
const workflow = read(".github/workflows/manual-supabase-stage.yml");
const config = read("supabase/config.toml");
const migration = read("supabase/migrations/189_runtime_stage_bootstrap_and_provider_truth.sql");
const bootstrap = read("supabase/functions/bootstrap-runtime-vault/index.ts");
const notifications = read("supabase/functions/dispatch-notifications/index.ts");
const storefront = read("supabase/functions/provision-storefront/index.ts");
const ownerUi = read("src/pages/OwnerLaunchReadiness.tsx");
const pkg = read("package.json");
const ci = read(".github/workflows/ci-mega-extended.yml");

const checks = [
  ["Supabase project config is captured", config.includes('project_id = "nxqweb-v7"')],
  ["Every deployment comes from one machine-readable function manifest", workflow.includes("edge-function-manifest.mjs --group=no-verify-jwt") && workflow.includes("edge-function-manifest.mjs --group=verify-jwt")],
  ["All owner deployment endpoints are declared", ["check-preview-deployment-safety","check-preview-netlify-status","check-production-launch-audit","check-production-netlify-status","execute-preview-netlify-build","execute-production-netlify-build","prepare-preview-deployment-execution","prepare-production-deployment-execution","publish-production-netlify-deploy","refresh-production-deployment-preparation","verify-deployment-connection"].every((name) => manifest.includes(`entry("${name}", true`))],
  ["Storefront provisioning uses explicit source-level owner-or-worker auth", manifest.includes('entry("provision-storefront", false, "trusted-worker-or-owner")') && config.includes("[functions.provision-storefront]\nverify_jwt = false") && storefront.includes("NXQ_AUTOMATION_WORKER_TOKEN") && storefront.includes("protectedTokenMatches") && storefront.includes("x-nxq-worker-token")],
  ["Custom-auth workers retain explicit gateway exceptions", manifest.includes('entry("prepare-build-plan", false') && manifest.includes('entry("ingest-business-lead", false') && workflow.includes("--no-verify-jwt")],
  ["Manual workflow is staging-only", workflow.includes("environment: nxq-staging") && !workflow.includes("environment: nxq-production")],
  ["Staging mutations retain dry-run and exact confirmation", workflow.includes("db push --dry-run --linked") && workflow.includes("APPLY-NXQ-SUPABASE-STAGING")],
  ["Workflow uses locked repository tooling", workflow.includes("npm ci") && workflow.includes("npx --no-install supabase") && !workflow.includes("version: latest")],
  ["Remote secret names are checked without values", workflow.includes("secrets list") && workflow.includes("--output-format json") && preflight.includes("without reading or printing any secret value")],
  ["Remote function coverage is verified after deploy", workflow.includes("functions list") && workflow.includes("--supabase-functions-json=")],
  ["Runtime profiles cover zero-key staging, Business prelaunch, external QA, and launch", manifest.includes('"business-zero-key-staging"') && manifest.includes('"business-prelaunch"') && manifest.includes('"business-external-qa"') && manifest.includes('"business-launch"') && manifest.includes("NXQ_AI_MODEL_PROVIDER_TOKEN") && manifest.includes("NXQ_MALWARE_SCAN_ADAPTER_TOKEN") && manifest.includes("NXQ_RUNTIME_ENVIRONMENT")],
  ["Prelaunch checks every launch secret except the missing model token", workflow.includes("--profile=business-prelaunch") && manifest.includes('"NXQ_AI_MODEL_PROVIDER_URL"') && manifest.includes('"NXQ_AI_MODEL_PROVIDER_MODEL"') && manifest.includes('"NXQ_AI_MODEL_PROVIDER_PROTOCOL"')],
  ["Every Vault scheduler route has an exact function mapping", manifest.includes("vaultRuntimeRoutes") && migration.includes("nxq_automation_edge_url") && migration.includes("nxq_provider_health_edge_url")],
  ["Vault bootstrap is service-only and never returns values", migration.includes("auth.role()<>'service_role'") && migration.includes("secret_values_returned',false") && bootstrap.includes("secret_values_returned: false")],
  ["Vault bootstrap updates duplicate names without deleting secrets", migration.includes("for existing_id in") && migration.includes("vault.update_secret") && !migration.includes("delete from vault.secrets")],
  ["Provider registry seeds launch-critical providers", ["'github'","'netlify'","'malware_scan'","'notification_adapter'","'provider_health_adapter'","'change_classifier_ai'"].every((key) => migration.includes(key))],
  ["Notification readiness requires adapter heartbeat and provider health", migration.includes("worker_key='dispatch-notifications'") && migration.includes("provider_key='notification_adapter'") && migration.includes("adapter_heartbeat_required")],
  ["Notification worker records truthful adapter health and in-app-only fallback", notifications.includes("adapter_configured: adapterConfigured") && notifications.includes("external_delivery_enabled: adapterConfigured") && notifications.includes('deliveryMode = adapterConfigured ? "external_and_in_app" : "in_app_only"') && notifications.includes('target_worker_key: workerName') && notifications.includes('target_status: adapterConfigured ? "healthy" : "degraded"')],
  ["Owner runtime bootstrap requires explicit confirmation and staging lock", ownerUi.includes("CONFIGURE-NXQ-STAGING-RUNTIME") && bootstrap.includes("requiredConfirmation") && bootstrap.includes("owner_users") && bootstrap.includes('runtimeEnvironment !== "staging"')],
  ["Owner bootstrap cannot silently claim production work", bootstrap.includes("production_changed: false") && ownerUi.includes("does not create a client")],
  ["One-command release and runtime checks are wired", pkg.includes('"test:runtime-stage"') && pkg.includes('"test:migrations"') && pkg.includes('"test:release"') && ci.includes("Wave 31 runtime staging contract")],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-thirty-one checks passed.`);
if (passed !== checks.length) process.exit(1);
