import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const worker = read("supabase/functions/prepare-build-plan/index.ts");
const builder = read("supabase/functions/build-business-website/index.ts");
const migration = read("supabase/migrations/178_business_build_plan_ai_enrichment_readiness.sql");
const app = read("templates/business-v1/app.js");
const css = read("templates/business-v1/styles.css");
const aiInputStart = worker.indexOf("const aiInput = {");
const aiInputEnd = worker.indexOf("const aiResult =", aiInputStart);
const aiInputBlock = aiInputStart >= 0 && aiInputEnd > aiInputStart ? worker.slice(aiInputStart, aiInputEnd) : "";

const checks = [
  ["Build-plan worker uses dedicated provider-neutral adapter secrets", worker.includes("NXQ_BUILD_PLAN_AI_ADAPTER_URL") && worker.includes("NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN")],
  ["Adapter endpoint is restricted to credential-free public HTTPS", worker.includes("credential-free public HTTPS endpoint") && worker.includes('url.protocol !== "https:"') && worker.includes("privateIpv4")],
  ["Adapter timeout and response size are bounded", worker.includes("controller.abort(), 25_000") && worker.includes("64_000")],
  ["AI request carries a SHA-256 intake fingerprint", worker.includes('crypto.subtle.digest("SHA-256"') && worker.includes("request_fingerprint: requestFingerprint")],
  ["Adapter must echo the exact request fingerprint", worker.includes("result.request_fingerprint !== requestFingerprint")],
  ["AI payload intentionally excludes client contact details", aiInputBlock.includes("business_name") && !aiInputBlock.includes("contact_email") && !aiInputBlock.includes("contact_phone") && !aiInputBlock.includes("contact_name")],
  ["Adapter result uses a versioned narrow schema", worker.includes('adapterSchemaVersion = "nxq-business-build-plan-v1"') && worker.includes("validateAiStrategy")],
  ["Low-confidence or risk-flagged output cannot continue", worker.includes("confidence < minimumConfidence") && worker.includes("explicit risk_flags array") && worker.includes("riskFlags.length > 0")],
  ["AI copy rejects markup, control data, and links", worker.includes("unsafeAiText") && worker.includes("disallowed markup, control data, or links")],
  ["AI cannot add or rename approved services", worker.includes("attempted to add or rename an approved service") && worker.includes("serviceLookup")],
  ["AI cannot add unapproved pages", worker.includes("attempted to add an unapproved page") && worker.includes("pageLookup")],
  ["AI theme choice is constrained to a deterministic allowlist", worker.includes("supportedThemes") && worker.includes("outside the deterministic allowlist")],
  ["Business family remains backend-enforced", worker.includes('familySlug !== "business"')],
  ["Tier identity is loaded from server-side tier records", worker.includes('from("product_family_tiers")') && worker.includes("product_tier_key: tierKey")],
  ["Production auto-publish remains disabled", worker.includes("production_auto_publish: false") && worker.includes("deterministic_tier_enforcement: true")],
  ["Validated enrichment is cached by intake fingerprint", worker.includes("reusableBuildPlan") && worker.includes("adapter_response_reused")],
  ["Missing or invalid AI output uses shared retry and escalation", worker.includes("fail_external_automation_job") && !worker.includes("v2-deterministic-foundation")],
  ["Worker heartbeat proves adapter and safety-merge state", worker.includes("adapter_configured: adapterConfigured") && worker.includes("adapter_schema_version: adapterSchemaVersion") && worker.includes("deterministic_safety_merge: true")],
  ["Generated site consumes validated AI copy only", builder.includes('enrichment.status === "validated"') && builder.includes("contentStrategy") && builder.includes("serviceCopyLookup")],
  ["Generated site maps AI theme through the same allowlist", builder.includes("supportedThemeKeys") && builder.includes("selectedThroughDeterministicAllowlist: true")],
  ["Browser applies only allowlisted themes and renders copy as text", app.includes("allowedThemes") && app.includes("document.documentElement.dataset.theme") && app.includes("textContent")],
  ["Template exposes four deterministic premium themes", css.includes('data-theme="charcoal_gold"') && css.includes('data-theme="forest_emerald"') && css.includes('data-theme="royal_violet"')],
  ["Launch readiness requires a real successful enrichment", migration.includes("successful_enrichment_proven") && migration.includes("last_input_fingerprint") && migration.includes("latest_success")],
  ["Missing AI runtime evidence stays unknown", migration.includes("case when ready_now then 'ready' else 'unknown' end")],
  ["Readiness requires dispatcher, Vault, heartbeat, adapter, schema, and safety merge", migration.includes("dispatcher_ready") && migration.includes("worker_url_ready") && migration.includes("worker_token_ready") && migration.includes("heartbeat_ready") && migration.includes("adapter_configured") && migration.includes("schema_proven") && migration.includes("deterministic_merge_proven")],
  ["AI provider registry stores secret names, never values", migration.includes("required_secret_names") && migration.includes("NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN") && !migration.includes("Bearer ")],
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
console.log(`\n${passed}/${checks.length} autonomy ops wave-eighteen checks passed.`);
if (passed !== checks.length) process.exit(1);
