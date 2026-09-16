import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/127_operational_health_and_exception_center.sql', 'utf8');
const owner = fs.readFileSync('src/pages/OwnerExceptionCenter.tsx', 'utf8');
const client = fs.readFileSync('src/pages/ClientWebsiteHealth.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const topCards = fs.readFileSync('src/components/ClientPortalTopCards.tsx', 'utf8');

const checks = [
  ['Owner exception RPC requires owner identity', migration.includes("Owner access required") && migration.includes('owner_users.auth_user_id = auth.uid()')],
  ['Owner summary distinguishes healthy/retrying/attention', migration.includes("'healthy_clients'") && migration.includes("'auto_retrying'") && migration.includes("'needs_owner_attention'")],
  ['Owner exception summary includes maintenance and automation failures', migration.includes("'source', 'maintenance'") && migration.includes("'source', 'automation'")],
  ['Client health resolves only current authenticated client', migration.includes('where auth_user_id = auth.uid()')],
  ['Client health exposes NXQ ID and Web client code', migration.includes("'nxq_id'") && migration.includes("'client_code'")],
  ['Client health reports deployment and maintenance independently', migration.includes("'deployment_status'") && migration.includes("'maintenance_status'")],
  ['Client health includes recent evidence-based checks', migration.includes("'recent_checks'") && migration.includes('website_maintenance_tasks')],
  ['Owner exception center uses server-side RPC', owner.includes('owner_exception_center')],
  ['Client health page uses server-side RPC', client.includes('current_client_operational_health')],
  ['Owner exception route is protected', app.includes('/owner/exceptions') && app.includes('<OwnerProtectedRoute><OwnerExceptionCenter /></OwnerProtectedRoute>')],
  ['Client health route exists', app.includes('/client/health') && app.includes('<ClientWebsiteHealth />')],
  ['Portal homepage surfaces current website health', topCards.includes('current_client_operational_health') && topCards.includes('/client/health')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} operational control surface checks passed.`);
if (failed) process.exit(1);