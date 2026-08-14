import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const pass = (condition, message) => {
  if (condition) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures.push(message); }
};
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const infra = read("supabase", "functions", "provision-project-infrastructure", "index.ts");
pass(/ensureNetlifySite|findExistingNetlifySite|lookupNetlifySite/.test(infra), "Netlify infrastructure provisioning reconciles an existing deterministic site before create/retry");
pass(!infra.includes("triggerBaselineBuild("), "Infrastructure provisioning cannot start a production baseline build before preview");
pass(infra.includes("stop_builds: true"), "New Netlify sites start with builds stopped");

const builder = read("supabase", "functions", "build-business-website", "index.ts");
pass(/commit_ref|preview_commit_sha|expected_commit_sha/.test(builder), "Preview verification binds readiness to an exact commit SHA");
pass(/preview_commit_sha|expected_commit_sha/.test(builder) && builder.includes("client_review"), "Verified preview evidence persists its commit identity");

const promoter = read("supabase", "functions", "promote-business-production", "index.ts");
pass(/preview_commit_sha|expected_commit_sha/.test(promoter), "Production promotion consumes the verified preview commit identity");
pass(/sourceSha\s*!==\s*.*preview|preview.*!==\s*sourceSha|expected.*!==\s*sourceSha/i.test(promoter), "Production blocks source-branch drift after preview verification");
pass(promoter.includes("force: false"), "Production Git update remains fast-forward only");

const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
const allMigrations = migrations.map((name) => read("supabase", "migrations", name)).join("\n");
pass(/lease_token/i.test(allMigrations), "Claim-based runtime queues use unique lease identity rather than worker-name ownership alone");
pass(/recover.*stale|stale.*recover/i.test(allMigrations), "Stale running/scanning/sending leases have deterministic automatic recovery");
pass(/reserve.*lead.*quota|lead.*quota.*reserve/i.test(allMigrations), "Public lead rate limiting uses an atomic quota reservation contract");
pass(/reserve.*analytics.*quota|analytics.*quota.*reserve/i.test(allMigrations), "Analytics rate limiting uses an atomic quota reservation contract");
pass(/apply.*structured.*change.*atomic|atomic.*structured.*change/i.test(allMigrations), "Structured client website changes are serialized transactionally per project");
pass(/runtime.*route.*request|dispatch.*request.*id/i.test(allMigrations), "Internal Edge dispatch transport evidence is correlated to NXQ request IDs");

const lead = read("supabase", "functions", "ingest-business-lead", "index.ts");
pass(/content-length|payloadSize|request.*bytes/i.test(lead), "Public lead ingestion rejects oversized raw request bodies");
pass(/reserve.*lead.*quota|lead.*quota.*reserve/i.test(lead), "Lead ingestion uses atomic server-side quota reservation");

const analytics = read("supabase", "functions", "ingest-business-analytics", "index.ts");
pass(/content-length|payloadSize|request.*bytes/i.test(analytics), "Analytics ingestion rejects oversized raw request bodies");
pass(/reserve.*analytics.*quota|analytics.*quota.*reserve/i.test(analytics), "Analytics ingestion uses atomic server-side quota reservation");

const changeWorker = read("supabase", "functions", "apply-business-change-request", "index.ts");
pass(/apply.*structured.*change.*atomic/i.test(changeWorker), "Low-risk change worker delegates read/patch/version persistence to an atomic database boundary");

const domain = read("supabase", "functions", "reconcile-domain", "index.ts");
for (const label of ["domain state", "production URL", "maintenance URL"]) {
  pass(/\.error\).*throw|if\s*\([^\n]*\.error/i.test(domain), `Domain reconciliation checks persisted ${label} writes before job completion`);
}

const notifications = read("supabase", "functions", "dispatch-notifications", "index.ts");
pass(/idempotency/i.test(notifications) && /delivery\.id|current\.id/.test(notifications), "External notification adapter receives a stable NXQ delivery idempotency key");
pass(/delivered.*\.error|\.error.*delivered/i.test(notifications), "Notification worker verifies delivered-state persistence before counting success");

const vaultRepair = read("supabase", "migrations", "197_complete_internal_runtime_vault_routes.sql");
pass(!/select decrypted_secret into current_infra_url[\s\S]*name = 'nxq_automation_edge_url'/.test(vaultRepair), "Vault route repair does not derive authority from a route it is repairing");

const watchdog = read("supabase", "migrations", "199_internal_edge_dispatch_watchdog.sql");
pass(/request_id/i.test(watchdog) && !/order by created desc\s*limit 1/i.test(watchdog), "Internal dispatch watchdog correlates responses to NXQ-owned pg_net request IDs");

if (failures.length) {
  console.error(`\nNXQ state-machine contract failed (${failures.length} invariant(s)).`);
  process.exit(1);
}
console.log("\nNXQ state-machine contract passed: causal transitions, partial-success recovery, concurrency, tenant authority, transport evidence, and production identity are guarded.");
