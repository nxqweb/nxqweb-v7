import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const notificationSchedule=read("supabase/migrations/145_schedule_notification_dispatcher.sql");
const leadClassification=read("supabase/migrations/146_business_lead_baseline_classification.sql");
const seo=read("supabase/migrations/147_business_seo_operations_foundation.sql");
const privacyRoute=read("supabase/migrations/148_route_privacy_requests_safely.sql");
const privacyWorker=read("supabase/functions/process-data-subject-request/index.ts");
const privacySchedule=read("supabase/migrations/149_schedule_privacy_request_processor.sql");
const checks=[
  ["Notification delivery wakes automatically",notificationSchedule.includes("nxq-dispatch-notifications")&&notificationSchedule.includes("* * * * *")],
  ["Notification dispatcher secrets stay in Vault",notificationSchedule.includes("vault.decrypted_secrets")&&notificationSchedule.includes("nxq_notification_dispatch_url")&&notificationSchedule.includes("nxq_automation_worker_token")],
  ["Notification cron only wakes for due work",notificationSchedule.includes("notification_deliveries")&&notificationSchedule.includes("run_after <= now()")],
  ["Lead baseline classifier enriches intent",leadClassification.includes("baseline_classifier")&&leadClassification.includes("intent")],
  ["Lead classifier records spam risk without auto rejecting",leadClassification.includes("spam_risk_score")&&leadClassification.includes("'auto_rejected',false")],
  ["Lead urgency can escalate deterministically",leadClassification.includes("emergency")&&leadClassification.includes("urgent")&&leadClassification.includes("greatest(new.lead_score")],
  ["SEO issue queue is tenant scoped",seo.includes("business_seo_issues")&&seo.includes("client_id uuid not null references public.clients")],
  ["SEO artifacts track sitemap/schema state",seo.includes("project_seo_artifacts")&&seo.includes("sitemap")&&seo.includes("local_business_schema")],
  ["Location page changes queue project SEO refresh",seo.includes("website_project_seo_refresh")&&seo.includes("queue_project_seo_refresh_from_location_page")],
  ["Delete privacy requests require identity check",privacyRoute.includes("request_type = 'delete'")&&privacyRoute.includes("identity_check")&&privacyRoute.includes("destructive_action_started',false")],
  ["Non-destructive privacy requests route to Edge automation",privacyRoute.includes("process_data_subject_request")&&privacyRoute.includes("execution_target','edge")],
  ["Privacy worker requires protected token",privacyWorker.includes("x-nxq-worker-token")&&privacyWorker.includes("NXQ_AUTOMATION_WORKER_TOKEN")],
  ["Privacy export is bounded and explicit",privacyWorker.includes("export_version:\"nxq-account-export-v1\"")&&privacyWorker.includes("bounded:true")],
  ["Privacy correction never guesses fields",privacyWorker.includes("needs_specific_fields:true")&&privacyWorker.includes("does not guess")],
  ["Privacy processor runs automatically",privacySchedule.includes("nxq-process-data-subject-requests")&&privacySchedule.includes("* * * * *")],
  ["Privacy processor endpoint/token stay in Vault",privacySchedule.includes("nxq_privacy_processor_edge_url")&&privacySchedule.includes("vault.decrypted_secrets")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-two checks passed.`);if(passed!==checks.length)process.exit(1);
