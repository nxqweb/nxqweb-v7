import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const manifest = read("scripts/edge-function-manifest.mjs");
const preflight = read("scripts/check-runtime-stage-readiness.mjs");
const workflow = read(".github/workflows/manual-supabase-stage.yml");
const leads = read("supabase/functions/ingest-business-lead/index.ts");
const notifications = read("supabase/functions/dispatch-notifications/index.ts");
const scanner = read("supabase/functions/scan-client-file/index.ts");
const clientFiles = read("src/pages/ClientFiles.tsx");
const ownerFiles = read("src/pages/OwnerFiles.tsx");

const checks = [
  ["Zero-key staging has an explicit secret profile", manifest.includes('"business-zero-key-staging"') && manifest.includes('"NXQ_LEAD_FINGERPRINT_SALT"') && manifest.includes('"NXQ_PUBLIC_ANALYTICS_ENDPOINT"') && manifest.includes('"NXQ_PUBLIC_LEAD_ENDPOINT"')],
  ["Zero-key profile excludes unavailable external adapters", !/"business-zero-key-staging"[\s\S]*?\]\),/.exec(manifest)?.[0].includes("NXQ_LEAD_CHALLENGE_TOKEN") && !/"business-zero-key-staging"[\s\S]*?\]\),/.exec(manifest)?.[0].includes("NXQ_MALWARE_SCAN_ADAPTER_TOKEN") && !/"business-zero-key-staging"[\s\S]*?\]\),/.exec(manifest)?.[0].includes("NXQ_NOTIFICATION_ADAPTER_TOKEN")],
  ["Workflow exposes read-only zero-key validation", workflow.includes("- validate_zero_key") && workflow.includes("--profile=business-zero-key-staging") && workflow.includes("inputs.action != 'validate_zero_key'")],
  ["Runtime preflight proves exact zero-key profile composition", preflight.includes("expectedZeroKeySecrets") && preflight.includes("Zero-key staging requires public runtime wiring")],
  ["Lead fallback is restricted to non-production environments", leads.includes("STAGING_ENVIRONMENTS") && leads.includes("stagingFallbackAllowed()") && leads.includes('mode:"staging_rate_limit_honeypot"')],
  ["Production lead intake blocks when the challenge adapter is absent", leads.includes('return {allowed:false,mode:"blocked"}') && leads.indexOf("if(!endpoint||!auth)") < leads.indexOf("if(!form.require_challenge)return")],
  ["Lead fallback preserves origin, quota, fingerprint, and honeypot controls", ["Origin is not allowed", "reserveLeadQuota", "NXQ_LEAD_FINGERPRINT_SALT", 'reason:"honeypot"'].every((proof) => leads.includes(proof))],
  ["Lead records retain challenge-mode evidence", leads.includes("challenge_mode:challenge.mode")],
  ["Notification fallback is explicitly in-app only", notifications.includes('const deliveryMode = adapterConfigured ? "external_and_in_app" : "in_app_only"') && notifications.includes("external_delivery_enabled: adapterConfigured")],
  ["External notifications block instead of pretending delivery", notifications.includes("External notification delivery is disabled until a provider adapter is configured") && notifications.includes('status: "blocked"')],
  ["Missing malware adapter never claims or downloads a file in staging", scanner.includes('mode: "quarantine_only"') && scanner.indexOf("if (!adapterConfigured)") < scanner.indexOf('admin.rpc("claim_next_client_file_security_scan"') && scanner.indexOf("if (!adapterConfigured)") < scanner.indexOf(".download(file.storage_path)")],
  ["Missing malware adapter fails closed outside staging", scanner.includes('mode: "blocked"') && scanner.includes("No file was claimed or released") && scanner.includes("}, 503)")],
  ["Client and owner file access remain locked to clean released scans", clientFiles.includes('file.scan_status!=="clean"||file.quarantine_status!=="released"') && ownerFiles.includes('scan?.status === "clean" && scan.quarantine_status === "released"')],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} zero-key staging checks passed.`);
if (passed !== checks.length) process.exit(1);
