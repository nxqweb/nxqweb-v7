import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/226_owner_launch_readiness_signoff.sql", "utf8");
const ui = fs.readFileSync("src/pages/OwnerLaunchReadiness.tsx", "utf8");

const checks = [
  ["Launch signoff requires an authenticated owner", migration.includes("auth.role()<>'authenticated'") && migration.includes("ou.auth_user_id=auth.uid()")],
  ["Launch signoff requires an exact confirmation phrase", migration.includes("APPROVE-NXQ-AUTONOMOUS-LAUNCH")],
  ["Every other required readiness check must be ready", migration.includes("check_key <> 'owner_launch_signoff'") && migration.includes("status <> 'ready'")],
  ["Concurrent signoff attempts are serialized", migration.includes("pg_advisory_xact_lock")],
  ["Service role cannot make the human decision", migration.includes("authenticated,service_role") && /grant execute on function public\.owner_approve_nxq_launch_readiness\(text\)\s+to authenticated/.test(migration)],
  ["Readiness regression invalidates stale owner approval", migration.includes("invalidate_owner_launch_signoff_on_regression") && migration.includes("required_readiness_regressed")],
  ["Signoff records audit evidence without deploying production", migration.includes("owner_nxq_launch_readiness_approved") && migration.includes("production_deployment_performed',false")],
  ["Owner UI keeps signoff disabled until prerequisites are ready", ui.includes("allPrerequisitesReady") && ui.includes("Approve autonomous launch readiness")],
  ["Owner UI uses the protected signoff RPC", ui.includes('supabase.rpc("owner_approve_nxq_launch_readiness"')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} owner launch-signoff checks passed.`);
if (failed) process.exit(1);
