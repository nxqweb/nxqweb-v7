import fs from 'node:fs';

const workerPath = 'supabase/functions/provision-storefront/index.ts';
const gateMigrationPath = 'supabase/migrations/113_harden_storefront_provisioning_gates.sql';
const legacyMigrationPath = 'supabase/migrations/117_cancel_legacy_unapproved_storefront_jobs.sql';

const worker = fs.readFileSync(workerPath, 'utf8');
const gates = fs.readFileSync(gateMigrationPath, 'utf8');
const legacy = fs.readFileSync(legacyMigrationPath, 'utf8');

const checks = [
  ['GitHub App authentication required', worker.includes('GITHUB_APP_ID') && worker.includes('GITHUB_APP_INSTALLATION_ID') && worker.includes('GITHUB_APP_PRIVATE_KEY')],
  ['GitHub App key accepts PKCS1 or PKCS8', worker.includes('normalizeGithubPrivateKey') && worker.includes('BEGIN RSA PRIVATE KEY') && worker.includes('BEGIN PRIVATE KEY') && worker.includes('normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY"))')],
  ['Protected background worker authentication supported', worker.includes('x-nxq-worker-token') && worker.includes('NXQ_AUTOMATION_WORKER_TOKEN') && worker.includes('protectedTokenMatches') && worker.includes('workerAuthorized')],
  ['Owner session remains supported as guarded fallback', worker.includes('if (!workerAuthorized)') && worker.includes('owner_users') && worker.includes('Owner access required')],
  ['Template repository generation used', worker.includes('/generate') && worker.includes('GITHUB_TEMPLATE_OWNER') && worker.includes('GITHUB_TEMPLATE_REPO')],
  ['Generated client repository is private', /private:\s*true/.test(worker)],
  ['Repository creation is idempotent', worker.includes('existingResponse.ok') && worker.includes('existingResponse.status !== 404')],
  ['Netlify GitHub installation binding required', worker.includes('NETLIFY_GITHUB_INSTALLATION_ID') && worker.includes('installation_id: installationId')],
  ['Netlify treats generated repo as private', worker.includes('public_repo: false')],
  ['Netlify build command is explicit', worker.includes('cmd: "npm run build"') && worker.includes('dir: "dist"')],
  ['Storefront env contract matches template', worker.includes('VITE_NXQ_STOREFRONT_SLUG: storefront.store_slug') && !worker.includes('VITE_STOREFRONT_SLUG: storefront.store_slug')],
  ['Public Supabase env is provisioned', worker.includes('VITE_SUPABASE_URL') && worker.includes('VITE_SUPABASE_ANON_KEY')],
  ['Worker independently checks accepted owner approval', worker.includes('.eq("request_type", "website_setup_review")') && worker.includes('.eq("status", "accepted")')],
  ['Denied/archived/dormant clients blocked', worker.includes('["denied", "archived", "dormant"]')],
  ['Preview worker cannot silently publish production', worker.includes('production_publish_required') && worker.includes('production_publish_automatic: false') && worker.includes('guarded production workflow')],
  ['Queue requires owner approval', gates.includes("a.request_type = 'website_setup_review'") && gates.includes("a.status = 'accepted'") && gates.includes("'owner_approval_required'" )],
  ['Known QA client is permanently marked QA-only', gates.includes('qa_only = true') && gates.includes('ca1d8990-7e66-4bb6-96c1-8346813e708b')],
  ['QA launch approval is blocked', gates.includes('QA storefronts are permanently blocked from production launch.')],
  ['Provisioning claim only takes queued preview work', gates.includes("where status = 'queued'") && !/where status in \([^)]*launch_approved/i.test(gates)],
  ['Retry clears stale Netlify build checkpoint', gates.includes("- 'netlify_build_triggered_at'") && gates.includes("- 'netlify_build_id'")],
  ['Legacy unapproved jobs are handled by forward migration', legacy.includes('owner_approval_requests') && legacy.includes('website_setup_review')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

console.log(`\n${checks.length - failed}/${checks.length} provisioning contract checks passed.`);
if (failed) process.exit(1);
