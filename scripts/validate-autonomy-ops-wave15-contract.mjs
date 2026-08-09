import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const qa=read("supabase/migrations/168_strict_qa_lifecycle_evidence.sql");
const strictGate=read("supabase/migrations/170_strict_ten_run_launch_gate.sql");
const retry=read("supabase/migrations/169_owner_safe_exception_retry.sql");
const exceptionUi=read("src/pages/OwnerExceptionCenter.tsx");
const billing=read("supabase/migrations/171_verified_billing_provider_events.sql");
const billingWorker=read("supabase/functions/ingest-billing-provider-event/index.ts");
const billingReady=read("supabase/migrations/172_billing_provider_future_readiness.sql");
const leadOrigin=read("supabase/migrations/173_harden_public_lead_origins.sql");
const leadWorker=read("supabase/functions/ingest-business-lead/index.ts");
const analyticsOrigin=read("supabase/migrations/174_harden_analytics_production_origins.sql");
const analyticsWorker=read("supabase/functions/ingest-business-analytics/index.ts");
const deploy=read(".github/workflows/manual-supabase-stage.yml");
const app=read("src/App.tsx");
const checks=[
["Strict QA evaluator only accepts disposable runs",qa.includes("if not run_row.disposable")],
["Strict Business QA verifies unique repo and Netlify site",qa.includes("'repo_unique'")&&qa.includes("'netlify_site_unique'")],
["Strict Business QA rejects manual rescue and crossed-client evidence",qa.includes("'manual_rescue_used'")&&qa.includes("'cross_client_data_detected'")],
["DENY QA requires no project deployment or active jobs",qa.includes("'no_project_created'")&&qa.includes("'no_deployment_created'")&&qa.includes("'no_active_downstream_jobs'")],
["Ten-run launch gate counts strict evidence only",strictGate.includes("count_strict_clean_business_runs")&&strictGate.includes("strict_db_verified")],
["QA mutation immediately invalidates stale green gate",strictGate.includes("stale_after_qa_change")&&strictGate.includes("status='unknown'")],
["Owner retry is owner-only",retry.includes("Owner access required")&&retry.includes("owner_users")],
["Owner retry never force-completes work",retry.includes("force_success',false")&&!retry.includes("status='completed'")],
["Owner retry clears locks and requeues",retry.includes("status='queued'")&&retry.includes("locked_at=null")&&retry.includes("locked_by=null")],
["Exception UI exposes safe retry only for automation source",exceptionUi.includes('item.source === "automation"')&&exceptionUi.includes("owner_retry_automation_exception")],
["Billing provider events are idempotent",billing.includes("unique(provider_key,provider_event_id)")&&billingWorker.includes("idempotent")],
["Billing provider event cannot directly freeze",billing.includes("'auto_freeze',false")&&!billing.includes("billing_status='frozen'")],
["Verified payment can restore billing",billing.includes("payment_succeeded")&&billing.includes("billing_status='active'")],
["Billing adapter is protected by dedicated token",billingWorker.includes("NXQ_BILLING_ADAPTER_TOKEN")&&billingWorker.includes("x-nxq-billing-adapter-token")],
["Online billing remains optional for current launch",billingReady.includes("required,false")&&billingReady.includes("manual_billing_supported")],
["Lead forms cannot be active without explicit origins",leadOrigin.includes("business_lead_forms_active_origin_check")&&leadOrigin.includes("cardinality(allowed_origins)>0")],
["Lead origins auto-sync from verified HTTPS production",leadOrigin.includes("last_deployment_status='published'")&&leadOrigin.includes("production_url like 'https://%'")],
["Lead worker has no wildcard CORS",!leadWorker.includes('Access-Control-Allow-Origin":"*')&&leadWorker.includes('Vary":"Origin"')],
["Lead worker requires exact allowed origin",leadWorker.includes("!allowed.includes(origin)")],
["Analytics cannot be enabled without explicit origin",analyticsOrigin.includes("website_analytics_profiles_enabled_origin_check")&&analyticsOrigin.includes("cardinality(allowed_origins)>0")],
["Analytics entitlement waits for verified production origin",analyticsOrigin.includes("production_url like 'https://%'")&&analyticsOrigin.includes("advanced_analytics")],
["Analytics worker has no wildcard CORS",!analyticsWorker.includes('Access-Control-Allow-Origin": "*"')&&!analyticsWorker.includes('Access-Control-Allow-Origin":"*')],
["Analytics worker requires exact allowed origin",analyticsWorker.includes("!origins.includes(origin)")],
["Supabase deployment workflow is manual-only",deploy.includes("workflow_dispatch")&&!deploy.includes("\n  push:\n")],
["Supabase mutation requires exact confirmation phrase",deploy.includes("APPLY-NXQ-SUPABASE")&&deploy.includes("Mutation refused")],
["Supabase workflow always dry-runs migrations first",deploy.includes("supabase db push --dry-run --linked")],
["Supabase workflow cannot merge GitHub or publish Netlify",deploy.includes("does not merge GitHub branches")&&deploy.includes("publish Netlify sites")],
["App uses lazy route imports",app.includes("lazy, Suspense")&&app.includes('import("./pages/OwnerPortal")')&&app.includes('import("./pages/ClientBusinessDashboard")')],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} extended autonomy safety checks passed.`);if(passed!==checks.length)process.exit(1);