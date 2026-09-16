import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const setup = read("src/lib/providerSetup.ts");
const launchReadiness = read("src/pages/OwnerLaunchReadiness.tsx");
const handoff = read("docs/NXQ_RUNTIME_HANDOFF.md");
const workflow = read(".github/workflows/manual-supabase-stage.yml");
const manifest = read("scripts/edge-function-manifest.mjs");

const internalSecretNames = [
  "NXQ_NOTIFICATION_ADAPTER_URL",
  "NXQ_NOTIFICATION_ADAPTER_TOKEN",
  "NXQ_MALWARE_SCAN_ADAPTER_URL",
  "NXQ_MALWARE_SCAN_ADAPTER_TOKEN",
  "NXQ_PROVIDER_HEALTH_ADAPTER_URL",
  "NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN",
  "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
  "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
];
const externalSecretNames = [
  "NXQ_RESEND_API_KEY",
  "NXQ_NOTIFICATION_FROM_EMAIL",
  "NXQ_CLOUDMERSIVE_API_KEY",
  "NXQ_AI_MODEL_PROVIDER_URL",
  "NXQ_AI_MODEL_PROVIDER_TOKEN",
  "NXQ_AI_MODEL_PROVIDER_MODEL",
  "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
];
const requiredSecretNames = [...internalSecretNames, ...externalSecretNames];

const setupStep = /- name: Configure internal provider adapters only[\s\S]*?- name: Run zero-Netlify staging evidence suite/.exec(workflow)?.[0] || "";

const checks = [
  ["Checklist has notification, malware, provider-health, and AI groups", ["notifications", "malware", "provider_health", "ai"].every((id) => setup.includes(`id: "${id}"`))],
  ["Checklist names every protected provider setting", requiredSecretNames.every((name) => setup.includes(`"${name}"`))],
  ["Checklist separates NXQ-prepared and account-provided values", setup.includes("preparedSecretNames") && setup.includes("accountSecretNames") && launchReadiness.includes("NXQ prepares through the guarded staging action")],
  ["Checklist never contains secret values or collection inputs", !/value\s*=|localStorage|sessionStorage|password|type=["']password/i.test(setup + launchReadiness)],
  ["Owner view presents the checklist and Provider Health route", launchReadiness.includes("data-provider-setup-checklist") && launchReadiness.includes('href="/owner/providers"')],
  ["Owner view keeps real proof behind separate authorization", launchReadiness.includes("Run real staging proof only with separate explicit authorization")],
  ["Owner view directs secrets only to protected Supabase staging secrets", launchReadiness.includes("protected Supabase staging secrets")],
  ["Checklist contains no provider, Netlify, deployment, or production mutation", !/fetch\(|functions\.invoke\(|supabase\.rpc\(|api\.netlify\.com|deploy/i.test(setup)],
  ["Manual workflow has one exact guarded internal-adapter action", workflow.includes("- configure_internal_provider_adapters") && workflow.includes("if: inputs.action == 'configure_internal_provider_adapters'")],
  ["Internal action generates four independent high-entropy tokens", ["notification_token", "malware_token", "provider_health_token", "build_plan_token"].every((name) => setupStep.includes(`${name}=`)) && (setupStep.match(/randomBytes\(32\)/g) || []).length === 4],
  ["Internal action derives four fixed first-party adapter URLs", ["notification-provider-adapter", "malware-scan-provider-adapter", "provider-health-adapter", "generate-business-build-plan"].every((name) => setupStep.includes(`\${function_base_url}/${name}`))],
  ["Internal action uses a protected temporary file and removes it", setupStep.includes("umask 077") && setupStep.includes("--env-file") && setupStep.includes("trap 'rm -f") && setupStep.includes('rm -f "$secrets_file"')],
  ["Internal action verifies names without printing values", setupStep.includes("supabase secrets list") && setupStep.includes("business-internal-provider-adapters") && setupStep.includes("no value was printed")],
  ["Internal action has no deployment, provider request, Netlify API, evidence, or QA operation", !/functions deploy|curl |wget |api\.netlify\.com|run-staging-evidence|start_disposable|dispatch_workers/.test(setupStep)],
  ["Internal secret profile contains exactly the eight generated names", manifest.includes('"business-internal-provider-adapters"') && internalSecretNames.every((name) => manifest.includes(`"${name}"`))],
  ["Handoff documents the future one-session hookup", handoff.includes("## Future one-session provider hookup") && requiredSecretNames.every((name) => handoff.includes(name))],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} provider plug-in readiness checks passed.`);
if (passed !== checks.length) process.exit(1);
