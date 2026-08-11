import fs from "node:fs";
import path from "node:path";
import {
  edgeFunctionManifest,
  functionNames,
  managedEdgeSecrets,
  runtimeSecretProfiles,
  vaultRuntimeRoutes,
} from "./edge-function-manifest.mjs";

const root = process.cwd();
const functionRoot = path.join(root, "supabase", "functions");
const pass = (message) => console.log(`PASS  ${message}`);
const fail = (message) => { console.error(`FAIL  ${message}`); process.exitCode = 1; };

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function equalSets(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function jsonNames(file, likelyKeys) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const names = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (likelyKeys.has(key) && typeof child === "string") names.add(child);
      else visit(child);
    }
  };
  visit(value);
  return names;
}

const discovered = fs.readdirSync(functionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(functionRoot, entry.name, "index.ts")))
  .map((entry) => entry.name)
  .sort();
const declared = functionNames().sort();
if (equalSets(discovered, declared)) pass(`Manifest covers all ${declared.length} Edge functions exactly`);
else {
  fail("Edge-function manifest does not match the function directory");
  console.error(`Missing from manifest: ${discovered.filter((name) => !declared.includes(name)).join(", ") || "none"}`);
  console.error(`Missing from source: ${declared.filter((name) => !discovered.includes(name)).join(", ") || "none"}`);
}

const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
for (const item of edgeFunctionManifest) {
  const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(`\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1] || "";
  const expected = `verify_jwt = ${String(item.verifyJwt)}`;
  if (!section.includes(expected)) fail(`${item.name} is missing ${expected} in supabase/config.toml`);
}
if (!process.exitCode) pass("Supabase config explicitly preserves every JWT boundary");

const sourceByName = new Map(discovered.map((name) => [name, fs.readFileSync(path.join(functionRoot, name, "index.ts"), "utf8")]));
const authMarkers = {
  "worker-token": ["x-nxq-worker-token"],
  "trusted-worker-or-owner": ["x-nxq-worker-token", "auth.getUser"],
  "adapter-token": ["NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN", "Authorization"],
  "provider-health-adapter-token": ["NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN", "Authorization", "constantTimeEqual"],
  "billing-adapter-token": ["NXQ_BILLING_ADAPTER_TOKEN", "x-nxq-billing-adapter-token"],
  "public-ingest-key": ["public_ingest_key"],
  "public-form-key": ["business_lead_forms", '.eq("form_key"'],
  "owner-jwt": ["auth.getUser", "owner_users"],
  "client-jwt": ["auth.getUser", "clients"],
};
for (const item of edgeFunctionManifest) {
  const source = sourceByName.get(item.name) || "";
  const markers = authMarkers[item.authBoundary] || [];
  if (!markers.every((marker) => source.includes(marker))) fail(`${item.name} does not prove its declared ${item.authBoundary} boundary`);
}
if (!process.exitCode) pass("Every gateway exception has an independent source-level authentication boundary");

const migrationText = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8"))
  .join("\n");
for (const [secretName, functionName] of vaultRuntimeRoutes) {
  if (!migrationText.includes(`'${secretName}'`)) fail(`Vault route ${secretName} is not used by a captured migration`);
  if (!declared.includes(functionName)) fail(`Vault route ${secretName} targets unknown function ${functionName}`);
}
if (!process.exitCode) pass(`All ${vaultRuntimeRoutes.length} Vault routes target captured Edge functions`);

const allFunctionSource = [...sourceByName.values()].join("\n");
const referencedSecretNames = new Set();
for (const regex of [
  /Deno\.env\.get\(["']([A-Z0-9_]+)["']\)/g,
  /Deno\.env\.([A-Z][A-Z0-9_]*)/g,
  /(?:secret|requiredSecret|optionalSecret)\(["']([A-Z0-9_]+)["']\)/g,
]) {
  for (const match of allFunctionSource.matchAll(regex)) referencedSecretNames.add(match[1]);
}
for (const secrets of Object.values(runtimeSecretProfiles)) {
  for (const name of secrets) if (!referencedSecretNames.has(name)) fail(`Runtime profile contains unreferenced secret name ${name}`);
}
for (const name of managedEdgeSecrets) if (!referencedSecretNames.has(name)) fail(`Managed Edge secret ${name} is not referenced`);
if (!process.exitCode) pass("Runtime profiles contain names only and match actual Edge-function configuration reads");

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "manual-supabase-stage.yml"), "utf8");
const workflowProof = [
  'environment: nxq-staging',
  'npm ci',
  'npm run test:runtime-stage',
  'npx --no-install supabase db push --dry-run --linked',
  'edge-function-manifest.mjs --group=no-verify-jwt',
  'edge-function-manifest.mjs --group=verify-jwt',
  'check-runtime-stage-readiness.mjs --profile=business-configured-foundation',
  'check-runtime-stage-readiness.mjs --profile=business-non-ai-staging',
  'check-runtime-stage-readiness.mjs --profile=business-external-qa',
  'check-runtime-stage-readiness.mjs --supabase-functions-json=',
  'APPLY-NXQ-SUPABASE-STAGING',
];
for (const proof of workflowProof) if (!workflow.includes(proof)) fail(`Manual staging workflow is missing: ${proof}`);
if (!workflow.includes("--no-verify-jwt")) fail("Manual staging workflow does not preserve custom-auth gateway exceptions");
if (workflow.includes("environment: nxq-production")) fail("Manual staging workflow still targets the production GitHub environment");
if (!process.exitCode) pass("Manual workflow is staging-only, dry-runs first, and deploys from the exact manifest");

const profile = option("profile");
const secretsFile = option("supabase-secrets-json");
if (profile) {
  const required = runtimeSecretProfiles[profile];
  if (!required) fail(`Unknown runtime secret profile: ${profile}`);
  else if (!secretsFile) fail(`Profile ${profile} requires --supabase-secrets-json=<path>`);
  else {
    const available = jsonNames(secretsFile, new Set(["name"]));
    const missing = required.filter((name) => !available.has(name));
    if (missing.length) fail(`${profile} is missing ${missing.length} Supabase Edge secret name(s): ${missing.join(", ")}`);
    else pass(`${profile} has all ${required.length} required Supabase Edge secret names`);
  }
}

const functionsFile = option("supabase-functions-json");
if (functionsFile) {
  const deployed = jsonNames(functionsFile, new Set(["name", "slug"]));
  const missing = declared.filter((name) => !deployed.has(name));
  if (missing.length) fail(`Remote Supabase project is missing ${missing.length} function(s): ${missing.join(", ")}`);
  else pass(`Remote Supabase project reports all ${declared.length} required Edge functions`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log("\nNXQ runtime staging preflight passed without reading or printing any secret value.");
