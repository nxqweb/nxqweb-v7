import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/234_netlify_deployment_credit_guard.sql", "utf8");
const preview = fs.readFileSync("supabase/functions/build-business-website/index.ts", "utf8");
const production = fs.readFileSync("supabase/functions/promote-business-production/index.ts", "utf8");
const seo = fs.readFileSync("supabase/functions/build-business-seo-artifacts/index.ts", "utf8");
const manual = fs.readFileSync("supabase/functions/execute-production-netlify-build/index.ts", "utf8");

const previewBlock = preview.slice(preview.indexOf("let build = await findExistingBranchDeploy"), preview.indexOf("const checkJobId", preview.indexOf("let build = await findExistingBranchDeploy")));
const productionBlock = production.slice(production.indexOf("let build = await findExistingProductionDeploy"), production.indexOf("const checkJobId", production.indexOf("let build = await findExistingProductionDeploy")));

const checks = [
  ["budget settings include emergency stop", migration.includes("emergency_stop boolean not null default false")],
  ["cycle-wide build limit is enforced", migration.includes("total_used >= settings_row.max_builds_per_cycle")],
  ["disposable QA build limit is enforced", migration.includes("qa_used >= settings_row.max_qa_builds_per_cycle")],
  ["reservation keys are unique", migration.includes("reservation_key text not null unique")],
  ["reservation uses an advisory transaction lock", migration.includes("pg_advisory_xact_lock")],
  ["reservation is service-role only", migration.includes("auth.role() <> 'service_role'")],
  ["owner-only settings override exists", migration.includes("owner_update_netlify_budget_settings") && migration.includes("if not public.is_nxq_owner()")],
  ["owner budget status exists", migration.includes("owner_netlify_budget_status")],
  ["preview reconciles before reserving", previewBlock.indexOf("findExistingBranchDeploy") < previewBlock.indexOf("reserveNetlifyBuild")],
  ["preview reserves before provider trigger", previewBlock.indexOf("reserveNetlifyBuild") < previewBlock.indexOf("triggerBranchBuild")],
  ["production reconciles before reserving", productionBlock.indexOf("findExistingProductionDeploy") < productionBlock.indexOf("reserveNetlifyBuild")],
  ["production reserves before provider trigger", productionBlock.indexOf("reserveNetlifyBuild") < productionBlock.indexOf("triggerProductionBuild")],
  ["SEO preview and production builds reserve", seo.includes('reserveNetlifyBuild(admin,job,"seo_preview"') && seo.includes('reserveNetlifyBuild(admin,job,"seo_production"')],
  ["SEO production reserves before main mutation", seo.indexOf('reserveNetlifyBuild(admin,job,"seo_production"') < seo.indexOf("fastForwardMain(ctx.config.github_owner")],
  ["manual production build reserves", manual.includes('target_build_kind: "manual_production"')],
  ["manual provider request follows reservation", manual.indexOf('target_build_kind: "manual_production"') < manual.indexOf('buildUrl.toString()')],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} Netlify budget checks passed.`);
if (failed) process.exit(1);
