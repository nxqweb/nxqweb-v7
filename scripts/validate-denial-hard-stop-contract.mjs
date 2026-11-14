import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/129_hard_stop_denied_client_pipeline.sql', 'utf8');
const infra = fs.readFileSync('supabase/functions/provision-project-infrastructure/index.ts', 'utf8');
const build = fs.readFileSync('supabase/functions/build-business-website/index.ts', 'utf8');
const production = fs.readFileSync('supabase/functions/promote-business-production/index.ts', 'utf8');

const checks = [
  ['DENY stamps durable pipeline stop state', migration.includes('pipeline_stopped_at') && migration.includes('pipeline_stop_reason')],
  ['DENY forces client status denied', migration.includes("status = 'denied'")],
  ['DENY cancels all queued/failed/blocked automation lanes', migration.includes("status in ('queued','failed','blocked')") && migration.includes("status = 'cancelled'")],
  ['DENY disables domain automation', migration.includes('automation_enabled = false') && migration.includes("automation_state = 'stopped'")],
  ['DENY disables maintenance automation', migration.includes("status = 'disabled'") && migration.includes('website_maintenance_plans')],
  ['DENY writes audit evidence', migration.includes('client_pipeline_hard_stopped')],
  ['Infrastructure worker independently blocks denied client', infra.includes('["approved", "active"]')],
  ['Business build worker independently blocks denied client', build.includes('["approved", "active"]')],
  ['Production worker independently blocks denied client', production.includes('["approved", "active"]')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} denial hard-stop checks passed.`);
if (failed) process.exit(1);