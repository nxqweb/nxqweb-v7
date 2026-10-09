import fs from 'node:fs';

const worker = fs.readFileSync('supabase/functions/prepare-build-plan/index.ts', 'utf8');
const recovery = fs.readFileSync('supabase/migrations/214_recover_signed_setup_build_plan_jobs.sql', 'utf8');

const checks = [
  ['Build-plan worker reads current signed setup report', worker.includes('parseSignedSetupReport') && worker.includes('NXQ WEB WEBSITE SETUP REPORT')],
  ['Current setup services bridge into build planning', worker.includes('Services / products') && worker.includes('legacyServices')],
  ['Current setup positioning bridges into goals', worker.includes('Brand difference / positioning')],
  ['Current setup style bridges into desired style', worker.includes('Style direction')],
  ['Legacy client intake remains preferred when populated', worker.includes('legacyServices.length > 0') && worker.includes('clean(intake.goals) ||') && worker.includes('clean(intake.desired_style) ||')],
  ['Recovery targets only prepare_build_plan AI jobs', recovery.includes("j.job_type = 'prepare_build_plan'") && recovery.includes("j.execution_target = 'ai'")],
  ['Recovery is restricted to exact historical handoff error', recovery.includes("j.last_error = 'Approved intake is missing required Business build-plan content.'")],
  ['Recovery requires approved client and accepted setup approval', recovery.includes("c.status::text in ('approved', 'active')") && recovery.includes("ar.status::text = 'accepted'")],
  ['Recovery requires signed current setup report', recovery.includes("coalesce(c.notes, '') like 'NXQ WEB WEBSITE SETUP REPORT%'")],
  ['Recovery resets retry budget and stale ownership', recovery.includes('attempts = 0') && recovery.includes('locked_at = null') && recovery.includes('locked_by = null') && recovery.includes('lock_token = null')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} current setup/build-plan handoff checks passed.`);
if (failed) process.exit(1);
