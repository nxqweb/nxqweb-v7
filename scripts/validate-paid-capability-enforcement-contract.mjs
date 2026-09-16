import fs from "node:fs";
import path from "node:path";
import { edgeFunctionManifest } from "./edge-function-manifest.mjs";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/246_enforce_paid_capability_boundaries.sql");
const economicCeilingMigration = read("supabase/migrations/247_enforce_economic_hard_ceiling.sql");
const tenantSafeMutationMigration = read("supabase/migrations/185_tenant_safe_client_mutations.sql");
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
check("Business page and location limits are authoritative",
  read("supabase/functions/prepare-build-plan/index.ts").includes("limits?.core_pages") &&
  migration.includes("nxq_enforce_location_entitlement") &&
  migration.includes("Current plan location limit reached (%)") &&
  tenantSafeMutationMigration.includes("create or replace function public.current_client_create_location(") &&
  tenantSafeMutationMigration.includes("client_row.status::text not in ('approved','active')") &&
  tenantSafeMutationMigration.includes("location_limit:=case when tier_key_value='enterprise' then 100 else 1 end") &&
  tenantSafeMutationMigration.includes("Current plan location limit reached (%). Request Enterprise for multi-location support."));
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
  "location_identity_established",
  "location_client_visible",
  "location_lifecycle_eligible",
  "location_business_tier_compatible",
  "location_billing_eligible",
  "location_zero_existing",
  "location_schema_client_locations_columns",
  "location_entitlement_trigger_phase_compatible",
  "location_queue_trigger_phase_compatible",
  "location_queue_enqueue_function_compatible",
  "location_queue_automation_jobs_base_columns_compatible",
  "location_queue_execution_target_column_compatible",
  "location_queue_execution_target_trigger_compatible",
  "location_queue_enqueue_runtime_probe",
  "location_insert_trigger_probe",
  "location_audit_write_probe",
  "location_result_construction_probe",
  "location_first_created",
  "location_second_denied",
  "location_denial_classified",
  "location_active_count_one",
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
const paidGuardLocationDiagnosticChecks = [
  "location_first_failure_authentication",
  "location_first_failure_client_not_found",
  "location_first_failure_lifecycle",
  "location_first_failure_tier",
  "location_first_failure_subscription",
  "location_first_failure_input_validation",
  "location_first_failure_downstream_schema_write",
  "location_failure_integrity_constraint",
  "location_failure_permission",
  "location_failure_missing_schema_object",
  "location_failure_undefined_column",
  "location_failure_undefined_function",
  "location_failure_undefined_table",
  "location_failure_undefined_object",
  "location_failure_trigger_rejection",
  "location_failure_unknown_downstream",
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
    paidGuardValidationSql.includes(`'${name}'`) && paidGuardValidationRunner.includes(`\"${name}\"`)) &&
  paidGuardLocationDiagnosticChecks.every((name) =>
    paidGuardValidationSql.includes(`'${name}'`) && paidGuardValidationRunner.includes(`\"${name}\"`)) &&
  paidGuardValidationRunner.includes('typeof result[name] === "boolean"'));
check("Transactional validation initializes its complete boolean shape below PostgreSQL's argument limit",
  paidGuardValidationSql.includes("select jsonb_object_agg(check_name, false)") &&
  paidGuardValidationSql.includes("'synthetic_fixtures_only', 'no_external_runtime', 'rollback_forced'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{synthetic_fixtures_only}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{no_external_runtime}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{rollback_forced}', 'true')") &&
  !paidGuardValidationSql.includes("checks jsonb := jsonb_build_object("));
check("Transactional validation proves margin rejection has no economic side effects",
  paidGuardValidationSql.includes("result->>'reason' = 'minimum_margin_ceiling_exceeded'") &&
  paidGuardValidationSql.includes("margin_test_cost := greatest(hard_ceiling_before_margin - spent_before_margin + 1, 1)") &&
  paidGuardValidationSql.includes("credit_balance_before_margin = credit_balance_after_margin") &&
  paidGuardValidationSql.includes("idempotency_key = 'synthetic-margin-rejection'") &&
  paidGuardValidationSql.includes("idempotency_key = 'usage-spend:synthetic-margin-rejection'"));
const paidGuardLocationPhase = paidGuardValidationSql.slice(
  paidGuardValidationSql.indexOf("-- Exercise the same authenticated RPC used by the client portal."),
  paidGuardValidationSql.indexOf("-- Keep the resource denial independently rollback-safe"),
);
check("Transactional validation proves location and resource denials from isolated state",
  (paidGuardValidationSql.match(/public\.current_client_create_location\(/g) || []).length === 2 &&
  (paidGuardValidationSql.match(/insert into public\.client_locations\(/g) || []).length === 1 &&
  paidGuardValidationSql.includes("jsonb_build_object('role', 'authenticated', 'sub', user_two)::text") &&
  paidGuardValidationSql.includes("synthetic_role <> 'authenticated' or synthetic_uid <> user_two") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_identity_established}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_client_visible}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_lifecycle_eligible}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_business_tier_compatible}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_billing_eligible}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_zero_existing}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_schema_client_locations_columns}', 'true')") &&
  paidGuardValidationSql.includes("'structured_data', 'created_at', 'updated_at'") &&
  paidGuardValidationSql.includes("to_regprocedure('public.nxq_enforce_location_entitlement()') is not null") &&
  paidGuardValidationSql.includes("tgname = 'nxq_enforce_location_entitlement'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_entitlement_trigger_phase_compatible}', 'true')") &&
  paidGuardValidationSql.includes("to_regprocedure('public.queue_location_seo_refresh()') is not null") &&
  paidGuardValidationSql.includes("tgname = 'queue_location_seo_refresh_from_location'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_queue_trigger_phase_compatible}', 'true')") &&
  paidGuardValidationSql.includes("('public.projects', 'created_at')") &&
  paidGuardValidationSql.includes("create function pg_temp.nxq_probe_location_queue_dependency(") &&
  paidGuardValidationSql.includes("to_regprocedure('public.enqueue_automation_job(uuid,uuid,text,text,jsonb,timestamptz,integer)') is not null") &&
  paidGuardValidationSql.includes("probe_checks := jsonb_set(probe_checks, '{location_queue_enqueue_function_compatible}', 'true')") &&
  paidGuardValidationSql.includes("location_queue_automation_jobs_base_columns_compatible") &&
  paidGuardValidationSql.includes("'execution_target'") &&
  paidGuardValidationSql.includes("probe_checks := jsonb_set(probe_checks, '{location_queue_execution_target_column_compatible}', 'true')") &&
  paidGuardValidationSql.includes("to_regprocedure('public.classify_automation_execution_target()') is not null") &&
  paidGuardValidationSql.includes("probe_checks := jsonb_set(probe_checks, '{location_queue_execution_target_trigger_compatible}', 'true')") &&
  paidGuardValidationSql.includes("'synthetic-location-queue-dependency'") &&
  paidGuardValidationSql.includes("probe_checks := jsonb_set(probe_checks, '{location_queue_enqueue_runtime_probe}', 'true')") &&
  paidGuardValidationSql.includes("checks := checks || pg_temp.nxq_probe_location_queue_dependency(client_two, user_one)") &&
  paidGuardValidationSql.includes("attribute.attrelid = to_regclass(required.relation_name)") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_insert_trigger_probe}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_audit_write_probe}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_result_construction_probe}', 'true')") &&
  paidGuardValidationSql.includes("insert into public.client_locations(") &&
  paidGuardValidationSql.includes("insert into public.automation_audit_log(") &&
  paidGuardValidationSql.includes("delete from public.automation_audit_log where id = location_probe_audit_id") &&
  paidGuardValidationSql.includes("delete from public.client_locations where id = location_probe.id") &&
  paidGuardValidationSql.includes("'location', to_jsonb(location_probe)") &&
  paidGuardValidationSql.includes("coalesce((result->>'ok')::boolean, false)") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_first_created}', 'true')") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_second_denied}', 'true')") &&
  paidGuardValidationSql.includes("location_rejected := sqlstate = 'P0001'") &&
  paidGuardValidationSql.includes("and lower(sqlerrm) like '%location limit reached%'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_denial_classified}', 'true')") &&
  paidGuardValidationSql.includes("select count(*) into active_location_count") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_active_count_one}', 'true')") &&
  paidGuardValidationSql.includes("checks->>'location_identity_established' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_client_visible' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_lifecycle_eligible' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_business_tier_compatible' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_billing_eligible' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_zero_existing' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_first_created' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_second_denied' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_denial_classified' = 'true'") &&
  paidGuardValidationSql.includes("checks->>'location_active_count_one' = 'true'") &&
  !paidGuardLocationPhase.includes("exception when others then\n    null;") &&
  paidGuardValidationSql.includes("where client_id = client_two and status <> 'closed'") &&
  paidGuardValidationSql.includes("if exists(select 1 from public.projects where client_id = client_two) then") &&
  paidGuardValidationSql.includes("active-client SEO queue trigger inert") &&
  paidGuardValidationSql.includes("lower(sqlerrm) like '%authenticated client access required%'") &&
  paidGuardValidationSql.includes("lower(sqlerrm) like '%client account was not found%'") &&
  paidGuardValidationSql.includes("lower(sqlerrm) like '%client lifecycle does not allow location changes%'") &&
  paidGuardValidationSql.includes("lower(sqlerrm) like '%active business tier is required%'") &&
  paidGuardValidationSql.includes("lower(sqlerrm) like '%current subscription does not permit location creation%'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_first_failure_downstream_schema_write}', 'true')") &&
  paidGuardValidationSql.includes("left(sqlstate, 2) = '23'") &&
  paidGuardValidationSql.includes("sqlstate = '42501'") &&
  paidGuardValidationSql.includes("sqlstate = '42703'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_failure_undefined_column}', 'true')") &&
  paidGuardValidationSql.includes("sqlstate = '42883'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_failure_undefined_function}', 'true')") &&
  paidGuardValidationSql.includes("sqlstate = '42P01'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_failure_undefined_table}', 'true')") &&
  paidGuardValidationSql.includes("sqlstate = '42704'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_failure_undefined_object}', 'true')") &&
  paidGuardValidationSql.includes("sqlstate = 'P0001'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{location_failure_unknown_downstream}', 'true')") &&
  paidGuardValidationRunner.includes("for (const diagnostic of diagnosticChecks)") &&
  !paidGuardValidationRunner.includes("console.log(responseText)") &&
  paidGuardValidationSql.includes("jsonb_build_object('role', 'service_role', 'sub', user_one)::text") &&
  paidGuardValidationSql.includes("resource_result->>'reason' = 'monthly_limit_reached'") &&
  paidGuardValidationSql.includes("'synthetic-resource-policy-probe'") &&
  paidGuardValidationSql.includes("'synthetic-resource-limit:api_requests'") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{resource_limit_rejection}', 'true');\n    end if;\n  exception when others then\n    null;\n  end;"));
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
  paidGuardValidationSql.includes("'Synthetic Validation', 'active', 50, 'active', 'synthetic'") &&
  !paidGuardValidationSql.includes("'Synthetic Validation', 'approved'") &&
  paidGuardValidationSql.includes("reservation_entries = 1 and credit_entries = 1") &&
  !paidGuardValidationSql.includes("result->>'idempotent'"));
check("Transactional validation is synthetic and excludes external runtime surfaces",
  paidGuardValidationSql.includes("@synthetic.invalid") &&
  paidGuardValidationSql.includes("checks := jsonb_set(checks, '{no_external_runtime}', 'true')") &&
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
