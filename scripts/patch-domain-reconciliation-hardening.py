from pathlib import Path

path = Path('supabase/functions/reconcile-domain/index.ts')
text = path.read_text()

text = text.replace('''type AutomationJob = {
  id: string;
  client_id: string;
''','''type AutomationJob = {
  id: string;
  lock_token: string;
  client_id: string;
''',1)
text = text.replace('''  if (!job.id || !job.client_id || !job.project_id) throw new Error("Domain job claim is missing job, client, or project id.");
''','''  if (!job.id || !job.lock_token || !job.client_id || !job.project_id) throw new Error("Domain job claim is missing job, lease, client, or project id.");
''',1)

anchor='''async function readJson(res: Response): Promise<JsonRecord | null> {
'''
assert anchor in text
helper='''async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

'''
text=text.replace(anchor,helper+anchor,1)
text=text.replace('await fetch(`https://api.netlify.com', 'await timedFetch(`https://api.netlify.com')

text=text.replace('admin.rpc("claim_next_external_automation_job", {','admin.rpc("claim_next_external_automation_job_v2", {')
text=text.replace('admin.rpc("complete_external_automation_job", {','admin.rpc("complete_external_automation_job_v2", {')
text=text.replace('admin.rpc("fail_external_automation_job", {','admin.rpc("fail_external_automation_job_v2", {')
text=text.replace('''        target_job_id: job.id,
        worker_name: workerName,
''','''        target_job_id: job.id,
        target_lock_token: job.lock_token,
        worker_name: workerName,
''')
text=text.replace('''      target_job_id: job.id,
      worker_name: workerName,
''','''      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
''')

# Initial domain-state persistence must succeed before SSL work.
old='''    await admin.from("client_domains").update({
      automation_state: "ssl_provisioning",
      dns_status: "checking",
      ssl_status: "provisioning",
      last_checked_at: new Date().toISOString(),
      automation_error: null,
      action_required_message: null,
    }).eq("id", domainId).eq("client_id", job.client_id);
'''
new='''    const provisioningState = await admin.from("client_domains").update({
      automation_state: "ssl_provisioning",
      dns_status: "checking",
      ssl_status: "provisioning",
      last_checked_at: new Date().toISOString(),
      automation_error: null,
      action_required_message: null,
    }).eq("id", domainId).eq("client_id", job.client_id);
    if (provisioningState.error) throw new Error(`Domain provisioning state persistence failed: ${provisioningState.error.message}`);
'''
assert old in text
text=text.replace(old,new,1)

old='''      await admin.from("client_domains").update({
        automation_state: "connected",
        dns_status: "verified",
        ssl_status: "active",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        automation_error: null,
        action_required_message: null,
      }).eq("id", domainId).eq("client_id", job.client_id);

      await admin.from("project_deployment_configs").update({ production_url: liveUrl })
        .eq("project_id", job.project_id).eq("client_id", job.client_id);

      await admin.from("website_maintenance_plans").update({ monitored_url: liveUrl, status: "active" })
        .eq("project_id", job.project_id).eq("client_id", job.client_id);
'''
new='''      const connectedState = await admin.from("client_domains").update({
        automation_state: "connected",
        dns_status: "verified",
        ssl_status: "active",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        automation_error: null,
        action_required_message: null,
      }).eq("id", domainId).eq("client_id", job.client_id);
      if (connectedState.error) throw new Error(`Connected domain state persistence failed: ${connectedState.error.message}`);

      const deploymentState = await admin.from("project_deployment_configs").update({ production_url: liveUrl })
        .eq("project_id", job.project_id).eq("client_id", job.client_id);
      if (deploymentState.error) throw new Error(`Deployment URL persistence failed: ${deploymentState.error.message}`);

      const maintenanceState = await admin.from("website_maintenance_plans").update({ monitored_url: liveUrl, status: "active" })
        .eq("project_id", job.project_id).eq("client_id", job.client_id);
      if (maintenanceState.error) throw new Error(`Maintenance URL persistence failed: ${maintenanceState.error.message}`);
'''
assert old in text
text=text.replace(old,new,1)

old='''      await admin.from("client_domains").update({
        automation_state: providerConnected ? "dns_pending" : "action_required",
        dns_status: "pending",
        ssl_status: "waiting_for_dns",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        automation_error: String(sslBody?.message || "Netlify is waiting for DNS."),
        action_required_message: actionMessage,
      }).eq("id", domainId).eq("client_id", job.client_id);
'''
new='''      const pendingState = await admin.from("client_domains").update({
        automation_state: providerConnected ? "dns_pending" : "action_required",
        dns_status: "pending",
        ssl_status: "waiting_for_dns",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        automation_error: String(sslBody?.message || "Netlify is waiting for DNS."),
        action_required_message: actionMessage,
      }).eq("id", domainId).eq("client_id", job.client_id);
      if (pendingState.error) throw new Error(`Pending DNS state persistence failed: ${pendingState.error.message}`);
'''
assert old in text
text=text.replace(old,new,1)

assert 'claim_next_external_automation_job_v2' in text
assert text.count('target_lock_token: job.lock_token') >= 3
assert 'await fetch(`https://api.netlify.com' not in text
assert 'Connected domain state persistence failed' in text
assert 'Pending DNS state persistence failed' in text
path.write_text(text)
print('Patched domain reconciliation persistence, timeouts, and token lease.')
