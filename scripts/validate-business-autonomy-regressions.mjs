import fs from "node:fs";
import path from "node:path";
import { runtimeSecretProfiles } from "./edge-function-manifest.mjs";

const root = process.cwd();
const failures = [];
const check = (ok, message) => {
  if (ok) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures.push(message); }
};
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const coreWorkers = [
  "provision-project-infrastructure",
  "prepare-build-plan",
  "build-business-website",
  "promote-business-production",
];

for (const workflowPath of [
  [".github", "workflows", "manual-supabase-stage.yml"],
  [".github", "workflows", "runtime-worker-dispatch.yml"],
]) {
  const source = read(...workflowPath);
  for (const worker of coreWorkers) {
    check(source.includes(worker), `${workflowPath.at(-1)} dispatches ${worker}`);
  }
}

const scheduled = read(".github", "workflows", "runtime-worker-dispatch.yml");
check(scheduled.includes('cron: "*/5 * * * *"'), "staging worker dispatcher retains five-minute schedule");
check(scheduled.includes("environment: nxq-staging"), "scheduled dispatcher remains staging-scoped");

for (const [profile, secrets] of Object.entries(runtimeSecretProfiles)) {
  if (!profile.startsWith("business-")) continue;
  check(secrets.includes("NXQ_AUTOMATION_SOURCE_REF"), `${profile} requires NXQ_AUTOMATION_SOURCE_REF`);
}

check(fs.existsSync(path.join(root, "templates", "business-v1", "index.html")), "Business v1 blueprint index exists");

const functionsDir = path.join(root, "supabase", "functions");
for (const dirent of fs.readdirSync(functionsDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const file = path.join(functionsDir, dirent.name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes("GITHUB_APP_PRIVATE_KEY") || !source.includes("importPKCS8")) continue;
  check(
    source.includes("normalizeGithubPrivateKey") && source.includes("importPKCS8(normalizeGithubPrivateKey("),
    `${dirent.name} accepts PKCS#1/PKCS#8 GitHub App private keys`,
  );
}

const productionWorker = read("supabase", "functions", "promote-business-production", "index.ts");
check(productionWorker.includes("EXTERNAL_PROVIDER_BILLING_BLOCKER"), "production worker classifies provider billing blockers");
check(productionWorker.includes('admin.rpc("defer_external_provider_billing_job"'), "production worker preserves provider-blocker retry budget through RPC");

const hardeningMigration = read("supabase", "migrations", "196_runtime_observability_and_provider_retry_hardening.sql");
check(hardeningMigration.includes("attempts = greatest(attempts - 1, 0)"), "provider billing deferral restores claimed attempt");
check(hardeningMigration.includes("grant select on public.client_files to authenticated"), "client_files authenticated SELECT grant is captured");
check(hardeningMigration.includes("Clients can read own client files"), "client_files tenant RLS policy is captured");
check(hardeningMigration.includes("grant select on public.automation_worker_heartbeats to authenticated"), "owner heartbeat SELECT grant is captured");

if (failures.length) {
  console.error(`\nBusiness autonomy regression audit failed (${failures.length} issue(s)).`);
  process.exit(1);
}
console.log("\nBusiness autonomy regression audit passed.");
