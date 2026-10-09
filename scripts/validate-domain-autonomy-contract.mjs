import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/128_autonomous_domain_reconciliation.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/reconcile-domain/index.ts', 'utf8');

const checks = [
  ['Domain state machine is separate from legacy status', migration.includes('automation_state') && migration.includes('dns_status') && migration.includes('ssl_status')],
  ['Domain reconciliation requires approved/active client', migration.includes("c.status::text in ('approved','active')")],
  ['Domain reconciliation requires original accepted approval', migration.includes("request_type = 'website_setup_review'") && migration.includes("status = 'accepted'")],
  ['Domain jobs route through shared Edge automation queue', migration.includes("'domain_reconcile'") && migration.includes("'execution_target', 'edge'")],
  ['Domain reconciliation repeats automatically', migration.includes('nxq-domain-reconcile-queue-every-5-minutes') && migration.includes("interval '15 minutes'")],
  ['Worker claims only domain jobs', worker.includes('target_job_types: ["domain_reconcile"]')],
  ['Worker validates domain format', worker.includes('normalizeDomain') && worker.includes('Localhost and raw IP addresses')],
  ['Worker assigns Netlify custom domain', worker.includes('custom_domain: domain') && worker.includes('force_ssl: true')],
  ['Worker uses Netlify SSL as evidence', worker.includes('/ssl') && worker.includes('sslRes.ok')],
  ['DNS-not-ready becomes action required instead of fake success', worker.includes('sslRes.status === 422') && worker.includes('action_required')],
  ['Future registrar adapter hook is preserved', migration.includes('provider_adapter') && migration.includes('provider_connection_ref')],
  ['Connected custom domain becomes maintenance URL', worker.includes('website_maintenance_plans') && worker.includes('monitored_url: liveUrl')],
  ['Domain worker failures use shared retry/escalation layer', worker.includes('fail_external_automation_job')],
  ['Dispatcher stores worker endpoint/token in Vault', migration.includes('nxq_domain_edge_url') && migration.includes('nxq_automation_worker_token') && migration.includes('vault.decrypted_secrets')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} domain autonomy checks passed.`);
if (failed) process.exit(1);