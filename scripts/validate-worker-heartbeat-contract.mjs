import fs from "node:fs";

const source = fs.readFileSync("supabase/migrations/143_shared_worker_heartbeat_instrumentation.sql", "utf8");
const foundation = fs.readFileSync("supabase/migrations/134_provider_observability_and_recovery_foundation.sql", "utf8");

const checks = [
  ["Heartbeat table exists", foundation.includes("automation_worker_heartbeats")],
  ["Shared external claim records heartbeat", source.includes("claim_next_external_automation_job") && source.includes("record_worker_heartbeat")],
  ["External claim heartbeat uses actual worker name", source.includes("worker_name,") && source.includes("target_execution_target")],
  ["No-job worker polls still register presence before claim", source.indexOf("record_worker_heartbeat") < source.indexOf("select j.* into job_row")],
  ["Maintenance claim records heartbeat", source.includes("claim_next_website_maintenance_task") && source.includes("maintenance_claim_invoked_at")],
  ["Maintenance heartbeat uses Edge execution lane", source.includes("'edge',\n    'healthy'")],
  ["Backend presence hook exists", source.includes("record_backend_worker_presence")],
  ["Heartbeat mutation remains service-role only", source.includes("grant execute on function public.record_backend_worker_presence(text) to service_role")],
  ["Existing external job row locking remains", source.includes("for update of j skip locked")],
  ["Existing maintenance row locking remains", source.includes("for update skip locked")],
  ["Automation pause checks remain in external claim", source.includes("controls.automation_enabled") && source.includes("controls.automation_paused")],
  ["Maintenance pause checks remain", source.includes("p.status = 'active'") && source.includes("controls.automation_paused")],
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
console.log(`\n${passed}/${checks.length} worker heartbeat checks passed.`);
if (passed !== checks.length) process.exit(1);
