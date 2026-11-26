from pathlib import Path

p = Path('supabase/functions/promote-business-production/index.ts')
s = p.read_text()

old_wait = '''  const deploy = await findExactProductionDeploy(siteId, expectedCommit);
  if (!deploy) throw new Error("Exact Netlify production commit is still building.");'''
new_wait = '''  const deploy = await findExactProductionDeploy(siteId, expectedCommit);
  if (!deploy) {
    const deferred = await admin.rpc("defer_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_reason: "Exact Netlify production commit is still building.",
      retry_after: "30 seconds",
    });
    if (deferred.error) throw new Error(`Production wait deferral failed: ${deferred.error.message}`);
    return { run_id: runId, status: "production_building", deferred: true };
  }'''
if old_wait in s:
    s = s.replace(old_wait, new_wait, 1)
elif 'Production wait deferral failed:' not in s:
    raise SystemExit('Business production wait path is not in an expected state; refusing ambiguous patch.')

old_complete = '''    const completed = await admin.rpc("complete_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_result: result,
    });'''
new_complete = '''    if ("deferred" in result && result.deferred === true) {
      return response({ ok: true, job_id: job.id, ...result });
    }

    const completed = await admin.rpc("complete_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_result: result,
    });'''
if old_complete in s:
    s = s.replace(old_complete, new_complete, 1)
elif '"deferred" in result && result.deferred === true' not in s:
    raise SystemExit('Business production completion guard is not in an expected state.')

if 'if (!deploy) throw new Error("Exact Netlify production commit is still building.")' in s:
    raise SystemExit('Normal Netlify production wait still reaches the failure path.')

p.write_text(s)
print('Business production verification now defers normal provider waiting without consuming retry budget.')
