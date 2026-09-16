import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const notificationAdapter = read("supabase/functions/notification-provider-adapter/index.ts");
const malwareAdapter = read("supabase/functions/malware-scan-provider-adapter/index.ts");
const notifications = read("supabase/functions/dispatch-notifications/index.ts");
const scanner = read("supabase/functions/scan-client-file/index.ts");
const providerHealth = read("supabase/functions/check-provider-health/index.ts");
const bootstrap = read("supabase/functions/bootstrap-runtime-vault/index.ts");
const migration = read("supabase/migrations/238_truthful_provider_readiness_adapters.sql");
const manifest = read("scripts/edge-function-manifest.mjs");
const config = read("supabase/config.toml");
const workflow = read(".github/workflows/manual-supabase-stage.yml");

const checks = [
  ["Notification adapter uses constant-time protected authentication", notificationAdapter.includes("NXQ_NOTIFICATION_ADAPTER_TOKEN") && notificationAdapter.includes("constantTimeEqual") && notificationAdapter.includes("Authorization")],
  ["Notification adapter targets only the fixed Resend send endpoint", notificationAdapter.includes('fetch("https://api.resend.com/emails"') && notificationAdapter.includes('method: "POST"') && notificationAdapter.includes('redirect: "error"')],
  ["Notification adapter preserves provider idempotency", notificationAdapter.includes('"Idempotency-Key"') && notificationAdapter.includes("notification.idempotency_key") && notificationAdapter.includes("provider_message_id")],
  ["Notification adapter requires real upstream configuration", notificationAdapter.includes("NXQ_RESEND_API_KEY") && notificationAdapter.includes("NXQ_NOTIFICATION_FROM_EMAIL") && notificationAdapter.includes("Resend notification provider is not configured")],
  ["Notification adapter sends bounded plain text and never returns secrets", notificationAdapter.includes("text: notification.body") && notificationAdapter.includes("secret_values_returned: false") && !notificationAdapter.includes("html: notification.body")],
  ["Malware adapter uses constant-time protected authentication", malwareAdapter.includes("NXQ_MALWARE_SCAN_ADAPTER_TOKEN") && malwareAdapter.includes("constantTimeEqual") && malwareAdapter.includes("Authorization")],
  ["Malware adapter targets only the fixed Cloudmersive scan endpoint", malwareAdapter.includes('fetch("https://api.cloudmersive.com/virus/scan/file"') && malwareAdapter.includes('method: "POST"') && malwareAdapter.includes('redirect: "error"')],
  ["Malware adapter independently verifies file identity", malwareAdapter.includes("sha256Hex") && malwareAdapter.includes("observedSha256") && malwareAdapter.includes("expectedSha256") && malwareAdapter.includes("File checksum did not match")],
  ["Malware adapter fails closed on missing or malformed evidence", malwareAdapter.includes("NXQ_CLOUDMERSIVE_API_KEY") && malwareAdapter.includes('typeof providerBody.CleanResult !== "boolean"') && malwareAdapter.includes("secret_values_returned: false")],
  ["Provider calls have bounded timeouts and payloads", notificationAdapter.includes("12_000") && malwareAdapter.includes("20_000") && notificationAdapter.includes("Request body is too large") && malwareAdapter.includes("NXQ_MALWARE_ADAPTER_MAX_BYTES")],
  ["Successful notification activity owns notification health", notifications.includes("recordNotificationProviderHealth") && notifications.includes('recordNotificationProviderHealth(admin, "healthy", null)') && notifications.includes('recordNotificationProviderHealth(admin, "error", message)')],
  ["Successful malware activity owns malware health", scanner.includes("recordMalwareProviderHealth") && scanner.includes('recordMalwareProviderHealth(admin, "healthy", null)') && scanner.includes('recordMalwareProviderHealth(admin, "error", message)')],
  ["Generic health checks preserve worker-owned activity evidence", providerHealth.includes('connection.config?.health_check_mode === "activity_evidence"') && providerHealth.includes("activity_evidence_connections_skipped")],
  ["Final provider-health heartbeat preserves adapter configuration", providerHealth.includes("adapter_configured: true") && providerHealth.includes("checked,") && providerHealth.includes("activity_evidence_connections_skipped")],
  ["Runtime bootstrap requires upstream provider secret names", ["NXQ_RESEND_API_KEY","NXQ_NOTIFICATION_FROM_EMAIL","NXQ_CLOUDMERSIVE_API_KEY"].every((name) => bootstrap.includes(name))],
  ["Readiness requires recent successful notification activity", migration.includes("notification_last_success") && migration.includes("successful_delivery_required") && migration.includes("evidence_freshness_days',30")],
  ["Readiness requires a recent released Cloudmersive clean scan", migration.includes("clean_scan_last_success") && migration.includes("status='clean'") && migration.includes("quarantine_status='released'") && migration.includes("provider_reference like 'cloudmersive:%'")],
  ["Activity-owned AI providers cannot be degraded by the generic checker", migration.includes("'change_classifier_ai','business_build_plan_ai'") && migration.includes("'health_check_mode','activity_evidence'")],
  ["New adapters are included in the deployment manifest and JWT config", ["malware-scan-provider-adapter","notification-provider-adapter"].every((name) => manifest.includes(`entry("${name}", false`) && config.includes(`[functions.${name}]\nverify_jwt = false`))],
  ["Manual staging has one exact provider-readiness deployment action", workflow.includes("- deploy_provider_readiness") && ["bootstrap-runtime-vault","check-provider-health","dispatch-notifications","malware-scan-provider-adapter","notification-provider-adapter","scan-client-file"].every((name) => workflow.includes(name)) && workflow.includes("if: inputs.action == 'deploy_provider_readiness'")],
  ["Scoped provider deployment contains no Netlify or production operation", /name: Deploy provider-readiness functions only[\s\S]*?name: Run zero-Netlify staging evidence suite/.test(workflow) && !/name: Deploy provider-readiness functions only[\s\S]*?name: Run zero-Netlify staging evidence suite/.exec(workflow)?.[0].includes("api.netlify.com") && !/name: Deploy provider-readiness functions only[\s\S]*?name: Run zero-Netlify staging evidence suite/.exec(workflow)?.[0].includes("production-netlify")],
  ["Launch profiles include the real upstream provider names", ["NXQ_RESEND_API_KEY","NXQ_NOTIFICATION_FROM_EMAIL","NXQ_CLOUDMERSIVE_API_KEY"].every((name) => manifest.includes(name))],
  ["Repair migration records no secret values or production mutation", migration.includes("secret_values_logged',false") && migration.includes("production_changed',false")],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} provider-readiness repair checks passed.`);
if (passed !== checks.length) process.exit(1);
