import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const migration=read("supabase/migrations/161_seo_publish_runtime_readiness_and_exceptions.sql");
const owner=read("src/pages/OwnerExceptionCenter.tsx");
const readiness=read("src/pages/OwnerLaunchReadiness.tsx");

const checks=[
  ["SEO publish lane is a required launch readiness check",migration.includes("business_seo_publish_lane_ready")&&migration.includes("Business SEO maintenance publish lane runtime healthy")&&migration.includes("true")],
  ["SEO readiness verifies the publish ledger",migration.includes("to_regclass('public.project_seo_refresh_runs')")],
  ["SEO readiness verifies active dispatcher cron",migration.includes("nxq-business-seo-artifacts-every-minute")&&migration.includes("cron.job")&&migration.includes("active")],
  ["SEO readiness verifies protected Vault configuration",migration.includes("nxq_business_seo_edge_url")&&migration.includes("nxq_automation_worker_token")&&migration.includes("vault.decrypted_secrets")],
  ["SEO readiness requires recent healthy worker heartbeat",migration.includes("worker_key='build-business-seo-artifacts'")&&migration.includes("status='healthy'")&&migration.includes("heartbeat_at")&&migration.includes("interval '15 minutes'")],
  ["Missing SEO runtime evidence never reports ready",migration.includes("status=case when ready_now then 'ready' else 'unknown' end")],
  ["SEO readiness reevaluates automatically",migration.includes("nxq-seo-publish-readiness-every-five-minutes")&&migration.includes("*/5 * * * *")],
  ["Blocked and failed SEO publish runs enter owner attention counts",migration.includes("project_seo_refresh_runs r")&&migration.includes("r.status in ('blocked','failed')")&&migration.includes("seo_publish_exceptions")],
  ["Healthy client count excludes stuck SEO publishing",migration.includes("not exists(select 1 from public.project_seo_refresh_runs r where r.client_id=c.id and r.status in ('blocked','failed'))")],
  ["SEO exception payload exposes safe diagnostic evidence",migration.includes("'source','seo_publish'")&&migration.includes("'source_branch',r.source_branch")&&migration.includes("'base_main_sha',r.base_main_sha")&&migration.includes("'source_head_sha',r.source_head_sha")],
  ["Owner exception RPC remains owner-gated",migration.includes("owner_users.auth_user_id=auth.uid()")&&migration.includes("Owner access required")],
  ["Owner Exception Center accepts non-legacy exception sources",owner.includes('source: "maintenance" | "automation" | string')],
  ["Launch readiness UI automatically renders new required checks",readiness.includes('checks.map((check)')&&readiness.includes('check.required')&&readiness.includes('check.status === "ready"')],
];

let passed=0;
for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}
console.log(`\n${passed}/${checks.length} autonomy ops wave-ten checks passed.`);
if(passed!==checks.length)process.exit(1);
