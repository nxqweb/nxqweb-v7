import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const worker=read("supabase/functions/apply-business-change-request/index.ts");
const atomic=read("supabase/migrations/212_idempotent_atomic_website_changes.sql");
const sync=read("supabase/migrations/162_sync_change_requests_with_website_runs.sql");
const submit=read("supabase/migrations/163_remove_duplicate_change_request_classification_queue.sql");
const routing=read("supabase/migrations/137_autonomous_change_request_routing.sql");

const checks=[
  ["Low-risk change path requires original owner approval in atomic authority",atomic.includes("website_setup_review")&&atomic.includes("Original owner approval is required")&&worker.includes("apply_structured_website_change_atomic")],
  ["Atomic change path serializes and replay-protects project mutations",atomic.includes("pg_advisory_xact_lock")&&atomic.includes("already_applied")&&atomic.includes("autonomous_safe_change")],
  ["Change worker refuses success without active website automation run",worker.includes("Website rebuild bootstrap did not produce an active automation run")&&worker.includes("website_automation_runs")],
  ["Change request stores exact website automation run id",worker.includes("website_automation_run_id: runRes.data.id")&&worker.includes("source_branch: runRes.data.source_branch")],
  ["Run-to-request sync handles preview published and failure",sync.includes("when 'preview_ready' then 'preview_ready'")&&sync.includes("when 'published' then 'published'")&&sync.includes("when 'failed' then 'failed'")],
  ["Run-to-request sync is scoped to exact bound run",sync.includes("r.automation_plan->>'website_automation_run_id'=new.id::text")&&sync.includes("r.client_id=new.client_id")&&sync.includes("r.project_id=new.project_id")],
  ["Published requests cannot regress",sync.includes("r.status not in ('published','cancelled')")],
  ["Submission RPC no longer enqueues automation directly",!submit.includes("enqueue_automation_job")],
  ["Trigger routing remains the single queue authority",submit.includes("route_submitted_change_request")&&routing.includes("website_apply_change_request")&&routing.includes("classify_website_change_request")],
  ["Low-risk requests route to Edge while higher risk routes to AI",routing.includes("if new.risk_level='low'")&&routing.includes("'execution_target','edge'")&&routing.includes("'execution_target','ai'")],
  ["Client ownership and project pairing remain enforced",submit.includes("p.id=target_project_id and p.client_id=client_uuid")&&submit.includes("auth_user_id=auth.uid()")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-eleven checks passed.`);if(passed!==checks.length)process.exit(1);
