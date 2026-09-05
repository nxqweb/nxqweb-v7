import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/246_enforce_paid_capability_boundaries.sql");
const checks = [];
const check = (name, passed) => checks.push([name, Boolean(passed)]);

check("Canonical authorization requires service role", migration.includes("nxq_authorize_paid_capability") && migration.includes("if auth.role()<>'service_role'"));
check("Billing and lifecycle deny before entitlement and spend", migration.includes("Paid capability denied by billing state") && migration.includes("Paid capability denied by client lifecycle"));
check("Feature entitlement precedes resource and economic reservations", migration.indexOf("Paid capability denied by subscription tier") < migration.indexOf("for item in select key,value from jsonb_each_text"));
check("Credits remain usage-only", migration.includes("usage_credit_required") && !migration.includes("credit_unlock"));
check("Economic reservations support idempotent release and reconciliation", migration.includes("nxq_finalize_economic_usage") && migration.includes("usage-refund:") && migration.includes("status in ('released','reconciled','consumed')"));
check("Platform-funded Growth and Sales work defaults closed", migration.includes("nxq_platform_cost_settings") && migration.includes("emergency_stop boolean not null default true") && migration.includes("monthly_limit_cents integer not null default 0"));
check("Automatic policy seeding is owner or service only", migration.includes("Only an owner or protected service may seed resource policies") && migration.includes("update of product_family_id,product_tier_id,monthly_price,qa_only,status"));
check("Enterprise minimum is enforced on activation and price changes", migration.includes("Enterprise monthly price must be at least $150") && migration.includes("update of product_tier_id,monthly_price,status"));
check("Business page and location limits are authoritative", read("supabase/functions/prepare-build-plan/index.ts").includes("limits?.core_pages") && migration.includes("nxq_enforce_location_entitlement"));
check("Storage tickets reserve, consume, cancel, and expire", ["nxq_authorize_storage_upload", "nxq_complete_storage_upload_ticket", "nxq_cancel_storage_upload_ticket", "nxq_storage_upload_ticket_valid", "'consumed','cancelled','expired'", "set status='expired'", "reservation.status='reserved'"].every((token) => migration.includes(token)));
check("Storage insert and update bypasses are closed", migration.includes("nxq_ticketed_paid_storage_insert") && migration.includes("nxq_ticketed_paid_storage_update"));
check("Automation, maintenance, Commerce, and notification transitions are guarded", ["nxq_guard_external_job_transition", "nxq_guard_maintenance_transition", "nxq_guard_storefront_transition", "nxq_guard_notification_transition"].every((token) => migration.includes(token)));

const uploadCallers = [
  "src/pages/ClientPortal.tsx",
  "src/pages/ClientCommerceCatalog.tsx",
  "src/pages/ClientCommerceWebsiteContent.tsx",
  "src/components/ProductImageManager.tsx",
];
for (const file of uploadCallers) {
  const source = read(file);
  check(`${file} reserves and finalizes storage`, source.includes("authorizeStorageUpload") && source.includes("completeStorageUpload") && source.includes("cancelStorageUpload"));
}

const fetchFunctions = fs.readdirSync(path.join(root, "supabase/functions"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(root, "supabase/functions", name, "index.ts")))
  .filter((name) => read(`supabase/functions/${name}/index.ts`).includes("fetch("));

const directGuard = new Map([
  ["audit-prospect-website", "nxq_reserve_platform_usage"],
  ["check-preview-deployment-safety", "nxq_authorize_paid_capability"],
  ["check-preview-netlify-status", "nxq_authorize_paid_capability"],
  ["check-production-launch-audit", "nxq_authorize_paid_capability"],
  ["check-production-netlify-status", "nxq_authorize_paid_capability"],
  ["check-provider-health", "nxq_reserve_platform_usage"],
  ["discover-sales-prospects", "nxq_reserve_platform_usage"],
  ["draft-sales-outreach-ai", "nxq_reserve_platform_usage"],
  ["execute-preview-netlify-build", "nxq_authorize_preview_execution"],
  ["execute-production-netlify-build", "nxq_authorize_paid_capability"],
  ["ingest-business-lead", "nxq_authorize_paid_capability"],
  ["publish-production-netlify-deploy", "nxq_authorize_paid_capability"],
  ["verify-deployment-connection", "nxq_authorize_paid_capability"],
]);
const claimedGuard = new Map([
  ["build-business-location-pages", "claim_next_external_automation_job"],
  ["build-business-seo-artifacts", "claim_next_external_automation_job"],
  ["build-business-website", "claim_next_external_automation_job"],
  ["classify-business-change-request", "claim_next_external_automation_job"],
  ["dispatch-notifications", "status: \"sending\""],
  ["prepare-build-plan", "claim_next_external_automation_job"],
  ["promote-business-production", "claim_next_external_automation_job"],
  ["provision-project-infrastructure", "claim_next_external_automation_job"],
  ["provision-storefront", "claim_next_storefront_provisioning_job"],
  ["reconcile-domain", "claim_next_external_automation_job"],
  ["run-website-maintenance", "claim_next_website_maintenance_task"],
  ["scan-client-file", "claim_next_client_file_security_scan"],
]);
const adapterGuard = new Set(["generate-business-build-plan", "malware-scan-provider-adapter", "notification-provider-adapter", "provider-health-adapter"]);
const stagingOnly = new Set(["run-staging-evidence-suite"]);
const classified = new Set([...directGuard.keys(), ...claimedGuard.keys(), ...adapterGuard, ...stagingOnly]);
check("Every fetch-capable Edge function has a reviewed enforcement class", fetchFunctions.every((name) => classified.has(name)) && [...classified].every((name) => fetchFunctions.includes(name)));
for (const [name, token] of directGuard) check(`${name} has a direct economic guard`, read(`supabase/functions/${name}/index.ts`).includes(token));
for (const [name, token] of claimedGuard) check(`${name} enters through a guarded claim`, read(`supabase/functions/${name}/index.ts`).includes(token));
for (const name of adapterGuard) {
  const source = read(`supabase/functions/${name}/index.ts`);
  check(`${name} requires a protected adapter token`, source.includes("constantTimeEqual") && source.includes("Authorization"));
}
for (const name of stagingOnly) {
  const source = read(`supabase/functions/${name}/index.ts`);
  check(`${name} remains staging-only and worker-token protected`, source.includes("NXQ_RUNTIME_ENVIRONMENT") && source.includes("x-nxq-worker-token"));
}

check("Preview and Commerce builds reserve Netlify credits", read("supabase/functions/execute-preview-netlify-build/index.ts").includes("nxq_authorize_preview_execution") && read("supabase/functions/provision-storefront/index.ts").includes("nxq_reserve_netlify_build"));
check("Production build uses service-role paid and Netlify guards", read("supabase/functions/execute-production-netlify-build/index.ts").includes("guardAdmin.rpc(\"nxq_authorize_paid_capability\"") && read("supabase/functions/execute-production-netlify-build/index.ts").includes("guardAdmin.rpc(\"nxq_reserve_netlify_build\""));
check("Commerce reference upload reserves storage and economic usage", read("supabase/functions/upload-commerce-request-reference/index.ts").includes("nxq_authorize_paid_capability") && read("supabase/functions/upload-commerce-request-reference/index.ts").includes("nxq_finalize_economic_usage"));
check("Analytics ingestion has a server-side entitlement and quota guard", read("supabase/functions/ingest-business-analytics/index.ts").includes('target_feature_key:"basic_analytics"') && read("supabase/functions/ingest-business-analytics/index.ts").includes("nxq_authorize_paid_capability"));

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} paid-capability enforcement checks passed.`);
if (failed) process.exit(1);
