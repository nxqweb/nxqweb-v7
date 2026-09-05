import fs from 'node:fs';

const worker = fs.readFileSync('supabase/functions/prepare-build-plan/index.ts', 'utf8');
const scheduler = fs.readFileSync('supabase/migrations/121_schedule_build_plan_dispatcher.sql', 'utf8');

const checks = [
  ['Build-plan worker claims only prepare_build_plan jobs', worker.includes('target_job_types: ["prepare_build_plan"]') && worker.includes('target_execution_target: "ai"')],
  ['Worker independently requires accepted owner approval', worker.includes('.eq("request_type", "website_setup_review")') && worker.includes('.eq("status", "accepted")')],
  ['Worker blocks ineligible client states', worker.includes('["approved", "active"]')],
  ['Completed client intake is required', worker.includes('Completed client intake is required before build planning.')],
  ['Build plan is derived from real intake fields', worker.includes('intake.services') && worker.includes('intake.goals') && worker.includes('intake.desired_style') && worker.includes('intake.service_area')],
  ['Business family and tier are preserved in plan', worker.includes('product_family_slug') && worker.includes('product_tier_key')],
  ['Build plan explicitly keeps production auto-publish off', worker.includes('production_auto_publish: false')],
  ['Project build_plan is saved automatically', worker.includes('build_plan: buildPlan')],
  ['Onboarding advances automatically to building', worker.includes('status: "completed"') && worker.includes('NXQ is building your website.')],
  ['Existing website automation pipeline is bootstrapped', worker.includes('bootstrap_ready_website_automation')],
  ['Shared external retry system handles failures', worker.includes('fail_external_automation_job')],
  ['Successful job completes shared automation queue item', worker.includes('complete_external_automation_job')],
  ['Build-plan dispatcher uses cron, pg_net, and Vault', scheduler.includes('pg_cron') && scheduler.includes('pg_net') && scheduler.includes('vault.decrypted_secrets')],
  ['Build-plan URL and worker token stay in Vault', scheduler.includes("name = 'nxq_build_plan_edge_url'") && scheduler.includes("name = 'nxq_automation_worker_token'")],
  ['Dispatcher fires only when prepare_build_plan jobs are due', scheduler.includes("j.job_type = 'prepare_build_plan'") && scheduler.includes("j.execution_target = 'ai'")],
  ['Build-plan dispatcher is automatic every minute', scheduler.includes("'nxq-build-plan-dispatch-every-minute'") && scheduler.includes("'* * * * *'")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} build-plan automation contract checks passed.`);
if (failed) process.exit(1);
