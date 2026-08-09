import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/142_provider_health_dispatcher.sql", "utf8");
const worker = fs.readFileSync("supabase/functions/check-provider-health/index.ts", "utf8");
const providerFoundation = fs.readFileSync("supabase/migrations/134_provider_observability_and_recovery_foundation.sql", "utf8");

const checks = [
  ["Provider registry stores required secret names instead of secrets", providerFoundation.includes("required_secret_names") && providerFoundation.includes("never raw secrets")],
  ["Provider dispatcher uses Supabase Vault", migration.includes("vault.decrypted_secrets")],
  ["Provider dispatcher keeps worker URL/token out of source", migration.includes("nxq_provider_health_edge_url") && migration.includes("nxq_automation_worker_token")],
  ["Provider dispatcher runs automatically every five minutes", migration.includes("*/5 * * * *")],
  ["Provider dispatcher only wakes for stale health state", migration.includes("last_checked_at < now() - interval '5 minutes'")],
  ["Missing worker configuration is explicit", migration.includes("provider_health_worker_vault_config_missing")],
  ["Health worker requires protected automation token", worker.includes("x-nxq-worker-token") && worker.includes("NXQ_AUTOMATION_WORKER_TOKEN")],
  ["Health worker requires adapter credentials before checking", worker.includes("NXQ_PROVIDER_HEALTH_ADAPTER_URL") && worker.includes("NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN")],
  ["Missing provider adapter never fabricates health", worker.includes("provider_health_adapter_missing") && worker.includes("provider_statuses_changed: 0")],
  ["Health results persist evidence events", worker.includes("nxq_provider_health_events")],
  ["Unauthorized/rate-limited provider responses are distinguished", worker.includes("unauthorized") && worker.includes("rate_limited")],
  ["Provider timeouts are bounded", worker.includes("AbortController") && worker.includes("12000")],
  ["Connection state derives from health evidence", worker.includes("connectionStatusFromHealth")],
  ["Provider health worker records heartbeat", worker.includes("record_worker_heartbeat")],
  ["Provider health refreshes launch readiness", worker.includes("evaluate_launch_readiness")],
  ["Health adapter receives required secret names, not secret values", worker.includes("required_secret_names: connection.required_secret_names") && !worker.includes("SUPABASE_SERVICE_ROLE_KEY: connection")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${label}`);
  }
}
console.log(`\n${passed}/${checks.length} provider health checks passed.`);
if (passed !== checks.length) process.exit(1);
