import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/119_automatic_project_infrastructure_after_approval.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/provision-project-infrastructure/index.ts', 'utf8');

const checks = [
  ['Workspace completion automatically queues infrastructure', migration.includes("new.job_type <> 'ensure_project_workspace'") && migration.includes("'provision_project_infrastructure'")],
  ['Infrastructure job is routed to Edge execution', migration.includes("'execution_target', 'edge'") && migration.includes("'requires_external_worker', true")],
  ['Owner approval is required before queueing', migration.includes("request_type = 'website_setup_review'") && migration.includes("status = 'accepted'")],
  ['Denied/archived/dormant clients cancel downstream automation', migration.includes("in ('denied','archived','dormant')") && migration.includes("execution_target in ('edge','ai')")],
  ['Infrastructure job is idempotent per project', migration.includes("'project:' || project_uuid::text || ':provision-infrastructure:v1'")],
  ['Worker claims only project infrastructure jobs', worker.includes('target_job_types: ["provision_project_infrastructure"]')],
  ['Worker independently rechecks accepted owner approval', worker.includes('.eq("request_type", "website_setup_review")') && worker.includes('.eq("status", "accepted")')],
  ['Worker independently blocks ineligible client states', worker.includes('["approved", "active"]')],
  ['Business family uses dedicated protected template config', worker.includes('NXQ_BUSINESS_TEMPLATE_OWNER') && worker.includes('NXQ_BUSINESS_TEMPLATE_REPO')],
  ['Generated GitHub repository is private', /private:\s*true/.test(worker)],
  ['Repository name includes project identity to avoid collisions', worker.includes('projectId.slice(0, 8)')],
  ['GitHub resource is checkpointed before continuing', worker.includes('github_repository_ready') && worker.includes('github_full_name')],
  ['Netlify private GitHub installation binding is required', worker.includes('NETLIFY_GITHUB_INSTALLATION_ID') && worker.includes('installation_id: installationId') && worker.includes('public_repo: false')],
  ['Netlify resource is checkpointed before continuing', worker.includes('netlify_site_ready') && worker.includes('netlify_site_id')],
  ['Shared project deployment config is reused', worker.includes('project_deployment_configs') && worker.includes('auto_publish_locked: true')],
  ['Per-client public environment is provisioned', worker.includes('VITE_NXQ_CLIENT_ID') && worker.includes('VITE_NXQ_PROJECT_ID') && worker.includes('VITE_NXQ_PRODUCT_FAMILY')],
  ['External retry system handles failures', worker.includes('fail_external_automation_job')],
  ['Successful infrastructure job completes shared automation job', worker.includes('complete_external_automation_job') && worker.includes('infrastructure_ready')],
  ['Production auto-publish remains disabled', worker.includes('production_publish_automatic: false') && worker.includes('auto_publish_locked: true')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} project infrastructure contract checks passed.`);
if (failed) process.exit(1);
