import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const summary=read("supabase/migrations/179_owner_qa_lifecycle_control_surface.sql");
const page=read("src/pages/OwnerQaLifecycle.tsx");
const app=read("src/App.tsx");
const checks=[
["Owner QA summary is owner gated",summary.includes("Owner access required")&&summary.includes("owner_users")],
["Owner QA summary uses strict consecutive count",summary.includes("count_strict_clean_business_runs")&&summary.includes("strict_consecutive_business_runs")],
["Owner QA history is bounded before aggregation",summary.includes("limit 100")&&summary.includes("from (\n    select r.*,c.business_name")],
["Owner QA candidates require NXQ QA naming",summary.includes("^NXQ[[:space:]]+QA")],
["Owner QA summary exposes no pass or auto approval controls",summary.includes("auto_approval_available',false")&&summary.includes("manual_mark_passed_available',false")],
["Owner QA summary promises no automatic external cleanup",summary.includes("automatic_external_cleanup',false")],
["Owner QA page reads narrow server RPC",page.includes('rpc("owner_qa_lifecycle_summary")')],
["Owner QA page registers through guarded RPC",page.includes('rpc("owner_register_disposable_qa_client"')],
["Owner QA page exposes only E2E and DENY test kinds",page.includes('value="business_e2e"')&&page.includes('value="deny_path"')],
["Owner QA page explains normal approve or deny decision",page.includes("normal APPROVE or DENY decision")],
["Owner QA page does not mark runs passed",!page.includes("mark passed")&&!page.includes("status:'passed'")&&!page.includes('status:"passed"')],
["Owner QA page displays strict evidence",page.includes("Strict evidence")&&page.includes("JSON.stringify(run.evidence")],
["Owner QA route is lazy loaded",app.includes('import("./pages/OwnerQaLifecycle")')],
["Owner QA route is owner protected",app.includes('path === "/owner/qa-lifecycle"')&&app.includes("<OwnerProtectedRoute><OwnerQaLifecycle /></OwnerProtectedRoute>")],
["Owner portal exposes autonomous QA shortcut",app.includes('href="/owner/qa-lifecycle"')&&app.includes("Autonomous QA")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-nineteen checks passed.`);if(passed!==checks.length)process.exit(1);
