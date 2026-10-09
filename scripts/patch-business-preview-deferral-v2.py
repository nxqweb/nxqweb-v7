from pathlib import Path

p = Path('supabase/functions/build-business-website/index.ts')
s = p.read_text()

old_wait = '''  const deploy = await findReadyBranchDeploy(siteId, branch);
  if (!deploy) throw new Error("Netlify preview is still building.");'''
new_wait = '''  const deploy = await findReadyBranchDeploy(siteId, branch);
  if (!deploy) {
    const deferred = await admin.rpc("defer_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_reason: "Netlify preview is still building.",
      retry_after: "30 seconds",
    });
    if (deferred.error) throw new Error(`Preview wait deferral failed: ${deferred.error.message}`);
    return { run_id: runId, status: "preview_building", deferred: true };
  }'''
if old_wait in s:
    s = s.replace(old_wait, new_wait, 1)
elif 'defer_external_automation_job' not in s:
    raise SystemExit('Business preview wait path is not in an expected state; refusing ambiguous patch.')

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
    raise SystemExit('Business preview completion guard is not in an expected state.')

if 'if (!deploy) throw new Error("Netlify preview is still building.")' in s:
    raise SystemExit('Normal Netlify preview wait still reaches the failure path.')

p.write_text(s)
print('Business preview waiting now defers cleanly without consuming retry budget.')
