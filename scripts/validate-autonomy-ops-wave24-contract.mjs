import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const migration = read("supabase/migrations/184_owner_deployment_authority_boundaries.sql");
const deployments = read("src/pages/OwnerDeployments.tsx");
const previews = read("src/pages/OwnerPreviewRequests.tsx");
const launches = read("src/pages/OwnerProductionLaunches.tsx");
const verifier = read("supabase/functions/verify-deployment-connection/index.ts");
const ci = read(".github/workflows/ci-mega-extended.yml");

const directMutation = (source, table) => new RegExp(
  `\\.from\\(\\s*["']${table}["']\\s*\\)[\\s\\S]{0,220}?\\.(?:insert|update|delete|upsert)\\(`
).test(source);

const functionSlice = (start, end) => migration.slice(
  migration.indexOf(start),
  end ? migration.indexOf(end) : migration.length
);
const save = functionSlice("create or replace function public.owner_save_deployment_connection", "create or replace function public.owner_create_preview_request");
const createPreview = functionSlice("create or replace function public.owner_create_preview_request", "create or replace function public.owner_decide_preview_request");
const decidePreview = functionSlice("create or replace function public.owner_decide_preview_request", "create or replace function public.owner_create_production_launch_request");
const createLaunch = functionSlice("create or replace function public.owner_create_production_launch_request", "create or replace function public.owner_decide_production_launch");
const decideLaunch = functionSlice("create or replace function public.owner_decide_production_launch", "revoke insert,update,delete");

const checks = [
  ["Deployment page uses the typed save RPC", deployments.includes('rpc("owner_save_deployment_connection"')],
  ["Deployment page cannot directly mutate connection rows", !directMutation(deployments, "project_deployment_configs")],
  ["Preview page uses typed create and decision RPCs", previews.includes('rpc("owner_create_preview_request"') && previews.includes('rpc("owner_decide_preview_request"')],
  ["Preview page cannot directly mutate request rows", !directMutation(previews, "preview_deployment_requests")],
  ["Launch page uses typed create and decision RPCs", launches.includes('rpc("owner_create_production_launch_request"') && launches.includes('rpc("owner_decide_production_launch"')],
  ["Launch page cannot directly mutate request rows", !directMutation(launches, "production_launch_requests")],
  ["All four lifecycle tables revoke browser mutation", ["project_deployment_configs","project_deployments","preview_deployment_requests","production_launch_requests"].every((table) => migration.includes(`revoke insert,update,delete on public.${table} from authenticated`))],
  ["Every mutation boundary is owner authenticated", [save,createPreview,decidePreview,createLaunch,decideLaunch].every((body) => body.includes("Authenticated owner access required"))],
  ["Deployment identity is derived from the locked project", save.includes("where id=target_project_id for update") && save.includes("project_row.client_id")],
  ["Auto-publish cannot be unlocked by portal RPC", save.includes("target_auto_publish_locked is not true") && save.includes("auto_publish_locked=true")],
  ["Connection changes invalidate old verification", save.includes("last_verification_status='not_checked'") && save.includes("last_verification_details=null")],
  ["Provider-facing identifiers are strictly validated", save.includes("GitHub repository identity contains unsupported characters") && save.includes("Netlify site id contains unsupported characters") && save.includes("Production URL must be a valid HTTPS URL")],
  ["Preview tenant identity comes only from its config", createPreview.includes("config_row.project_id,config_row.client_id") && !createPreview.includes("target_client_id")],
  ["Preview blocks production branches and invalid SHAs", createPreview.includes("lower(config_row.production_branch)") && createPreview.includes("40-character SHA")],
  ["Preview decisions are pending-only and row locked", decidePreview.includes("for update") && decidePreview.includes("Only a pending preview request can be decided")],
  ["Launch request requires a published HTTPS preview", createLaunch.includes("execution_status<>'published'") && createLaunch.includes("verified published HTTPS preview")],
  ["Launch tenant identity comes only from the preview/config", createLaunch.includes("preview_row.project_id,preview_row.client_id") && !createLaunch.includes("target_client_id")],
  ["Production approval requires a passing audit", decideLaunch.includes("audit_status<>'passed'") && decideLaunch.includes("passing launch audit")],
  ["Production rejection cannot rewrite terminal launches", decideLaunch.includes("no longer eligible for rejection")],
  ["Manual deployment controls exclude QA and stopped clients", [save,createPreview,decidePreview,createLaunch,decideLaunch].every((body) => body.includes("qa_only") || body.includes("pipeline_stopped_at"))],
  ["Every action records server-side audit evidence", (migration.match(/insert into public\.automation_audit_log/g) || []).length === 5 && migration.includes("server_authoritative',true")],
  ["Verifier authenticates an owner server-side", verifier.includes("owner_users") && verifier.includes("Owner access required") && verifier.includes("getUser")],
  ["Verifier persists read-only provider evidence", verifier.includes("last_verification_status") && verifier.includes("last_verification_details") && verifier.includes("NXQ_GITHUB_VERIFY_TOKEN") && verifier.includes("NXQ_NETLIFY_VERIFY_TOKEN")],
  ["Verifier blocks SSRF-shaped production URLs", verifier.includes("validatedPublicHttpsUrl") && verifier.includes("redirect: \"error\"") && verifier.includes("ipv4Literal") && verifier.includes("blockedSuffixes")],
  ["Verifier bounds every provider request", (verifier.match(/timedFetch\(/g) || []).length >= 6],
  ["Extended CI enforces Wave 24", ci.includes("validate-autonomy-ops-wave24-contract.mjs")],
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
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-four checks passed.`);
if (passed !== checks.length) process.exit(1);
