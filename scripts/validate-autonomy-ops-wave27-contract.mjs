import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const automaticBase = read("supabase/migrations/100_automatic_billing_orchestration.sql");
const migration = read("supabase/migrations/187_human_billing_freeze_and_exception_recovery.sql");
const billingEvents = read("supabase/migrations/176_ordered_billing_provider_events.sql");
const billingUi = read("src/pages/OwnerBillingLifecycle.tsx");
const clientBilling = read("src/pages/ClientBillingStatus.tsx");
const exceptionsUi = read("src/pages/OwnerExceptionCenter.tsx");
const ci = read(".github/workflows/ci-mega-extended.yml");

const automaticRuntime = migration.split("create or replace function public.owner_set_client_billing_state")[0];
const ownerBillingRuntime = migration.split("create or replace function public.owner_set_client_billing_state")[1]
  .split("create or replace function public.owner_retry_maintenance_exception")[0];
const maintenanceRuntime = migration.split("create or replace function public.owner_retry_maintenance_exception")[1];

const checks = [
  ["Fresh automatic billing no longer contains an automatic freeze update", !automaticBase.includes("billing_service_automatically_frozen") && !automaticBase.includes("set billing_status = 'frozen'")],
  ["Forward automatic billing runtime never freezes", !automaticRuntime.includes("billing_status='frozen'") && automaticRuntime.includes("'automatically_frozen',0")],
  ["Automatic billing stops at human review", automaticRuntime.includes("'billing_moved_to_human_freeze_review'") && automaticRuntime.includes("'requires_owner_decision',true")],
  ["Freeze-review reminders are idempotent per client and day", automaticRuntime.includes(":freeze-review:") && automaticRuntime.includes("to_char(now() at time zone 'UTC','YYYYMMDD')")],
  ["QA clients remain outside automatic billing", automaticRuntime.includes("and not c.qa_only")],
  ["Billing state action requires current owner identity", ownerBillingRuntime.includes("public.owner_users") && ownerBillingRuntime.includes("auth.uid()")],
  ["Billing action locks the exact client", ownerBillingRuntime.includes("where id=target_client_id for update")],
  ["QA billing fails closed", ownerBillingRuntime.includes("QA-only clients are permanently non-billable")],
  ["Freeze and cancellation require a specific owner note", ownerBillingRuntime.includes("next_billing_status in ('frozen','cancelled')") && ownerBillingRuntime.includes("length(coalesce(note_value,''))<8")],
  ["Generic billing action cannot pretend a payment restored service", !ownerBillingRuntime.includes("billing_status='past_due' and next_billing_status in ('active'") && ownerBillingRuntime.includes("Payment restoration must use a verified payment action")],
  ["Owner billing decisions write durable audit evidence", ownerBillingRuntime.includes("owner_billing_state_changed") && ownerBillingRuntime.includes("owner_auth_user_id") && ownerBillingRuntime.includes("'auto_freeze',false")],
  ["Legacy broad billing RPC is retired from authenticated use", migration.includes("revoke execute on function public.set_client_billing_state")],
  ["Owner UI uses the guarded billing RPC", billingUi.includes('rpc("owner_set_client_billing_state"') && !billingUi.includes('rpc("set_client_billing_state"')],
  ["Owner UI requires a freeze reason and explains the grace clock", billingUi.includes("Required freeze reason") && billingUi.includes("graceLabel") && billingUi.includes("Confirm Human Freeze")],
  ["Client billing copy accurately promises human review", clientBilling.includes("has not been frozen automatically") && clientBilling.includes("Only set after the owner confirms a freeze")],
  ["Verified provider success can restore while one event never freezes", billingEvents.includes("auto_unfreeze_on_verified_payment") && billingEvents.includes("'auto_freeze',false") && !billingEvents.includes("then 'frozen'")],
  ["Maintenance recovery requires an authenticated owner", maintenanceRuntime.includes("public.owner_users") && maintenanceRuntime.includes("auth.uid()")],
  ["Maintenance recovery accepts only failed or blocked safe task types", maintenanceRuntime.includes("task_row.status not in ('failed','blocked')") && maintenanceRuntime.includes("'security_scan','seo_check','backup_check','monthly_report'")],
  ["Maintenance recovery rechecks client approval billing and automation", maintenanceRuntime.includes("website_setup_review") && maintenanceRuntime.includes("billing_status::text in ('frozen','cancelled')") && maintenanceRuntime.includes("automation_paused")],
  ["Maintenance recovery requeues instead of force-completing", maintenanceRuntime.includes("status='queued',attempts=0") && maintenanceRuntime.includes("'force_success',false") && !maintenanceRuntime.includes("status='completed'")],
  ["Normal clients cannot directly mutate maintenance authority", ["website_maintenance_alerts", "website_maintenance_tasks", "website_maintenance_plans"].every((table) => migration.includes(`revoke insert,update,delete on public.${table} from authenticated`))],
  ["Exception Center supports safe automation and maintenance retries", exceptionsUi.includes('["automation", "maintenance"]') && exceptionsUi.includes("owner_retry_maintenance_exception") && exceptionsUi.includes("owner_retry_automation_exception")],
  ["Exception Center explicitly says retry cannot bypass approval or production", exceptionsUi.includes("Nothing here can mark a job successful") && exceptionsUi.includes("bypass approval")],
  ["Extended CI enforces Wave 27", ci.includes("validate-autonomy-ops-wave27-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else console.error(`FAIL  ${label}`);
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-seven checks passed.`);
if (passed !== checks.length) process.exit(1);
