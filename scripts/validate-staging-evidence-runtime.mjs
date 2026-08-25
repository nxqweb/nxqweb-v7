import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const worker = read("supabase/functions/run-staging-evidence-suite/index.ts");
const workflow = read(".github/workflows/manual-supabase-stage.yml");
const manifest = read("scripts/edge-function-manifest.mjs");
const config = read("supabase/config.toml");

const checks = [
  ["runner fails closed outside staging", worker.includes('NXQ_RUNTIME_ENVIRONMENT') && worker.includes('Staging evidence suite refused outside staging')],
  ["runner uses two ephemeral auth tenants", worker.includes("admin.auth.admin.createUser") && worker.includes("clientIds.length !== 2")],
  ["QA isolation is owned by clients, not projects", worker.includes("qa_only: true") && !/from\("projects"\)\.insert[\s\S]{0,500}qa_only:\s*true/.test(worker)],
  ["RLS cross-tenant read and write probes", worker.includes("tenant_a_sees_only_own_client") && worker.includes("tenant_a_cannot_update_tenant_b")],
  ["RLS policy denial counts as a successful write probe", worker.includes('crossUpdate.error?.code === "42501"') && worker.includes("expectedCrossTenantDenial || (crossUpdate.data || []).length === 0")],
  ["storage metadata and signed-access probes", worker.includes("tenant_a_sees_only_own_file_metadata") && worker.includes("tenant_a_is_denied_tenant_b_file")],
  ["non-destructive restore simulation", worker.includes("create_verified_project_restore_point") && worker.includes("simulate_project_restore")],
  ["records expiring server-authoritative evidence", worker.includes("record_staging_readiness_evidence") && worker.includes("target_expires_at")],
  ["fixtures removed on success and failure", (worker.match(/removeFixtures\(/g) || []).length >= 3],
  ["no Netlify or GitHub provider calls", !worker.includes("api.netlify.com") && !worker.includes("api.github.com") && worker.includes("netlify_calls: 0")],
  ["manual workflow exposes explicit evidence action", workflow.includes("- run_evidence_suite") && workflow.includes("inputs.action == 'run_evidence_suite'")],
  ["manual workflow requires mutation confirmation", workflow.includes("Require explicit mutation confirmation") && workflow.includes("APPLY-NXQ-SUPABASE-STAGING")],
  ["manual workflow asserts safety response", workflow.includes("r.netlify_calls!==0") && workflow.includes("r.production_changed!==false") && workflow.includes("r.fixtures_removed!==true")],
  ["manifest declares worker-token boundary", manifest.includes('entry("run-staging-evidence-suite", false, "worker-token")')],
  ["Supabase config disables gateway JWT for independent worker token", config.includes("[functions.run-staging-evidence-suite]\nverify_jwt = false")],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} staging evidence runtime checks passed.`);
if (failed) process.exit(1);
