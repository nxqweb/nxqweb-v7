import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const qa=read("supabase/migrations/178_autonomous_consecutive_qa_orchestrator.sql");
const strict=read("supabase/migrations/168_strict_qa_lifecycle_evidence.sql");
const gate=read("supabase/migrations/170_strict_ten_run_launch_gate.sql");
const checks=[
["Owner QA registration is owner gated",qa.includes("Owner access required")&&qa.includes("owner_users")],
["Only NXQ QA named clients can be registered",qa.includes("beginning with NXQ QA")&&qa.includes("!~* '^NXQ[[:space:]]+QA'")],
["QA registration never auto approves",qa.includes("qa_auto_approval_used',false")&&qa.includes("auto_approval',false")],
["Only one active QA run per client is allowed",qa.includes("qa_one_active_run_per_client_idx")&&qa.includes("where status='running'")],
["QA run has bounded deadline",qa.includes("now()+interval '6 hours'")&&qa.includes("deadline_at")],
["QA monitor is service-role only",qa.includes("Service-role access required")&&qa.includes("grant execute on function public.refresh_active_qa_lifecycle_runs() to service_role")],
["QA monitor gathers preview evidence",qa.includes("step_key='client_review'")&&qa.includes("preview_verified")],
["QA monitor gathers exact production evidence",qa.includes("last_deployment_status='published'")&&qa.includes("last_deployed_commit")],
["QA monitor verifies maintenance started",qa.includes("website_maintenance_plans")&&qa.includes("maintenance_started")],
["Owner exception retry counts as manual rescue",qa.includes("owner_exception_retry_requested")&&qa.includes("manual_rescue_used")],
["Cross-client project or deployment mismatch is detected",qa.includes("cross_client_data_detected")&&qa.includes("d.client_id<>run_row.client_id")],
["DENY path delegates to strict no-infrastructure evaluator",qa.includes("run_row.test_kind='deny_path'")&&qa.includes("evaluate_qa_lifecycle_run")&&strict.includes("no_project_created")&&strict.includes("no_deployment_created")],
["Timed out QA fails honestly",qa.includes("timed out before verified production and maintenance")],
["QA monitor runs every minute",qa.includes("nxq-active-qa-monitor-every-minute")&&qa.includes("'* * * * *'")],
["Latest sequence failure resets consecutive count",qa.includes("first_nonpass")&&qa.includes("sequence_number>coalesce(first_nonpass,0)")],
["Only current monitor contract version counts",qa.includes("monitor_version='business-autonomy-v1'")],
["Strict launch gate still requires ten",gate.includes("strict_count>=10")&&gate.includes("required',10")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-eighteen checks passed.`);if(passed!==checks.length)process.exit(1);
