import fs from "node:fs";

const legacyApproval = fs.readFileSync("supabase/migrations/097_automation_backend_foundation.sql", "utf8");
const canonicalOnboarding = fs.readFileSync("supabase/migrations/099_automatic_onboarding_and_progression.sql", "utf8");
const repair = fs.readFileSync("supabase/migrations/245_harden_business_approval_run_idempotency.sql", "utf8");

const checks = [
  ["Historical duplicate source remains forward-only", legacyApproval.includes(":prepare-build-plan:v1")],
  ["Canonical Business plan key remains v2", canonicalOnboarding.includes(":prepare-build-plan:v2")],
  ["Repair redefines approved-client bootstrap", repair.includes("create or replace function public.bootstrap_approved_client_automation()")],
  ["Business bootstrap requires accepted owner setup approval", repair.includes("accepted_owner_approval_required") && repair.includes("website_setup_review")],
  ["Business bootstrap evaluates onboarding immediately", repair.includes("onboarding_result := public.evaluate_client_onboarding(new.id)")],
  ["Legacy v1 plan enqueue is excluded from Business", repair.includes("if family_slug <> 'business' then") && repair.includes(":prepare-build-plan:v1")],
  ["Website bootstrap serializes per project", repair.includes("pg_advisory_xact_lock(hashtextextended(project_row.project_id::text, 0))")],
  ["An active website run blocks another run", repair.includes("active_run.status not in ('published', 'failed', 'cancelled')")],
  ["A historical terminal run requires explicit applied change intent", repair.includes("atomic_change_applied") && repair.includes("change_request.status = 'queued'")],
  ["Change intent is durably linked to one reserved run", repair.includes("'website_automation_run_id', run_id") && repair.includes("'bootstrap_reserved', true")],
  ["Scheduled terminal replay is explicitly disabled", repair.includes("'scheduled_terminal_replays_allowed', false")],
  ["Owner publication gate stays closed", repair.includes("'auto_publish', false") && repair.includes("'main_merge_allowed', false")],
  ["Only service role may invoke website bootstrap", repair.includes("grant execute on function public.bootstrap_ready_website_automation()\nto service_role")],
  ["Repair contains no provider or billing mutation", !/api\.github\.com|api\.netlify\.com|stripe|payment_method|billing_provider/i.test(repair)],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

console.log(`\n${checks.length - failed}/${checks.length} Business approval/run idempotency checks passed.`);
if (failed) process.exit(1);

