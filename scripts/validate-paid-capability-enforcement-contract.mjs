import fs from "node:fs";
import path from "node:path";
import { edgeFunctionManifest } from "./edge-function-manifest.mjs";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/246_enforce_paid_capability_boundaries.sql");
const economicCeilingMigration = read("supabase/migrations/247_enforce_economic_hard_ceiling.sql");
const stagingWorkflow = read(".github/workflows/manual-supabase-stage.yml").replaceAll("\r\n", "\n");
const checks = [];
const check = (name, passed) => checks.push([name, Boolean(passed)]);

function workflowStep(name) {
  const marker = `      - name: ${name}`;
  const start = stagingWorkflow.indexOf(marker);
  if (start < 0) return "";
  const end = stagingWorkflow.indexOf("\n      - name:", start + marker.length);
  return stagingWorkflow.slice(start, end < 0 ? stagingWorkflow.length : end);
}

function functionArray(step, variableName) {
  const pattern = new RegExp(`${variableName}=\\(\\n([\\s\\S]*?)\\n\\s*\\)`);
  return (pattern.exec(step)?.[1] || "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

check("Canonical authorization requires service role", migration.includes("nxq_authorize_paid_capability") && migration.includes("if auth.role()<>'service_role'"));
check("Billing and lifecycle deny before entitlement and spend", migration.includes("Paid capability denied by billing state") && migration.includes("Paid capability denied by client lifecycle"));
check("Feature entitlement precedes resource and economic reservations", migration.indexOf("Paid capability denied by subscription tier") < migration.indexOf("for item in select key,value from jsonb_each_text"));
check("Credits remain usage-only", migration.includes("usage_credit_required") && !migration.includes("credit_unlock"));
check("Economic reservations support idempotent release and reconciliation", migration.includes("nxq_finalize_economic_usage") && migration.includes("usage-refund:") && migration.includes("status in ('released','reconciled','consumed')"));
const ceilingCheckPosition = economicCeilingMigration.indexOf("if projected>hard_ceiling then");
const creditSpendPosition = economicCeilingMigration.indexOf("insert into public.nxq_usage_credit_ledger");
const reservationInsertPosition = economicCeilingMigration.indexOf("insert into public.nxq_economic_usage_reservations");
check("Economic hard ceiling rejects before credit spend and reservation creation",
  economicCeilingMigration.includes("create or replace function public.nxq_reserve_economic_usage") &&
  economicCeilingMigration.includes("'reason','minimum_margin_ceiling_exceeded'") &&
  ceilingCheckPosition > economicCeilingMigration.indexOf("projected:=spent_this_month+target_estimated_provider_cost_cents") &&
  ceilingCheckPosition < creditSpendPosition &&
  ceilingCheckPosition < reservationInsertPosition);
check("Economic hard-ceiling migration preserves service-role and billing boundaries",
  economicCeilingMigration.includes("if auth.role()<>'service_role'") &&
  economicCeilingMigration.includes("Client lifecycle does not permit paid usage") &&
  economicCeilingMigration.includes("Client billing state does not permit paid usage") &&
  economicCeilingMigration.includes("Economic policy missing; deny by default") &&
  economicCeilingMigration.includes("to service_role"));
check("Platform-funded Growth and Sales work defaults closed", migration.includes("nxq_platform_cost_settings") && migration.includes("emergency_stop boolean not null default true") && migration.includes("monthly_limit_cents integer not null default 0"));
check("Automatic policy seeding is owner or service only", migration.includes("Only an owner or protected service may seed resource policies") && migration.includes("update of product_family_id,product_tier_id,monthly_price,qa_only,status"));
check("Enterprise minimum is enforced on activation and price changes", migration.includes("Enterprise monthly price must be at least $150") && migration.includes("update of product_tier_id,monthly_price,status"));
check("Business page and location limits are authoritative", read("supabase/functions/prepare-build-plan/index.ts").includes("limits?.core_pages") && migration.includes("nxq_enforce_location_entitlement"));
check("Storage tickets reserve, consume, cancel, and expire", ["nxq_authorize_storage_upload", "nxq_complete_storage_upload_ticket", "nxq_cancel_storage_upload_ticket", "nxq_storage_upload_ticket_valid", "'consumed','cancelled','expired'", "set status='expired'", "reservation.status='reserved'"].every((token) => migration.includes(token)));
check("Storage insert and update bypasses are closed", migration.includes("nxq_ticketed_paid_storage_insert") && migration.includes("nxq_ticketed_paid_storage_update"));
check("Automation, maintenance, Commerce, and notification transitions are guarded", ["nxq_guard_external_job_transition", "nxq_guard_maintenance_transition", "nxq_guard_storefront_transition", "nxq_guard_notification_transition"].every((token) => migration.includes(token)));

const paidGuardDeployStep = workflowStep("Deploy paid-capability guard functions only");
const expectedVerifyJwtFunctions = [
  "audit-prospect-website",
  "check-preview-deployment-safety",
  "check-preview-netlify-status",
  "check-production-launch-audit",
  "check-production-netlify-status",
  "discover-sales-prospects",
  "draft-sales-outreach-ai",
  "execute-preview-netlify-build",
  "execute-production-netlify-build",
  "publish-production-netlify-deploy",
  "verify-deployment-connection",
];
const expectedNoVerifyJwtFunctions = [
  "check-provider-health",
  "ingest-business-analytics",
  "ingest-business-lead",
  "prepare-build-plan",
  "provision-storefront",
  "upload-commerce-request-reference",
];
const deployedVerifyJwtFunctions = functionArray(paidGuardDeployStep, "verify_jwt_functions");
const deployedNoVerifyJwtFunctions = functionArray(paidGuardDeployStep, "no_verify_jwt_functions");
const expectedPaidGuardFunctions = [...expectedVerifyJwtFunctions, ...expectedNoVerifyJwtFunctions];
const deployedPaidGuardFunctions = [...deployedVerifyJwtFunctions, ...deployedNoVerifyJwtFunctions];
check("Paid-capability deployment action has the exact 17-function allowlist",
  stagingWorkflow.includes("          - deploy_paid_capability_guards") &&
  JSON.stringify(deployedPaidGuardFunctions) === JSON.stringify(expectedPaidGuardFunctions) &&
  new Set(deployedPaidGuardFunctions).size === 17);
check("Paid-capability deployment preserves every manifest JWT boundary",
  expectedVerifyJwtFunctions.every((name) => edgeFunctionManifest.some((entry) => entry.name === name && entry.verifyJwt === true)) &&
  expectedNoVerifyJwtFunctions.every((name) => edgeFunctionManifest.some((entry) => entry.name === name && entry.verifyJwt === false)) &&
  (paidGuardDeployStep.match(/--no-verify-jwt/g) || []).length === 1);
check("Paid-capability deployment excludes every unrelated Edge function",
  edgeFunctionManifest.filter((entry) => !expectedPaidGuardFunctions.includes(entry.name))
    .every((entry) => !deployedPaidGuardFunctions.includes(entry.name)));
const mutationConfirmationStep = workflowStep("Require explicit mutation confirmation");
check("Paid-capability deployment requires the exact staging mutation confirmation",
  mutationConfirmationStep.includes('inputs.action != \'validate_non_ai\'') &&
  !mutationConfirmationStep.includes("inputs.action != 'deploy_paid_capability_guards'") &&
  mutationConfirmationStep.includes('inputs.confirmation }}" != "APPLY-NXQ-SUPABASE-STAGING"'));
check("Paid-capability deployment cannot run under another action",
  paidGuardDeployStep.includes("if: inputs.action == 'deploy_paid_capability_guards'") &&
  !paidGuardDeployStep.includes("apply_all") &&
  !paidGuardDeployStep.includes("api.netlify.com") &&
  !paidGuardDeployStep.includes("db push"));

const paidGuardValidationStep = workflowStep("Validate paid-capability guards transactionally");
const paidGuardValidationRunner = read("scripts/validate-paid-capability-guards-staging.mjs");
const paidGuardValidationSql = read("scripts/sql/validate-paid-capability-guards-staging.sql");
const paidGuardValidationChecks = [
  "tier_denial",
  "credits_usage_only",
  "billing_state_denial",
  "included_usage_accounting",
  "purchased_credit_accounting",
  "business_page_limits",
  "business_location_limits",
  "resource_limit_rejection",
  "economic_margin_rejection",
  "reservation_idempotency",
  "reservation_release",
  "reservation_reconciliation",
  "storage_quota_authorization",
  "storage_reservation_cleanup",
  "tenant_isolation",
  "synthetic_fixtures_only",
  "no_external_runtime",
  "rollback_forced",
];
check("Transactional paid-capability validation is an explicit isolated action",
  stagingWorkflow.includes("          - validate_paid_capability_guards") &&
  paidGuardValidationStep.includes("if: inputs.action == 'validate_paid_capability_guards'") &&
  paidGuardValidationStep.includes("node scripts/validate-paid-capability-guards-staging.mjs") &&
  !paidGuardValidationStep.includes("apply_all"));
check("Transactional paid-capability validation retains the exact staging confirmation gate",
  !mutationConfirmationStep.includes("inputs.action != 'validate_paid_capability_guards'") &&
  mutationConfirmationStep.includes('inputs.confirmation }}\" != \"APPLY-NXQ-SUPABASE-STAGING\"'));
check("Transactional validation uses a forced rollback sentinel and sanitized booleans only",
  paidGuardValidationSql.includes("do $nxq_paid_guard_wrapper$") &&
  paidGuardValidationSql.includes("execute $nxq_paid_guard_statement$") &&
  paidGuardValidationSql.includes("create function pg_temp.nxq_validate_paid_capability_guards()") &&
  paidGuardValidationSql.includes("perform pg_temp.nxq_validate_paid_capability_guards()") &&
  !paidGuardValidationSql.includes("execute $nxq_paid_guard_statement$\ndo ") &&
  paidGuardValidationSql.includes("raise exception 'NXQ_PAID_GUARD_RESULT:%:NXQ_END'") &&
  paidGuardValidationSql.includes("raise exception 'NXQ_PAID_GUARD_FAILURE:database-sqlstate-%:NXQ_END'") &&
  paidGuardValidationSql.includes("lower(sqlstate)") &&
  paidGuardValidationSql.includes("encode(convert_to(checks::text, 'UTF8'), 'base64')") &&
  paidGuardValidationRunner.includes("NXQ_PAID_GUARD_RESULT:") &&
  paidGuardValidationRunner.includes("NXQ_PAID_GUARD_FAILURE:") &&
  paidGuardValidationRunner.includes(":NXQ_END") &&
  paidGuardValidationRunner.includes("PASS fixture-cleanup-by-rollback") &&
  !paidGuardValidationRunner.includes("console.error(responseText)") &&
  paidGuardValidationRunner.includes("rollback-sentinel-missing") &&
  paidGuardValidationChecks.every((name) =>
    paidGuardValidationSql.includes(`'${name}'`) && paidGuardValidationRunner.includes(`\"${name}\"`)));
check("Transactional validation proves margin rejection has no economic side effects",
  paidGuardValidationSql.includes("result->>'reason' = 'minimum_margin_ceiling_exceeded'") &&
  paidGuardValidationSql.includes("margin_test_cost := greatest(hard_ceiling_before_margin - spent_before_margin + 1, 1)") &&
  paidGuardValidationSql.includes("credit_balance_before_margin = credit_balance_after_margin") &&
  paidGuardValidationSql.includes("idempotency_key = 'synthetic-margin-rejection'") &&
  paidGuardValidationSql.includes("idempotency_key = 'usage-spend:synthetic-margin-rejection'"));
check("Transactional validation proves location and resource denials from isolated state",
  paidGuardValidationSql.includes("location_rejected := lower(sqlerrm) like '%location limit reached%'") &&
  paidGuardValidationSql.includes("select count(*) into active_location_count") &&
  paidGuardValidationSql.includes("location_rejected and active_location_count = 1 then\n    checks := jsonb_set(checks, '{business_location_limits}', 'true');\n  end if;") &&
  paidGuardValidationSql.includes("where client_id = client_one and status <> 'closed'") &&
  paidGuardValidationSql.includes("resource_result->>'reason' = 'monthly_limit_reached'") &&
  paidGuardValidationSql.includes("'synthetic-resource-policy-probe'") &&
  paidGuardValidationSql.includes("'synthetic-resource-limit:api_requests'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{resource_limit_rejection}', 'true');\n  end if;"));
check("Transactional storage validation refreshes identity and isolates every cleanup phase",
  paidGuardValidationSql.includes("select auth.role(), auth.uid()") &&
  paidGuardValidationSql.includes("synthetic_uid = user_one") &&
  paidGuardValidationSql.includes("synthetic_uid = user_two") &&
  paidGuardValidationSql.includes("result := public.nxq_authorize_storage_upload(") &&
  paidGuardValidationSql.includes("storage_ticket_valid := public.nxq_storage_upload_ticket_valid(") &&
  paidGuardValidationSql.includes("perform public.nxq_cancel_storage_upload_ticket(ticket_id)") &&
  !paidGuardValidationSql.includes("execute 'select public.nxq_") &&
  paidGuardValidationSql.includes("tenant_denied := lower(sqlerrm) like '%not found%'") &&
  paidGuardValidationSql.includes("name = storage_path"));
check("Transactional validation isolates supported non-dispatching client fixtures and state-based idempotency",
  paidGuardValidationSql.includes("'Synthetic Validation', 'overdue', 50, 'active', 'synthetic'") &&
  paidGuardValidationSql.includes("reservation_entries = 1 and credit_entries = 1") &&
  !paidGuardValidationSql.includes("result->>'idempotent'"));
check("Transactional validation is synthetic and excludes external runtime surfaces",
  paidGuardValidationSql.includes("@synthetic.invalid") &&
  paidGuardValidationSql.includes("'no_external_runtime', true") &&
  !paidGuardValidationSql.includes("http") &&
  !paidGuardValidationSql.includes("netlify") &&
  !paidGuardValidationSql.includes("storage.objects(") &&
  !paidGuardValidationRunner.includes("functions/v1") &&
  !paidGuardValidationStep.includes("dispatch") &&
  !paidGuardValidationStep.includes("smoke"));

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
check("Commerce upload tickets avoid redundant nullable initialization",
  !read("src/pages/ClientCommerceCatalog.tsx").includes("let uploadTicketId: string | null = null") &&
  !read("src/pages/ClientCommerceWebsiteContent.tsx").includes("let uploadTicketId: string | null = null"));
check("Product image cleanup retains a non-null storage client",
  read("src/components/ProductImageManager.tsx").includes("const storageClient = supabase") &&
  read("src/components/ProductImageManager.tsx").includes("cancelStorageUpload(storageClient, ticketId)"));

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
