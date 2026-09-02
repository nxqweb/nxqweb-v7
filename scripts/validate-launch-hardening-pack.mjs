import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const config = read("src/lib/appConfig.ts");
const domainPage = read("src/pages/ClientDomainStatus.tsx");
const portal = read("src/pages/ClientPortal.tsx");
const migration = read("supabase/migrations/231_enforce_client_owned_domain_policy.sql");
const architecture = read("supabase/migrations/243_launch_architecture_freeze_tiers_economics_intelligence.sql");
const runbook = read("docs/LAUNCH_HARDENING_CHECKLIST.md");

const checks = [
  ["brand name is environment-configurable", config.includes("VITE_COMPANY_NAME") && config.includes("VITE_PRODUCT_NAME")],
  ["support address is environment-configurable", config.includes("VITE_SUPPORT_EMAIL")],
  ["domain policy is centralized", config.includes("clientDomainPolicy") && config.includes('ownership: "client_owned"')],
  ["client UI says NXQ never owns domains", domainPage.includes("does not sell, register, own, renew")],
  ["client retains registrar access", portal.includes("registrar access") && portal.includes("registrar password")],
  ["database restricts domains to client-owned", migration.includes("domain_type = 'client_owned'")],
  ["database requires ownership confirmation", migration.includes("ownership_confirmed is true")],
  ["database trigger guards future writes", migration.includes("before insert or update of domain_type, ownership_confirmed")],
  ["trigger is unavailable to browser roles", migration.includes("from public, anon, authenticated")],
  ["runbook separates proved and external checks", runbook.includes("Proved locally or in staging") && runbook.includes("Externally blocked or credential-dependent")],
  ["runbook preserves owner production approval", runbook.includes("Explicit owner production-launch approval")],
  ["runbook prohibits fake provider evidence", runbook.includes("Never use placeholder secrets")],

  ["Business tiers retain the canonical 50/100/150/custom shape", architecture.includes("('business','starter'") && architecture.includes("('business','growth'") && architecture.includes("('business','intelligence'") && architecture.includes("('business','enterprise'")],
  ["Starter is a managed five-page foundation", architecture.includes("'managed_website',true,jsonb_build_object('core_pages',5)")],
  ["Growth gets conversion tracking without mouse tracking", architecture.includes("('business','growth','event_conversion_tracking',true") && architecture.includes("('business','growth','mouse_tracking',false")],
  ["Intelligence gets consent-gated behavior intelligence", architecture.includes("('business','intelligence','mouse_tracking',true") && architecture.includes("'sensitive_field_capture',false") && architecture.includes("('business','intelligence','behavior_heatmaps',true")],
  ["Enterprise gets multi-location and custom integration capabilities", architecture.includes("('business','enterprise','multi_location',true") && architecture.includes("('business','enterprise','custom_integrations',true")],

  ["economic policy targets 90-95 percent and floors at 85", architecture.includes("preferred_margin_percent numeric(5,2) not null default 95") && architecture.includes("target_margin_percent numeric(5,2) not null default 90") && architecture.includes("minimum_margin_percent numeric(5,2) not null default 85")],
  ["usage top-up is exactly ten dollars for nine dollars usable", architecture.includes("amount_paid_cents integer not null check(amount_paid_cents=1000)") && architecture.includes("usable_credit_cents integer not null check(usable_credit_cents=900)")],
  ["usage top-up can never recur or auto-refill", architecture.includes("recurring boolean not null default false check(recurring=false)") && architecture.includes("auto_refill boolean not null default false check(auto_refill=false)")],
  ["paid usage credit carries separately from tier entitlements", architecture.includes("nxq_usage_credit_ledger") && architecture.includes("Usage-only carryover ledger") && !architecture.includes("update public.nxq_tier_entitlements set")],
  ["economic reservation occurs before provider use", architecture.includes("nxq_reserve_economic_usage") && architecture.includes("usage_credit_required") && architecture.includes("Economic policy missing; deny by default")],
  ["Enterprise economics use the client's approved monthly price", architecture.includes("cl.monthly_price") && architecture.includes("custom_price_driven")],
  ["old flat forty-dollar contribution model is replaced", architecture.includes("90% target / 85% floor") && !architecture.includes("minimum_monthly_contribution_before_referral_credits',40")],

  ["universal event timeline prohibits sensitive payload claims", architecture.includes("nxq_platform_events") && architecture.includes("sensitive_data_present boolean not null default false check(sensitive_data_present=false)")],
  ["behavior telemetry requires consent and forbids sensitive field capture", architecture.includes("consent_record_id uuid not null") && architecture.includes("sensitive_field_capture boolean not null default false check(sensitive_field_capture=false)")],
  ["optimization findings separate evidence, impact and safety class", architecture.includes("nxq_optimization_findings") && architecture.includes("expected_impact") && architecture.includes("safety_class")],
  ["experiments require a production-change guard by default", architecture.includes("production_change_guard_required boolean not null default true")],
  ["automation jobs have idempotency, retries, review and dead-letter states", architecture.includes("nxq_automation_jobs_v2") && architecture.includes("idempotency_key text not null unique") && architecture.includes("'needs_review'") && architecture.includes("'dead_letter'")],
  ["provider registry stores no secret values", architecture.includes("secret_values_stored_here boolean not null default false check(secret_values_stored_here=false)")],
  ["external and high-risk features start disabled", architecture.includes("('behavior_tracking',false,false,false,false)") && architecture.includes("('ai_optimization',false,false,false,false)") && architecture.includes("('paid_usage_topups',false,false,false,false)")],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} launch-hardening checks passed.`);
if (failed) process.exit(1);
