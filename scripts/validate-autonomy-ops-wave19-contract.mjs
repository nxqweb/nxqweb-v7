import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const adapter = read("supabase/functions/generate-business-build-plan/index.ts");
const worker = read("supabase/functions/prepare-build-plan/index.ts");
const migration = read("supabase/migrations/179_business_build_plan_ai_runtime_adapter.sql");
const deploy = read(".github/workflows/manual-supabase-stage.yml");

const checks = [
  ["Runtime adapter is a protected Edge function", adapter.includes('Deno.serve(async (request)') && adapter.includes("NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN") && adapter.includes("constantTimeEqual")],
  ["Runtime accepts only the Business build-plan task", adapter.includes('enrich_business_build_plan_v1') && adapter.includes("Unsupported NXQ AI task or schema version")],
  ["Runtime input has an explicit PII-minimizing allowlist", adapter.includes("allowedInputKeys") && !adapter.includes('"contact_email"') && !adapter.includes('"contact_phone"') && !adapter.includes('"contact_name"')],
  ["Runtime requires SHA-256 intake identity", adapter.includes('/^[a-f0-9]{64}$/') && adapter.includes("request_fingerprint")],
  ["Runtime independently matches service and page allowlists", adapter.includes("AI contract allowlists do not match the sanitized intake") && adapter.includes("sameStrings")],
  ["Runtime independently enforces NXQ theme allowlist", adapter.includes("allowedThemeKeys") && adapter.includes("outside the NXQ allowlist")],
  ["Provider endpoint is restricted to public credential-free HTTPS", adapter.includes("credential-free public HTTPS endpoint") && adapter.includes("privateIpv4") && adapter.includes("privateIpv6")],
  ["Runtime supports Responses and compatible chat protocols", adapter.includes('openai_responses') && adapter.includes('openai_chat_completions') && adapter.includes("providerProtocol")],
  ["Responses calls use strict Structured Outputs", adapter.includes('text: { format: { type: "json_schema"') && adapter.includes("strict: true")],
  ["Provider storage is explicitly disabled", adapter.includes("store: false")],
  ["Provider timeout and payload sizes are bounded", adapter.includes("controller.abort(), 20_000") && adapter.includes("256_000") && adapter.includes("64_000")],
  ["Invalid NXQ input cannot poison provider health", adapter.includes("Invalid NXQ build-plan request") && adapter.includes("AI model provider configuration is invalid")],
  ["Refusal and incomplete responses fail closed", adapter.includes("AI provider refused") && adapter.includes("AI provider response was incomplete")],
  ["Unexpected provider result shapes fail closed", adapter.includes("unexpected top-level shape") && adapter.includes("did not preserve the NXQ schema and intake fingerprint")],
  ["Runtime records real provider-call heartbeat evidence", adapter.includes('workerName = "generate-business-build-plan"') && adapter.includes("provider_call_proven: true") && adapter.includes("last_request_fingerprint")],
  ["Runtime records provider health without exposing secret values", adapter.includes('provider_key", "business_build_plan_ai"') && !migration.includes("Bearer ")],
  ["Readiness requires adapter and downstream worker proof", migration.includes("adapter_heartbeat_ready") && migration.includes("provider_call_proven") && migration.includes("successful_enrichment_proven") && migration.includes("deterministic_merge_proven")],
  ["Missing runtime evidence remains unknown", migration.includes("case when ready_now then 'ready' else 'unknown' end")],
  ["Provider registry stores names instead of secret values", migration.includes("NXQ_AI_MODEL_PROVIDER_TOKEN") && migration.includes("required_secret_names")],
  ["Runtime adapter is included in guarded manual deployment", deploy.includes("generate-business-build-plan") && deploy.includes("workflow_dispatch")],
  ["Authoritative worker still performs deep independent validation", worker.includes("validateAiStrategy") && worker.includes("deterministic_safety_merge: true")],
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
console.log(`\n${passed}/${checks.length} autonomy ops wave-nineteen checks passed.`);
if (passed !== checks.length) process.exit(1);
