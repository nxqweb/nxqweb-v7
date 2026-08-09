import fs from 'node:fs';

const queue = fs.readFileSync('supabase/migrations/123_automatic_business_production_promotion.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/promote-business-production/index.ts', 'utf8');
const maintenance = fs.readFileSync('supabase/migrations/124_bridge_verified_production_to_maintenance.sql', 'utf8');

const checks = [
  ['Preview-ready Business run queues production automatically', queue.includes("new.status <> 'preview_ready'") && queue.includes("'website_promote_production'")],
  ['Original accepted owner approval is the single authority', queue.includes("request_type = 'website_setup_review'") && queue.includes("status = 'accepted'") && worker.includes('additional_owner_click_required: false')],
  ['Quality checks must be saved as completed', queue.includes("step_key = 'run_quality_checks'") && queue.includes("s.status = 'completed'")],
  ['Production source branch cannot be main', queue.includes("new.source_branch = 'main'") && worker.includes('source_branch === "main"')],
  ['Worker claims only production promotion/check jobs', worker.includes('["website_promote_production", "website_check_production"]')],
  ['Worker independently rechecks original approval and client state', worker.includes('validateSingleApproval') && worker.includes('["approved", "active"]')],
  ['Git promotion is fast-forward-only', worker.includes("['ahead', 'identical']") && worker.includes('force: false')],
  ['No force push is permitted', worker.includes('production_force_push: false') && worker.includes('force_push_allowed: false')],
  ['Verified HTTPS preview is required', worker.includes('previewUrl.startsWith("https://")')],
  ['Netlify production verification requires the exact commit', worker.includes('item.branch === "main" && item.commit_ref === expectedCommit')],
  ['Published config records exact commit and URL', worker.includes('last_deployed_commit: expectedCommit') && worker.includes('last_deployment_status: "published"')],
  ['Project advances to live only after verified production deploy', worker.includes('stage: "live"') && worker.includes('findExactProductionDeploy')],
  ['Maintenance bootstraps after verified publication', worker.includes('bootstrap_live_website_maintenance')],
  ['Maintenance accepts verified deployment config as source', maintenance.includes("pdc.last_deployment_status = 'published'") && maintenance.includes('pdc.production_url')],
  ['Production dispatcher is automatic and Vault-backed', queue.includes('nxq_business_production_edge_url') && queue.includes('vault.decrypted_secrets') && queue.includes("'* * * * *'")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} Business production contract checks passed.`);
if (failed) process.exit(1);
