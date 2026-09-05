import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const harness = read("scripts/simulate-business-lifecycle-e2e.mjs");
const ci = read(".github/workflows/ci-mega-extended.yml");
const pkg = read("package.json");

const checks = [
  ["Harness starts with completed structured Business intake", harness.includes('intake: { complete: true, family: "business"')],
  ["One human accept/deny decision is terminal and replay safe", harness.includes("a terminal owner decision cannot be reversed by replay") && harness.includes("alreadyApplied: true")],
  ["DENY cancels work before provider creation", harness.includes("DENY creates zero provider infrastructure") && harness.includes("owner_denied_pipeline_stopped")],
  ["Build-plan derivation preserves approved intake and disables auto-publish", harness.includes("approvedServices") && harness.includes("productionAutoPublish: false")],
  ["Provider resources are checkpointed idempotently", harness.includes("GitHub checkpoint retry creates one repo and one site") && harness.includes("Netlify checkpoint retry reuses both provider resources")],
  ["Preview requires plan infrastructure and exact quality evidence", harness.includes("validated build plan is required") && harness.includes("provider checkpoints are required") && harness.includes("quality checks must all pass")],
  ["Preview and production remain distinct", harness.includes("preview and production source must stay distinct")],
  ["Production rechecks tenant project approval and exact commit", harness.includes("cross-tenant preview promotion is blocked") && harness.includes("cross-project preview promotion is blocked") && harness.includes("production commit mismatch")],
  ["Main drift regenerates instead of overwriting", harness.includes("Main drift regenerates without overwriting production") && harness.includes("main_drift_regeneration_queued")],
  ["Denial after preview blocks publication", harness.includes("Denial after preview blocks production")],
  ["Repeated clean flows assert no duplicate jobs", harness.includes("replays cannot duplicate jobs") && harness.includes("Clean onboarding-to-live replay")],
  ["Billing simulation requires human freeze and ignores stale events", harness.includes("Billing grace stops at owner review") && harness.includes("specific owner freeze note") && harness.includes("occurredDay <= client.billing.lastProviderEventDay")],
  ["Harness explicitly distinguishes local simulation from external E2E evidence", harness.includes("External provider evidence: not exercised")],
  ["Package exposes a one-command lifecycle test", pkg.includes('"test:lifecycle"') && pkg.includes("--runs=10")],
  ["Extended CI runs the lifecycle harness", ci.includes("simulate-business-lifecycle-e2e.mjs --runs=10")],
  ["Extended CI enforces Wave 28", ci.includes("validate-autonomy-ops-wave28-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else console.error(`FAIL  ${label}`);
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-eight checks passed.`);
if (passed !== checks.length) process.exit(1);
