import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/126_internal_website_maintenance_execution.sql', 'utf8');
const lockFix = fs.readFileSync('supabase/migrations/213_fix_maintenance_outer_join_lock.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/run-website-maintenance/index.ts', 'utf8');

const checks = [
  ['Internal safe maintenance types are auto-queued', migration.includes('activate_internal_maintenance_task') && migration.includes("'uptime_check','ssl_check','form_test','broken_link_scan'")],
  ['Maintenance claims lock only the task row across nullable joins', lockFix.includes('left join public.client_automation_controls') && lockFix.includes('for update of t skip locked') && !lockFix.includes('\n  for update skip locked\n')],
  ['Maintenance lock repair preserves service-role-only execution', lockFix.includes('revoke all on function public.claim_next_website_maintenance_task(text) from public, anon, authenticated') && lockFix.includes('grant execute on function public.claim_next_website_maintenance_task(text) to service_role')],
  ['Automation pause is respected', lockFix.includes('automation_paused') && lockFix.includes('automation_enabled')],
  ['Maintenance worker ownership is verified', migration.includes("coalesce(task_row.result->>'worker_name', '') <> worker_name")],
  ['Failures use bounded exponential retry delay', migration.includes('power(2') && migration.includes('least(60')],
  ['Retry exhaustion creates owner exception alert', migration.includes('website_maintenance_alerts') && migration.includes('maintenance_retry_exhausted')],
  ['Critical checks escalate more strongly', migration.includes("task_row.task_type in ('uptime_check','ssl_check') then 'high'")],
  ['Dispatcher uses cron, pg_net, and Vault', migration.includes('pg_cron') && migration.includes('pg_net') && migration.includes('vault.decrypted_secrets')],
  ['Maintenance worker URL and token are protected in Vault', migration.includes('nxq_maintenance_edge_url') && migration.includes('nxq_automation_worker_token')],
  ['Worker accepts only protected automation token', worker.includes('x-nxq-worker-token') && worker.includes('Trusted automation access required')],
  ['Monitored URLs must use HTTPS', worker.includes('requireHttpsUrl') && worker.includes('Maintenance requires an HTTPS monitored URL')],
  ['Uptime check records status and latency', worker.includes('status_code') && worker.includes('response_ms')],
  ['SSL check admits certificate-expiry limitation', worker.includes('certificate_expiry_checked: false') && worker.includes('requires a connected certificate/provider API')],
  ['Form check does not submit real forms', worker.includes('real_form_submission_performed: false')],
  ['Broken-link scan is bounded', worker.includes('links.size < 20') && worker.includes('scan_limit: 20')],
  ['Security scan is explicitly non-destructive', worker.includes('destructive_scan_performed: false') && worker.includes('not a penetration test')],
  ['SEO check verifies title description H1 and noindex', worker.includes('title_present') && worker.includes('description_present') && worker.includes('h1_present') && worker.includes('noindex_detected')],
  ['Backup check verifies GitHub production branch commit', worker.includes('repository_verified: true') && worker.includes('actual_commit') && worker.includes('last_production_commit')],
  ['Monthly report is generated from real maintenance task records', worker.includes('generated_from_real_checks: true') && worker.includes('website_monthly_reports')],
  ['Unhealthy uptime SSL backup checks enter retry path', worker.includes('["uptime_check", "ssl_check", "backup_check"].includes(task.task_type)')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}

console.log(`\n${checks.length - failed}/${checks.length} maintenance/recovery contract checks passed.`);
if (failed) process.exit(1);
