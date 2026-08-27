import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const worker = read("supabase/functions/run-staging-evidence-suite/index.ts");
const workflow = read(".github/workflows/manual-supabase-stage.yml");
const manifest = read("scripts/edge-function-manifest.mjs");
const config = read("supabase/config.toml");
const clientFilesBucket = read("supabase/migrations/235_create_private_client_files_bucket.sql");
const extension = read("supabase/migrations/237_extend_zero_netlify_readiness_evidence.sql");
const deploymentFoundation = read("supabase/migrations/018_ai_build_deployment_foundation.sql");
const recoveryFoundation = read("supabase/migrations/134_provider_observability_and_recovery_foundation.sql");
const domainWorker = read("supabase/functions/reconcile-domain/index.ts");
const maintenanceWorker = read("supabase/functions/run-website-maintenance/index.ts");
const seoWorker = read("supabase/functions/build-business-seo-artifacts/index.ts");

const checks = [
  ["runner fails closed outside staging", worker.includes('NXQ_RUNTIME_ENVIRONMENT') && worker.includes('Staging evidence suite refused outside staging')],
  ["runner uses two ephemeral auth tenants", worker.includes("admin.auth.admin.createUser") && worker.includes("clientIds.length !== 2")],
  ["QA isolation is owned by clients, not projects", worker.includes("qa_only: true") && !/from\("projects"\)\.insert[\s\S]{0,500}qa_only:\s*true/.test(worker)],
  ["RLS cross-tenant read and write probes", worker.includes("tenant_a_sees_only_own_client") && worker.includes("tenant_a_cannot_update_tenant_b")],
  ["RLS policy denial counts as a successful write probe", worker.includes('crossUpdate.error?.code === "42501"') && /expectedCrossTenantDenial\s*\|\|\s*\(crossUpdate\.data\s*\|\|\s*\[\]\)\.length\s*===\s*0/.test(worker)],
  ["storage metadata and signed-access probes", worker.includes("tenant_a_sees_only_own_file_metadata") && worker.includes("tenant_a_is_denied_tenant_b_file")],
  ["canonical private client-files bucket is migration-managed", clientFilesBucket.includes("insert into storage.buckets") && clientFilesBucket.includes("'client-files'") && clientFilesBucket.includes("public = false") && clientFilesBucket.includes("26214400")],
  ["restore simulation uses its own ephemeral QA project", worker.includes("const restoreFixture = projectRows[0]") && worker.includes('github_owner: "nxq-staging-evidence"') && !worker.includes("Find restore fixture")],
  ["restore fixture cannot resolve or auto-publish", worker.includes(".example.invalid") && worker.includes("auto_publish_locked: true") && worker.includes('production_branch: "staging-evidence"')],
  ["non-destructive restore simulation is asserted", worker.includes("create_verified_project_restore_point") && worker.includes("simulate_project_restore") && worker.includes("restoreResult?.checks?.non_destructive !== true")],
  ["restore artifacts cascade with QA fixture cleanup", deploymentFoundation.includes("project_id uuid not null unique references public.projects(id) on delete cascade") && recoveryFoundation.includes("project_id uuid not null references public.projects(id) on delete cascade") && recoveryFoundation.includes("project_id uuid references public.projects(id) on delete cascade")],
  ["records expiring server-authoritative evidence", worker.includes("record_staging_readiness_evidence") && worker.includes("target_expires_at")],
  ["fixtures removed on success and failure", (worker.match(/removeFixtures\(/g) || []).length >= 3],
  ["zero Netlify provider calls", !worker.includes("api.netlify.com") && worker.includes("netlify_calls: 0")],
  ["template proof uses GitHub read-only access", worker.includes('permissions: { contents: "read", metadata: "read" }') && worker.includes('github_access: "read_only"') && !worker.includes('method: "PUT"') && !worker.includes('method: "PATCH"') && !worker.includes('method: "DELETE"')],
  ["required Edge coverage uses non-mutating GET probes", worker.includes('probe_method: "non_mutating_get"') && worker.includes('res.status === 405') && worker.includes('"provision-project-infrastructure"') && worker.includes('"promote-business-production"')],
  ["domain probe is staging-only and zero-Netlify", domainWorker.includes("Domain readiness probes are staging-only") && domainWorker.includes("readiness_probe") && domainWorker.includes("netlify_calls: 0")],
  ["maintenance probe is staging-only and does not claim tasks", maintenanceWorker.indexOf("requestBody.readiness_probe") < maintenanceWorker.indexOf('claim_next_website_maintenance_task') && maintenanceWorker.includes("netlify_calls: 0")],
  ["SEO probe refreshes heartbeat without claiming a job", seoWorker.indexOf("requestBody.readiness_probe") < seoWorker.indexOf('claim_next_external_automation_job') && /job_claimed:\s*false/.test(seoWorker) && /netlify_calls:\s*0/.test(seoWorker)],
  ["evidence gate accepts and expires worker coverage", extension.includes("'workers_deployed'") && extension.includes("nxq-staging-evidence-gate-v2") && extension.includes("expires_at>now()")],
  ["evidence gate requires explicit zero-Netlify proof", extension.includes("target_details->>'netlify_calls'") && extension.includes("production and Netlify were untouched")],
  ["returned readiness includes the final staging evidence refresh", worker.indexOf('admin.rpc("evaluate_staging_readiness_evidence")') < worker.indexOf('admin.rpc("evaluate_launch_readiness")')],
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
