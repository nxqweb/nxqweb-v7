import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const seo=read("supabase/migrations/147_business_seo_operations_foundation.sql");
const seoPage=read("src/pages/ClientBusinessSeo.tsx");
const app=read("src/App.tsx");
const providers=read("supabase/migrations/150_owner_provider_recheck_controls.sql");
const providerPage=read("src/pages/OwnerProviderHealth.tsx");
const drill=read("supabase/functions/run-backup-restore-drill/index.ts");
const drillSchedule=read("supabase/migrations/151_schedule_backup_restore_drills.sql");
const files=read("src/pages/OwnerFiles.tsx");
const checks=[
  ["SEO issue queue tracks evidence and safe-fix state",seo.includes("business_seo_issues")&&seo.includes("evidence jsonb")&&seo.includes("auto_fixable")],
  ["SEO artifacts track sitemap/schema state",seo.includes("project_seo_artifacts")&&seo.includes("artifact_type")&&seo.includes("local_business_schema")],
  ["Location page generation queues project SEO refresh",seo.includes("website_project_seo_refresh")],
  ["Client SEO Center reads tenant-scoped SEO state",seoPage.includes("business_seo_issues")&&seoPage.includes("project_seo_artifacts")],
  ["Client SEO route is wired",app.includes("/client/business/seo")&&app.includes("ClientBusinessSeo")],
  ["Provider recheck requires owner identity",providers.includes("Owner access required")&&providers.includes("owner_request_provider_recheck")],
  ["Provider controls never mutate secret values",!providers.toLowerCase().includes("secret_value")&&!providers.includes("decrypted_secret")],
  ["Owner provider UI supports recheck and disable",providerPage.includes("owner_request_provider_recheck")&&providerPage.includes("owner_set_provider_enabled")],
  ["Recovery drill only targets verified published deployments",drill.includes("last_deployment_status\",\"published")&&drill.includes("last_deployed_commit")],
  ["Recovery drill is explicitly non-destructive",drill.includes("external_changes_made:false")&&drill.includes("simulate_project_restore")],
  ["Recovery drill refreshes launch readiness",drill.includes("evaluate_launch_readiness")],
  ["Recovery drill runs weekly from Vault",drillSchedule.includes("17 3 * * 0")&&drillSchedule.includes("vault.decrypted_secrets")],
  ["Owner file access requires clean released scan",files.includes("scan?.status === \"clean\"")&&files.includes("scan.quarantine_status === \"released\"")],
  ["Quarantined owner file actions are disabled",files.includes("disabled={isBusy || !released}")&&files.includes("Quarantined")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-three checks passed.`);if(passed!==checks.length)process.exit(1);
