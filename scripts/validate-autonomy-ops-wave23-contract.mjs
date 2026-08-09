import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8");
const initial = read("supabase/migrations/001_nxqweb_v7_initial_schema.sql");
const legacyReset = read("supabase/migrations/006_reset_client_workspace.sql");
const migration = read("supabase/migrations/183_owner_decision_authority_and_domain_capture.sql");
const ownerPortal = read("src/pages/OwnerPortal.tsx");
const clientPortal = read("src/pages/ClientPortal.tsx");
const ci = read(".github/workflows/ci-mega-extended.yml");
const setupFunction = migration.slice(
  migration.indexOf("create or replace function public.submit_current_client_website_setup"),
  migration.indexOf("create or replace function public.deny_website_setup")
);
const denyFunction = migration.slice(
  migration.indexOf("create or replace function public.deny_website_setup"),
  migration.indexOf("create or replace function public.resolve_owner_approval_decision")
);
const genericFunction = migration.slice(
  migration.indexOf("create or replace function public.resolve_owner_approval_decision"),
  migration.indexOf("create or replace function public.resolve_domain_connection_review")
);
const domainFunction = migration.slice(
  migration.indexOf("create or replace function public.resolve_domain_connection_review")
);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (sourceExtensions.has(path.extname(file))) sourceFiles.push(file);
  }
}
walk("src");
walk("supabase/functions");

const sourceTables = new Set();
const tablePattern = /(?:supabase|admin)\.from\(\s*["']([^"']+)["']\s*\)/g;
for (const file of sourceFiles) {
  for (const match of read(file).matchAll(tablePattern)) sourceTables.add(match[1]);
}

const migrationSource = fs.readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .map((file) => read(path.join("supabase/migrations", file)))
  .join("\n");
const missingTables = [...sourceTables].filter((table) => {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(
    `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${escaped}\\b`,
    "i"
  ).test(migrationSource);
});

const directApprovalMutation = /\.from\(\s*["']owner_approval_requests["']\s*\)[\s\S]{0,160}?\.(?:insert|update|delete|upsert)\(/;
const directClientMutation = /\.from\(\s*["']clients["']\s*\)[\s\S]{0,160}?\.(?:insert|update|delete|upsert)\(/;
const directAuditMutation = /\.from\(\s*["']activity_logs["']\s*\)[\s\S]{0,160}?\.(?:insert|update|delete|upsert)\(/;

const checks = [
  ["Every Supabase source table has a captured migration", missingTables.length === 0],
  ["Fresh schema captures client_domains before domain automation", initial.includes("create table if not exists public.client_domains") && initial.indexOf("create table if not exists public.client_domains") < initial.indexOf("create table if not exists public.owner_approval_requests")],
  ["Forward migration captures missing client_domains", migration.includes("create table if not exists public.client_domains")],
  ["Client domain ownership remains server-mutated", migration.includes("revoke insert,update,delete on public.client_domains from authenticated") && migration.includes("grant select on public.client_domains to authenticated")],
  ["Clients can read only their own domains", initial.includes('create policy "Clients can read own domains"') && initial.includes("clients.auth_user_id = auth.uid()")],
  ["Owner Portal no longer reads obsolete AI output storage", !ownerPortal.includes('from("ai_task_outputs")') && !ownerPortal.includes("AiTaskOutputRow")],
  ["Legacy reset no longer depends on obsolete AI output storage", !legacyReset.includes("ai_task_outputs") && legacyReset.includes("from public,anon,authenticated,service_role")],
  ["Unused destructive workspace reset remains disabled", migration.includes("revoke all on function public.reset_client_workspace(uuid)")],
  ["Owner Portal reads canonical project build plans", ownerPortal.includes('.select("id, client_id, website_status, build_plan")') && ownerPortal.includes("Canonical plan:")],
  ["Owner Portal does not directly mutate approval rows", !directApprovalMutation.test(ownerPortal)],
  ["Owner Portal does not directly mutate client lifecycle rows", !directClientMutation.test(ownerPortal)],
  ["Owner Portal does not fabricate decision audit rows", !directAuditMutation.test(ownerPortal)],
  ["Client Portal cannot directly mutate its lifecycle row", !directClientMutation.test(clientPortal) && migration.includes("revoke insert,update,delete on public.clients from anon,authenticated")],
  ["Client Portal cannot fabricate approval decisions", !directApprovalMutation.test(clientPortal) && migration.includes("revoke insert,update,delete on public.owner_approval_requests from anon,authenticated")],
  ["Both client setup paths use one atomic RPC", clientPortal.match(/rpc\("submit_current_client_website_setup"/g)?.length === 2 && setupFunction.includes("insert into public.owner_approval_requests")],
  ["Setup pricing comes from the active Business catalog", setupFunction.includes("from public.product_family_tiers tier") && setupFunction.includes("tier.monthly_price is not null") && setupFunction.includes("monthly_price=tier_row.monthly_price")],
  ["Setup cannot bypass client lifecycle or QA isolation", setupFunction.includes("Disposable QA clients cannot submit portal setup") && setupFunction.includes("pipeline_stopped_at is not null") && setupFunction.includes("not in ('lead','intake_received','needs_owner_review')")],
  ["Setup creates at most one pending owner review", setupFunction.includes("A website setup review is already pending") && setupFunction.includes("status::text='pending'")],
  ["Targeted responses match the latest exact request", setupFunction.includes("array_upper(request_sections,1)") && setupFunction.includes("Field key: '") && setupFunction.includes("Field label: '") && setupFunction.includes("Requested info: '")],
  ["Targeted responses preserve signed agreement evidence", clientPortal.includes("Agreement evidence: Preserved from the original signed setup report") && setupFunction.includes("The original signed setup report could not be verified")],
  ["Website setup denial uses its typed RPC", ownerPortal.includes('rpc("deny_website_setup"') && denyFunction.includes("Authenticated owner access required")],
  ["Website denial locks the approval and client", denyFunction.includes("for update") && denyFunction.includes("from public.clients where id=request_row.client_id for update")],
  ["Website denial accepts only pending setup reviews", denyFunction.includes("request_type<>'website_setup_review'") && denyFunction.includes("status::text<>'pending'")],
  ["Website denial must prove the deterministic hard stop", denyFunction.includes("pipeline_stopped_at is null") && denyFunction.includes("Website setup denial did not produce the required client hard stop")],
  ["Website denial reports zero direct infrastructure creation", denyFunction.includes("'infrastructure_created',false")],
  ["Generic owner decisions use a typed RPC", ownerPortal.includes('rpc("resolve_owner_approval_decision"') && genericFunction.includes("Authenticated owner access required")],
  ["Generic decisions are restricted to Commerce intake", genericFunction.includes("request_type<>'commerce_intake_review'") && genericFunction.includes("requires its dedicated decision workflow")],
  ["Generic decisions accept only APPROVE or DENY", genericFunction.includes("not in ('accepted','denied')") && !ownerPortal.includes("Owner requested edits/revision")],
  ["Domain decisions are atomic and pending-only", domainFunction.includes("for update") && domainFunction.includes("Only a pending domain review can be resolved")],
  ["Domain decisions lock the exact domain record", domainFunction.includes("where client_id=request_row.client_id and domain_name=domain_name_value") && domainFunction.includes("domain_id',domain_row.id")],
  ["Legacy preview decisions stay out of the generic lane", ownerPortal.includes("isLaunchPreviewReview(approval)") && genericFunction.includes("requires its dedicated decision workflow")],
  ["Service workers cannot make human decisions", denyFunction.includes("service_role") && genericFunction.includes("service_role") && domainFunction.includes("service_role")],
  ["All decisions record server-side evidence", migration.includes("server_authoritative',true") && migration.includes("automation_audit_log")],
  ["Extended CI enforces Wave 23", ci.includes("validate-autonomy-ops-wave23-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${label}`);
    if (label.includes("source table") && missingTables.length) {
      console.error(`      missing: ${missingTables.join(", ")}`);
    }
  }
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-three checks passed.`);
if (passed !== checks.length) process.exit(1);
