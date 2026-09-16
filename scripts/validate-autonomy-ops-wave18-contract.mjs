import fs from "node:fs";
import { assertGroundedMarketingClaims, findUnsupportedMarketingClaims } from "../supabase/functions/_shared/ai-grounding.mjs";

const read = (path) => fs.readFileSync(path, "utf8");
const worker = read("supabase/functions/prepare-build-plan/index.ts");
const grounding = read("supabase/functions/_shared/ai-grounding.mjs");
const builder = read("supabase/functions/build-business-website/index.ts");
const migration = read("supabase/migrations/178_business_build_plan_ai_enrichment_readiness.sql");
const app = read("templates/business-v1/app.js");
const css = read("templates/business-v1/styles.css");
const aiInputStart = worker.indexOf("const aiInput = {");
const aiInputEnd = worker.indexOf("const aiResult =", aiInputStart);
const aiInputBlock = aiInputStart >= 0 && aiInputEnd > aiInputStart ? worker.slice(aiInputStart, aiInputEnd) : "";

const styleOnlyInput = {
  business_name: "Pine Ridge Tree Care",
  business_type: "tree service",
  service_area: "Chico, California",
  services: ["tree removal", "tree trimming", "stump grinding", "emergency storm cleanup"],
  goals: "Increase quote requests",
  desired_style: "premium trustworthy modern",
};
const fabricatedStrategy = {
  positioning: "Premium trusted tree care experts in Chico",
  value_proposition: "Professional service with 24/7 response and a free quote",
  hero: { eyebrow: "Trusted Tree Care", headline: "Expert Tree Care", subheadline: "Professional help for Chico properties" },
  service_descriptions: [{ service: "tree removal", description: "Reliable professional tree removal" }],
  trust_points: ["Trusted local service"],
  about_summary: "A premium professional tree service for Chico properties.",
  seo: { title: "Trusted Tree Experts", description: "Professional tree care with a free quote and 24/7 response.", keywords: ["trusted tree service"] },
};
const fabricatedClaims = findUnsupportedMarketingClaims(fabricatedStrategy, styleOnlyInput);
let styleOnlyRejected = false;
try { assertGroundedMarketingClaims(fabricatedStrategy, styleOnlyInput); }
catch { styleOnlyRejected = true; }

const supportedInput = {
  ...styleOnlyInput,
  goals: "Licensed and insured tree service offering free estimates and 24/7 emergency response",
};
const supportedStrategy = {
  positioning: "Licensed and insured tree service in Chico",
  value_proposition: "Tree services with free estimates and 24/7 emergency response",
  hero: { eyebrow: "Tree Service", headline: "Tree Care in Chico", subheadline: "Request a free estimate for listed tree services" },
  service_descriptions: [{ service: "tree removal", description: "Tree removal for Chico properties" }],
  trust_points: ["Licensed", "Insured", "24/7 emergency response"],
  about_summary: "Pine Ridge Tree Care provides the listed tree services in Chico, California.",
  seo: { title: "Tree Service in Chico", description: "Tree removal and other listed services in Chico with free estimates.", keywords: ["tree removal"] },
};
let supportedClaimsAccepted = true;
try { assertGroundedMarketingClaims(supportedStrategy, supportedInput); }
catch { supportedClaimsAccepted = false; }

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
  ["Authoritative worker enforces deterministic marketing grounding", worker.includes('assertGroundedMarketingClaims(validated.strategy, groundingInput)') && worker.includes('deterministic_grounding_validator: "v1"')],
  ["Grounding source excludes desired style from factual support", grounding.includes("asText(input?.goals)") && !grounding.slice(0, grounding.indexOf("function claimBearingText")).includes("desired_style")],
  ["Style-only premium and trustworthy requests cannot authorize business claims", styleOnlyRejected && fabricatedClaims.includes("premium business claim") && fabricatedClaims.includes("trust or reliability claim")],
  ["Fabricated qualification, free-offer, and 24/7 claims are detected", fabricatedClaims.includes("expertise or qualification claim") && fabricatedClaims.includes("free offer") && fabricatedClaims.includes("24/7 availability")],
  ["Explicitly supplied claims remain usable", supportedClaimsAccepted],
  ["Old cached plans cannot bypass grounding validation", worker.includes('enrichment.deterministic_grounding_validator === "v1"') && worker.includes('workerVersion = "v4-grounded-ai-business"')],
  ["Business family remains backend-enforced", worker.includes('familySlug !== "business"')],
  ["Tier identity is loaded from server-side tier records", worker.includes('from("product_family_tiers")') && worker.includes("product_tier_key: tierKey")],
  ["Production auto-publish remains disabled", worker.includes("production_auto_publish: false") && worker.includes("deterministic_tier_enforcement: true")],
  ["Validated enrichment is cached by intake fingerprint", worker.includes("reusableBuildPlan") && worker.includes("adapter_response_reused")],
  ["Missing or invalid AI output uses shared retry and escalation", worker.includes("fail_external_automation_job") && !worker.includes("v2-deterministic-foundation")],
  ["Worker heartbeat proves adapter and safety-merge state", worker.includes("adapter_configured: adapterConfigured") && worker.includes("adapter_schema_version: adapterSchemaVersion") && worker.includes("deterministic_safety_merge: true") && worker.includes('deterministic_grounding_validator: "v1"')],
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
