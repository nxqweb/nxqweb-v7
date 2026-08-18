import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/181_disposable_business_qa_runner.sql");
const ui = read("src/pages/OwnerLaunchReadiness.tsx");
const ownerPortal = read("src/pages/OwnerPortal.tsx");
const infrastructureWorker = read("supabase/functions/provision-project-infrastructure/index.ts");
const approval = read("supabase/migrations/180_single_owner_website_setup_decision.sql");
const denial = read("supabase/migrations/129_hard_stop_denied_client_pipeline.sql");
const billingQaRepair = read("supabase/migrations/224_skip_qa_clients_in_billing_subscription_sync.sql");
const denyReadiness = read("supabase/migrations/225_publish_deny_qa_readiness_evidence.sql");
const ci = read(".github/workflows/ci-mega-extended.yml");

const startFunction = migration.slice(
  migration.indexOf("create or replace function public.start_disposable_business_qa_run"),
  migration.indexOf("create or replace function public.evaluate_qa_lifecycle_run")
);
const evaluator = migration.slice(
  migration.indexOf("create or replace function public.evaluate_qa_lifecycle_run"),
  migration.indexOf("create or replace function public.count_strict_clean_business_runs")
);

const checks = [
  ["Clients have an explicit permanent QA-only marker", migration.includes("add column if not exists qa_only boolean not null default false")],
  ["Previously known QA storefront is promoted to client-level QA isolation", migration.includes("from public.commerce_storefront_provisioning p") && migration.includes("p.qa_only=true")],
  ["QA clients are database-enforced as non-billable", migration.includes("enforce_qa_client_nonbillable") && migration.includes("QA-only clients are permanently non-billable")],
  ["Automatic billing subscription sync skips permanent QA clients", billingQaRepair.includes("create or replace function public.sync_client_billing_subscription") && billingQaRepair.includes("if coalesce(new.qa_only, false) then") && billingQaRepair.includes("return new;")],
  ["Strict DENY QA evidence reaches launch readiness", denyReadiness.includes("refresh_deny_flow_readiness_after_run") && denyReadiness.includes("derived_database_evidence_v2") && denyReadiness.includes("billing_artifacts_zero") && denyReadiness.includes("external_notifications_zero") && denyReadiness.includes("deny_flow_passed")],
  ["All billing artifact tables reject QA clients", ["payment_records", "billing_subscriptions", "billing_payment_attempts", "billing_notification_events", "billing_provider_events"].every((name) => migration.includes(`block_qa_${name}`))],
  ["External QA customer notifications are blocked", migration.includes("block_qa_external_notification") && migration.includes("new.channel <> 'in_app'")],
  ["Owner QA table access is read-only", migration.includes("create policy owner_read_qa_lifecycle_runs") && migration.includes("grant select on table public.qa_lifecycle_runs to authenticated") && !migration.includes("grant select,insert,update,delete on table public.qa_lifecycle_runs to authenticated")],
  ["Runner requires an authenticated owner", startFunction.includes("auth.role()<>'authenticated'") && startFunction.includes("from public.owner_users ou")],
  ["Service workers cannot make the human QA decision", startFunction.includes("from public,anon,authenticated,service_role") && startFunction.includes("to authenticated") && !startFunction.includes("to authenticated,service_role")],
  ["Runner accepts only APPROVE or DENY targets", startFunction.includes("outcome_value not in ('approve','deny')")],
  ["Concurrent starts are serialized and only one run may be active", startFunction.includes("pg_advisory_xact_lock") && startFunction.includes("A disposable Business QA run is already active")],
  ["Runner uses active Business Growth catalog records", startFunction.includes("pf.slug='business'") && startFunction.includes("pft.tier_key='growth'")],
  ["QA identity uses reserved fictional contact values", startFunction.includes("@example.invalid") && startFunction.includes("+1 202-555-0100")],
  ["Runner creates a non-billable QA client", startFunction.includes("monthly_price") && startFunction.includes("qa_only") && startFunction.includes("billing_allowed',false")],
  ["Runner creates the normal pending website setup decision", startFunction.includes("'website_setup_review'") && startFunction.includes("'medium','pending'")],
  ["Starting a run records zero provider infrastructure", startFunction.includes("'infrastructure_created',false") && !startFunction.includes("project_deployment_configs")],
  ["Normal APPROVE remains the owner-only pipeline authority", approval.includes("approve_website_setup") && approval.includes("Authenticated owner access required")],
  ["Normal DENY remains the hard-stop authority", denial.includes("enforce_website_setup_denial_stop") && denial.includes("status = 'cancelled'")],
  ["Strict evaluator accepts only monitored disposable v2 runs", evaluator.includes("run_row.monitor_version<>'disposable-business-v2'")],
  ["Strict evaluator ignores caller-supplied evidence", evaluator.includes("caller_evidence_ignored") && !evaluator.includes("run_row.evidence->>'preview_verified'")],
  ["Strict evaluator binds the exact client approval and project", evaluator.includes("approval_bound") && evaluator.includes("run_client_bound") && evaluator.includes("project_belongs_to_client")],
  ["Infrastructure worker verifies repository privacy from GitHub", infrastructureWorker.includes("verifyPrivateRepository") && infrastructureWorker.includes("body.private !== true") && infrastructureWorker.includes("github_repository_private_verified")],
  ["Strict evaluator requires runtime private-repository evidence", evaluator.includes("private_repo_verified:=exists") && evaluator.includes("j.result->>'github_full_name'=deployment_row.github_owner")],
  ["Preview proof comes from an automatic completed review step", evaluator.includes("automatic_preview_validation") && evaluator.includes("s.step_key='client_review'")],
  ["Production proof requires exact run deployment commit", evaluator.includes("website_run_commit=deployment_row.last_deployed_commit") && evaluator.includes("pd.git_commit_sha=website_run_commit")],
  ["Maintenance proof requires active exact-URL monitoring", evaluator.includes("mp.status='active'") && evaluator.includes("mp.monitored_url,'')=deployment_row.production_url")],
  ["Strict pass rejects duplicates any extra owner rescue and cross-client rows", evaluator.includes("duplicate_repo_count") && evaluator.includes("duplicate_site_count") && evaluator.includes("a.actor_type='owner'") && evaluator.includes("manual_rescue_used") && evaluator.includes("cross_client_data_detected")],
  ["Strict pass requires zero billing and external notification artifacts", evaluator.includes("billing_artifacts_zero") && evaluator.includes("external_notifications_zero")],
  ["DENY proof requires QA marker hard stop and zero infrastructure", evaluator.includes("denial_approval_bound") && evaluator.includes("client_row.pipeline_stopped_at is not null") && evaluator.includes("no_project_created") && evaluator.includes("no_deployment_created")],
  ["Ten-run count joins only QA-marked clients and v2 derived evidence", migration.includes("join public.clients c on c.id=q.client_id and c.qa_only=true") && migration.includes("derived_database_evidence_v2")],
  ["Automatic monitor waits for terminal real evidence", migration.includes("monitor_disposable_business_qa_runs") && migration.includes("last_deployment_status='published'") && migration.includes("wr.latest_commit_sha=d.last_deployed_commit")],
  ["Automatic monitor has timeout and hard-failure handling", migration.includes("run_row.deadline_at<=now()") && migration.includes("j.attempts>=j.max_attempts") && migration.includes("phase='monitor_error'")],
  ["QA monitor and strict counter are scheduled", migration.includes("qa-monitor-every-two-minutes") && migration.includes("strict-ten-run-readiness-every-five-minutes")],
  ["Legacy readiness cannot overwrite the strict gate", migration.includes("protect_strict_ten_run_readiness") && migration.includes("legacy_override_rejected")],
  ["Launch Readiness exposes guarded APPROVE and DENY QA controls", ui.includes("Start APPROVE-path QA") && ui.includes("Start DENY-path QA") && ui.includes("start_disposable_business_qa_run")],
  ["UI warns about provider effects before APPROVE QA", ui.includes("No GitHub or Netlify infrastructure is created until") && ui.includes("Billing and external customer notifications are database-blocked")],
  ["Owner Portal disables manual mutation controls for QA clients", ownerPortal.includes("qa_only") && ownerPortal.includes("Manual client, project, and billing controls are disabled")],
  ["Extended CI enforces Wave 21", ci.includes("validate-autonomy-ops-wave21-contract.mjs")],
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
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-one checks passed.`);
if (passed !== checks.length) process.exit(1);
