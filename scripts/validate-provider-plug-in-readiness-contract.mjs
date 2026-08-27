import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const setup = read("src/lib/providerSetup.ts");
const launchReadiness = read("src/pages/OwnerLaunchReadiness.tsx");
const handoff = read("docs/NXQ_RUNTIME_HANDOFF.md");

const requiredSecretNames = [
  "NXQ_NOTIFICATION_ADAPTER_URL",
  "NXQ_NOTIFICATION_ADAPTER_TOKEN",
  "NXQ_RESEND_API_KEY",
  "NXQ_NOTIFICATION_FROM_EMAIL",
  "NXQ_MALWARE_SCAN_ADAPTER_URL",
  "NXQ_MALWARE_SCAN_ADAPTER_TOKEN",
  "NXQ_CLOUDMERSIVE_API_KEY",
  "NXQ_AI_MODEL_PROVIDER_URL",
  "NXQ_AI_MODEL_PROVIDER_TOKEN",
  "NXQ_AI_MODEL_PROVIDER_MODEL",
  "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
  "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
  "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
];

const checks = [
  ["Checklist has notification, malware, and AI groups", ["notifications", "malware", "ai"].every((id) => setup.includes(`id: "${id}"`))],
  ["Checklist names every protected provider setting", requiredSecretNames.every((name) => setup.includes(`"${name}"`))],
  ["Checklist never contains secret values or collection inputs", !/value\s*=|localStorage|sessionStorage|password|type=["']password/i.test(setup + launchReadiness)],
  ["Owner view presents the checklist and Provider Health route", launchReadiness.includes("data-provider-setup-checklist") && launchReadiness.includes('href="/owner/providers"')],
  ["Owner view keeps real proof behind separate authorization", launchReadiness.includes("Run real staging proof only with separate explicit authorization")],
  ["Owner view directs secrets only to protected Supabase staging secrets", launchReadiness.includes("protected Supabase staging secrets")],
  ["Checklist contains no provider, Netlify, deployment, or production mutation", !/fetch\(|functions\.invoke\(|supabase\.rpc\(|api\.netlify\.com|deploy/i.test(setup)],
  ["Handoff documents the future one-session hookup", handoff.includes("## Future one-session provider hookup") && requiredSecretNames.every((name) => handoff.includes(name))],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} provider plug-in readiness checks passed.`);
if (passed !== checks.length) process.exit(1);
