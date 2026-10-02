import fs from 'node:fs';

const migrationPath = 'supabase/migrations/118_route_automation_jobs_by_execution_target.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');

const checks = [
  ['Execution target column exists', sql.includes("add column if not exists execution_target text not null default 'backend'")],
  ['Execution targets are constrained', sql.includes("check (execution_target in ('backend','edge','ai'))")],
  ['AI build-plan jobs route to AI', sql.includes("new.job_type = 'prepare_build_plan'") && sql.includes("new.execution_target := 'ai'")],
  ['Website/provision jobs route to Edge', sql.includes("new.job_type like 'website\\_%'") && sql.includes("new.job_type like 'provision\\_%'") && sql.includes("new.execution_target := 'edge'")],
  ['Database worker claims backend only', sql.includes("where j.execution_target = 'backend'")],
  ['External claim permits Edge or AI only', sql.includes("target_execution_target not in ('edge','ai')")],
  ['External claim uses row locking', sql.includes('for update of j skip locked')],
  ['External claim respects automation pause', sql.includes('not coalesce(controls.automation_paused, false)')],
  ['External completion verifies worker ownership', sql.includes("status = 'running'") && sql.includes('locked_by = worker_name')],
  ['External failures use bounded retry delay', sql.includes("status = case when attempts >= max_attempts then 'failed' else 'queued' end") && sql.includes('least(60, greatest(5, attempts * 5))')],
  ['Exhausted external jobs escalate', sql.includes("'External automation job needs owner attention'") && sql.includes("'automation_job_exhausted'" )],
  ['External worker RPCs are service-role only', sql.includes('grant execute on function public.claim_next_external_automation_job(text, text, text[]) to service_role') && sql.includes('from public, anon, authenticated')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

console.log(`\n${checks.length - failed}/${checks.length} automation routing checks passed.`);
if (failed) process.exit(1);
