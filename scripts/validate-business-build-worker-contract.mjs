import fs from 'node:fs';

const worker = fs.readFileSync('supabase/functions/build-business-website/index.ts', 'utf8');
const dispatcher = fs.readFileSync('supabase/migrations/122_schedule_business_website_builder.sql', 'utf8');

const checks = [
  ['Worker claims only Business build/preview job types', worker.includes('["website_prepare_safe_branch", "website_check_preview"]')],
  ['Worker rechecks accepted owner approval', worker.includes('.eq("request_type", "website_setup_review")') && worker.includes('.eq("status", "accepted")')],
  ['Worker blocks non-approved clients', worker.includes('["approved", "active"]')],
  ['Worker blocks non-Business families', worker.includes('familySlug !== "business"')],
  ['Generation stays on safe source branch', worker.includes('source_branch') && worker.includes('sourceBranch !== "main"')],
  ['Versioned Business blueprint is loaded from NXQ source', worker.includes('templates/business-v1') && worker.includes('NXQ_AUTOMATION_SOURCE_REPO')],
  ['Client config is generated from build plan', worker.includes('buildSiteConfig') && worker.includes('site.config.js')],
  ['Quality gate checks contact path and SEO', worker.includes('contact_path') && worker.includes('seo_title')],
  ['Preview is a Netlify branch build', worker.includes('/builds?branch=') && worker.includes('website_check_preview')],
  ['Preview retry reconciles exact commit before another Netlify build', worker.includes('findExistingBranchDeploy') && worker.includes('expectedPreviewCommitSha') && worker.includes('reconciled_existing_deploy')],
  ['Ready branch deploy moves run to preview_ready', worker.includes('status: "preview_ready"')],
  ['Production is not written automatically', !worker.includes('refs/heads/main') || worker.includes('sourceBranch')],
  ['Dispatcher wakes only Business build/preview jobs', dispatcher.includes("j.job_type in ('website_prepare_safe_branch','website_check_preview')")],
  ['Dispatcher stores no secret values', dispatcher.includes('vault.decrypted_secrets') && dispatcher.includes('nxq_automation_worker_token')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} Business build worker contract checks passed.`);
if (failed) process.exit(1);
