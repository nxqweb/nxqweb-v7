import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routesPath = path.join(root, "supabase/migrations/197_complete_internal_runtime_vault_routes.sql");
const workflowPath = path.join(root, ".github/workflows/runtime-worker-dispatch.yml");

const routesSql = fs.readFileSync(routesPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");

const routeMatches = [...routesSql.matchAll(/\('nxq_[^']+','([^']+)'\)/g)];
const functions = [...new Set(routeMatches.map((match) => match[1]))].sort();

if (functions.length !== 13) {
  throw new Error(`Expected 13 Vault-routed internal Edge functions, found ${functions.length}: ${functions.join(", ")}`);
}

const requiredFallbackFunctions = [...functions, "provision-storefront"];
const missing = requiredFallbackFunctions.filter((fn) => !new RegExp(`\\bwake\\s+${fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(workflow));
if (missing.length) {
  throw new Error(`Runtime fallback is missing required workers: ${missing.join(", ")}`);
}

const requiredSafetyMarkers = [
  'schedule:',
  'cron: "*/5 * * * *"',
  'environment: nxq-staging',
  'NXQ_AUTOMATION_WORKER_TOKEN',
  'https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1',
  '--fail-with-body',
  '--connect-timeout 15',
  '--max-time 60',
  'Verify staging Edge gateway is reachable',
];

const missingSafety = requiredSafetyMarkers.filter((marker) => !workflow.includes(marker));
if (missingSafety.length) {
  throw new Error(`Runtime fallback lost required safety markers: ${missingSafety.join(", ")}`);
}

console.log(`Runtime fallback covers all ${functions.length} Vault-routed internal Edge functions plus Commerce provisioning.`);
