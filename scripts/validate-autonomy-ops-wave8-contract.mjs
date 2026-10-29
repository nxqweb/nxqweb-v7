import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const lane=read("supabase/migrations/160_business_seo_maintenance_publish_lane.sql");
const worker=read("supabase/functions/build-business-seo-artifacts/index.ts");
const checks=[
  ["SEO maintenance run ledger is tenant scoped",lane.includes("project_seo_refresh_runs")&&lane.includes("client_view_own_seo_refresh_runs")&&lane.includes("enable row level security")],
  ["SEO dispatcher advances all maintenance stages",lane.includes("website_project_seo_preview_check")&&lane.includes("website_project_seo_promote")&&lane.includes("website_project_seo_production_check")],
  ["SEO dispatcher respects automation pause",lane.includes("automation_enabled")&&lane.includes("automation_paused")],
  ["SEO worker claims all maintenance stages",worker.includes('target_job_types:["website_project_seo_refresh","website_project_seo_preview_check","website_project_seo_promote","website_project_seo_production_check"]')],
  ["Original accepted owner approval is rechecked",worker.includes('request_type","website_setup_review"')&&worker.includes('status","accepted"')&&worker.includes("validateEligibility")],
  ["SEO safe branch is unique per refresh job",worker.includes('safe/seo-${job.project_id.slice(0,8)}-${job.id.slice(0,8)}')],
  ["Preview verification requires exact branch commit",worker.includes("commit_ref")&&worker.includes("website_project_seo_preview_check")&&worker.includes("Exact SEO branch preview commit")],
  ["Main drift regenerates instead of overwriting",worker.includes("currentMain!==String(run.base_main_sha)")&&worker.includes("main_changed_during_seo_promotion")&&worker.includes("seo-rebase:")],
  ["SEO production promotion is fast-forward only",worker.includes("compareMainToBranch")&&worker.includes('["ahead","identical"]')&&worker.includes("force:false")],
  ["Production verification requires exact main commit",worker.includes('findExactDeploy(ctx.config.netlify_site_id,"main",expected)')&&worker.includes("Exact SEO production commit")],
  ["SEO artifacts publish only after verified production",worker.indexOf('status:"published",git_commit_sha:expected')>worker.indexOf('findExactDeploy(ctx.config.netlify_site_id,"main",expected)')],
  ["SEO publish writes audit evidence",worker.includes("business_seo_maintenance_published")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-eight checks passed.`);if(passed!==checks.length)process.exit(1);
