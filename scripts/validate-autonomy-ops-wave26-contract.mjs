import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const catalog = read("supabase/migrations/026_multi_plan_product_family_foundation.sql");
const baseEntitlements = read("supabase/migrations/130_server_side_tier_entitlements.sql");
const migration = read("supabase/migrations/186_canonical_business_tier_runtime.sql");
const worker = read("supabase/functions/build-business-website/index.ts");
const analyticsTemplate = read("templates/business-v1/analytics.js");
const dashboard = read("src/pages/ClientBusinessDashboard.tsx");
const analytics = read("src/pages/ClientBusinessAnalytics.tsx");
const ci = read(".github/workflows/ci-mega-extended.yml");

const checks = [
  ["Catalog declares the authoritative four tier keys", ["starter","growth","intelligence","enterprise"].every((key) => catalog.includes(`'${key}'`))],
  ["Fresh entitlements contain no stale Business Pro or Premium keys", !baseEntitlements.includes("('business','pro'") && !baseEntitlements.includes("('business','premium'")],
  ["Forward migration removes stale entitlement keys", migration.includes("tier_key in ('pro','premium')")],
  ["Forward migration installs all canonical Business tiers", ["starter","growth","intelligence","enterprise"].every((key) => migration.includes(`('business','${key}','managed_website'`))],
  ["Starter analytics and heatmaps remain disabled", migration.includes("('business','starter','advanced_analytics',false") && migration.includes("('business','starter','mouse_tracking',false")],
  ["Growth gets analytics without heatmaps", migration.includes("('business','growth','advanced_analytics',true") && migration.includes("('business','growth','mouse_tracking',false")],
  ["Intelligence gets advanced SEO analytics and heatmaps", ["advanced_analytics","advanced_seo","mouse_tracking"].every((feature) => migration.includes(`('business','intelligence','${feature}',true`))],
  ["Enterprise gets multi-location and all advanced features", migration.includes("('business','enterprise','multi_location',true") && migration.includes("'max_locations',100") && migration.includes("('business','enterprise','mouse_tracking',true")],
  ["Heatmaps always require consent and bounded retention", migration.includes("'consent_required',true,'retention_days',90")],
  ["Clients cannot mutate entitlement authority", migration.includes("revoke insert,update,delete on public.nxq_tier_entitlements from authenticated")],
  ["Past-due grace keeps features while frozen and terminal states fail closed", migration.includes("in ('approved','active','overdue')") && migration.includes("not in ('approved','active','overdue')")],
  ["Tier/lifecycle changes synchronize existing analytics profiles", migration.includes("sync_client_analytics_entitlements") && migration.includes("after update of product_family_id,product_tier_id,status")],
  ["Downgrades disable heatmaps immediately", migration.includes("mouse_tracking_enabled=mouse_allowed") && migration.includes("retention_days=case when mouse_allowed then 90 else 30 end")],
  ["Existing analytics profiles are repaired forward", migration.includes("update public.website_analytics_profiles profile") && migration.includes("join public.product_family_tiers tier")],
  ["Generated sites use canonical runtime tier keys", worker.includes('["growth", "intelligence", "enterprise"]') && worker.includes('["intelligence", "enterprise"]') && !worker.includes('tierKey === "premium"')],
  ["Generated analytics requires profile endpoint and key", worker.includes("advancedAnalytics && analyticsProfileEnabled") && worker.includes("analyticsEndpoint && analyticsIngestKey")],
  ["Template waits for explicit consent", analyticsTemplate.includes('consent !== "granted"') && analyticsTemplate.includes('data-nxq-consent="grant"') && analyticsTemplate.includes('data-nxq-consent="deny"')],
  ["Template never captures form values or keystrokes", !analyticsTemplate.includes("keydown") && !analyticsTemplate.includes("input.value")],
  ["Business dashboard loads server entitlements", ["advanced_analytics","advanced_seo","mouse_tracking","multi_location"].every((feature) => dashboard.includes(`target_feature_key: "${feature}"`))],
  ["Business dashboard explains active and plan-gated features", dashboard.includes("Plan upgrade") && dashboard.includes("Multi-location") && /consent-gated/i.test(dashboard)],
  ["Analytics page verifies access before loading rollups", analytics.indexOf('target_feature_key: "advanced_analytics"') < analytics.indexOf('from("website_analytics_daily_rollups")')],
  ["Analytics page hides heatpoints when mouse tracking is not entitled", analytics.includes("mouseAccess.allowed ? totals.heat") && analytics.includes("mouseAccess.allowed ? ` · Heatpoints")],
  ["Analytics empty state never fabricates data", analytics.includes("No verified rollups yet") && analytics.includes("real visits arrive")],
  ["Extended CI enforces Wave 26", ci.includes("validate-autonomy-ops-wave26-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else console.error(`FAIL  ${label}`);
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-six checks passed.`);
if (passed !== checks.length) process.exit(1);
