import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/180_single_owner_website_setup_decision.sql");
const ownerPortal = read("src/pages/OwnerPortal.tsx");
const intakeSync = read("supabase/migrations/103_fix_onboarding_automation_and_setup_sync.sql");
const bootstrap = read("supabase/migrations/097_automation_backend_foundation.sql");
const denial = read("supabase/migrations/129_hard_stop_denied_client_pipeline.sql");
const ci = read(".github/workflows/ci-mega-extended.yml");

const approvalUpdateIndex = migration.indexOf("update public.owner_approval_requests");
const clientUpdateIndex = migration.indexOf("update public.clients", approvalUpdateIndex);

const checks = [
  ["Owner Portal uses the protected setup-approval RPC", ownerPortal.includes('supabase.rpc("approve_website_setup"')],
  ["Migration defines the previously missing RPC", migration.includes("create or replace function public.approve_website_setup(approval_request_id uuid)")],
  ["Approval requires an authenticated owner rather than a worker", migration.includes("auth.role() <> 'authenticated'") && migration.includes("from public.owner_users ou")],
  ["Service role has no execute grant on the human decision", migration.includes("from public, anon, authenticated, service_role") && migration.includes("to authenticated;") && !migration.includes("to authenticated, service_role")],
  ["Approval and client rows are locked before decision", (migration.match(/for update;/g) || []).length >= 2],
  ["Only pending website setup reviews are accepted", migration.includes("request_row.request_type <> 'website_setup_review'") && migration.includes("request_row.status::text <> 'pending'")],
  ["Terminal and hard-stopped clients fail closed", migration.includes("client_row.pipeline_stopped_at is not null") && migration.includes("'denied', 'overdue', 'frozen', 'dormant', 'archived'")],
  ["A complete structured setup report is mandatory", migration.includes("NXQ WEB WEBSITE SETUP REPORT") && migration.includes("complete NXQ website setup report")],
  ["Approval is committed before client automation becomes eligible", approvalUpdateIndex >= 0 && clientUpdateIndex > approvalUpdateIndex],
  ["Accepted decision records resolution and owner authority", migration.includes("status = 'accepted'") && migration.includes("resolved_at = now()") && migration.includes("website_setup_owner_approved")],
  ["Client becomes approved without being marked active", migration.includes("else 'approved'::public.client_status") && !migration.includes("set billing_status")],
  ["Existing intake-sync trigger remains the structured-data authority", intakeSync.includes("sync_accepted_website_setup_to_intake") && migration.includes("structured client intake")],
  ["Existing approved-client trigger remains the normal job authority", bootstrap.includes("bootstrap_client_automation_after_approval") && bootstrap.includes("ensure_project_workspace") && bootstrap.includes("prepare_build_plan")],
  ["Legacy pre-approved workspaces are reconciled idempotently", migration.includes("accepted_setup_reconciliation") && migration.includes("project:' || project_uuid::text || ':provision-infrastructure:v1")],
  ["Decision does not create payment or subscription records", !migration.includes("billing_subscriptions") && !migration.includes("billing_payment_attempts") && !migration.includes("payment_records")],
  ["Decision does not bypass production publication controls", migration.includes("'production_gate_bypassed', false") && !migration.includes("last_deployment_status = 'published'")],
  ["DENY still hard-stops the pipeline independently", denial.includes("enforce_website_setup_denial_stop") && denial.includes("status = 'cancelled'")],
  ["Extended CI enforces Wave 20", ci.includes("validate-autonomy-ops-wave20-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${label}`);
  }
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty checks passed.`);
if (passed !== checks.length) process.exit(1);
