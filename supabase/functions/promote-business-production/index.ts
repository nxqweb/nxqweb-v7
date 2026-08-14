import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";
import type { DynamicDatabase } from "../_shared/dynamic-database.ts";

type AutomationJob = {
  id: string;
  lock_token: string;
  client_id: string;
  project_id: string;
  job_type: string;
  payload?: Record<string, unknown> | null;
};

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient<DynamicDatabase>>;

const workerName = "promote-business-production";
const headers = { "Content-Type": "application/json" };

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeJob(value: unknown): AutomationJob | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Production claim returned an invalid job shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id || !job.project_id || !job.job_type || !job.lock_token) throw new Error("Production claim is missing required ids.");
  return job;
}

async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

const githubHeaders = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

const netlifyHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function derLength(length: number) {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derWrap(tag: number, body: Uint8Array) {
  return concatBytes(Uint8Array.of(tag), derLength(body.length), body);
}

function pemBodyBytes(pem: string) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToPem(label: string, bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  const lines = encoded.match(/.{1,64}/g)?.join('\n') || encoded;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

function normalizeGithubPrivateKey(raw: string) {
  let pem = raw.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();

  if (pem.includes('-----BEGIN PRIVATE KEY-----')) return pem;
  if (!pem.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    throw new Error('GITHUB_APP_PRIVATE_KEY must be a PKCS#8 or PKCS#1 RSA PEM private key.');
  }

  const pkcs1 = pemBodyBytes(pem);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  const privateKeyOctet = derWrap(0x04, pkcs1);
  const pkcs8 = derWrap(0x30, concatBytes(version, rsaAlgorithm, privateKeyOctet));
  return bytesToPem('PRIVATE KEY', pkcs8);
}

async function githubInstallationToken() {
  const appId = requiredSecret("GITHUB_APP_ID");
  const installationId = requiredSecret("GITHUB_APP_INSTALLATION_ID");
  const privateKey = await importPKCS8(normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY")), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .sign(privateKey);

  const res = await timedFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: githubHeaders(jwt),
    body: JSON.stringify({ permissions: { contents: "write", metadata: "read" } }),
  });
  const body = await readJson(res);
  if (!res.ok || typeof body?.token !== "string") throw new Error(`GitHub installation token failed (${res.status}).`);
  return body.token as string;
}

async function getBranchSha(owner: string, repo: string, branch: string, token: string) {
  const res = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: githubHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok || typeof body?.object?.sha !== "string") throw new Error(`GitHub branch ${branch} could not be verified.`);
  return body.object.sha as string;
}

async function verifyFastForward(owner: string, repo: string, sourceBranch: string, token: string) {
  const res = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/compare/main...${encodeURIComponent(sourceBranch)}`, {
    headers: githubHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(`GitHub compare failed (${res.status}).`);
  const status = String(body?.status || "");
  if (!['ahead', 'identical'].includes(status)) {
    throw new Error(`Production promotion requires a clean fast-forward; GitHub compare status was ${status || 'unknown'}.`);
  }
  return status;
}

async function fastForwardMain(owner: string, repo: string, sourceSha: string, token: string) {
  const res = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`, {
    method: "PATCH",
    headers: githubHeaders(token),
    body: JSON.stringify({ sha: sourceSha, force: false }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(`GitHub main fast-forward failed (${res.status}): ${String(body?.message || 'Unknown error')}`);
  return body;
}

async function triggerProductionBuild(siteId: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=main&clear_cache=true`, {
    method: "POST",
    headers: netlifyHeaders(token),
    body: "{}",
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(`Netlify production build failed to start (${res.status}): ${String(body?.message || body?.error || 'Unknown error')}`);
  return body;
}

async function findExactProductionDeploy(siteId: string, expectedCommit: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`, {
    headers: netlifyHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body)) throw new Error(`Netlify production deploy lookup failed (${res.status}).`);
  const deploy = body.find((item: JsonRecord) => item.branch === "main" && item.commit_ref === expectedCommit);
  if (!deploy) return null;
  if (deploy.state === "error") throw new Error(`Netlify production deploy failed: ${String(deploy.error_message || 'Unknown build error')}`);
  if (deploy.state !== "ready") return null;
  const url = String(deploy.ssl_url || deploy.url || deploy.deploy_ssl_url || deploy.deploy_url || "");
  if (!url.startsWith("https://")) throw new Error("Verified production deploy did not return an HTTPS URL.");
  return { id: String(deploy.id || ""), url };
}

async function updateStep(admin: AdminClient, runId: string, stepKey: string, status: string, output: JsonRecord = {}) {
  const patch: JsonRecord = { status, output };
  if (status === "running") patch.started_at = new Date().toISOString();
  if (["completed", "failed", "blocked", "skipped"].includes(status)) patch.completed_at = new Date().toISOString();
  const res = await admin.from("website_automation_steps").update(patch).eq("run_id", runId).eq("step_key", stepKey);
  if (res.error) throw new Error(`Website step ${stepKey} update failed: ${res.error.message}`);
}

async function validateSingleApproval(admin: AdminClient, job: AutomationJob) {
  const [client, approval] = await Promise.all([
    admin.from("clients").select("id,status").eq("id", job.client_id).single(),
    admin.from("owner_approval_requests").select("id,status").eq("client_id", job.client_id)
      .eq("request_type", "website_setup_review").eq("status", "accepted").limit(1).maybeSingle(),
  ]);
  if (!client.data || !["approved", "active"].includes(String(client.data.status))) throw new Error("Client is no longer eligible for production promotion.");
  if (!approval.data) throw new Error("The original accepted owner website approval is required for production promotion.");
  return approval.data.id as string;
}

async function processPromotion(admin: AdminClient, job: AutomationJob) {
  const approvalId = await validateSingleApproval(admin, job);
  const runId = String(job.payload?.website_automation_run_id || "");
  if (!runId) throw new Error("Production promotion job is missing the website automation run id.");

  const [runRes, qualityRes, previewRes, configRes] = await Promise.all([
    admin.from("website_automation_runs").select("id,status,source_branch").eq("id", runId).eq("client_id", job.client_id).eq("project_id", job.project_id).single(),
    admin.from("website_automation_steps").select("status,output").eq("run_id", runId).eq("step_key", "run_quality_checks").single(),
    admin.from("website_automation_steps").select("status,output").eq("run_id", runId).eq("step_key", "client_review").single(),
    admin.from("project_deployment_configs").select("id,github_owner,github_repo,netlify_site_id,auto_publish_locked").eq("project_id", job.project_id).single(),
  ]);

  if (runRes.data?.status !== "preview_ready") throw new Error("Website run is not preview-ready.");
  if (!runRes.data.source_branch || runRes.data.source_branch === "main") throw new Error("Production source branch must be a non-main safe branch.");
  if (qualityRes.data?.status !== "completed") throw new Error("Saved website quality checks must pass before production.");
  const previewOutput = (previewRes.data?.output as JsonRecord | null) || {};
  const previewUrl = String(previewOutput.preview_url || "");
  const verifiedPreviewCommitSha = String(previewOutput.verified_preview_commit_sha || "");
  if (previewRes.data?.status !== "completed" || !previewUrl.startsWith("https://") || !verifiedPreviewCommitSha) throw new Error("A verified HTTPS preview bound to an exact commit is required before production.");
  if (!configRes.data?.github_owner || !configRes.data?.github_repo || !configRes.data?.netlify_site_id) throw new Error("Deployment infrastructure is incomplete.");
  if (!configRes.data.auto_publish_locked) throw new Error("Uncontrolled Netlify auto-publish must remain locked in NXQ metadata.");

  const token = await githubInstallationToken();
  const sourceSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, runRes.data.source_branch, token);
  if (!sourceSha || sourceSha !== verifiedPreviewCommitSha) {
    throw new Error("Production source branch moved after preview verification. A fresh preview is required before launch.");
  }
  const mainSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, "main", token);
  const compareStatus = await verifyFastForward(configRes.data.github_owner, configRes.data.github_repo, runRes.data.source_branch, token);

  await updateStep(admin, runId, "prepare_production_audit", "running");
  const audit = {
    original_owner_approval_id: approvalId,
    original_owner_approval_reused: true,
    preview_url: previewUrl,
    source_branch: runRes.data.source_branch,
    source_commit: sourceSha,
    verified_preview_commit: verifiedPreviewCommitSha,
    exact_preview_commit_bound: sourceSha === verifiedPreviewCommitSha,
    previous_main_commit: mainSha,
    github_compare_status: compareStatus,
    quality_gate_status: qualityRes.data.status,
    production_force_push: false,
  };
  await updateStep(admin, runId, "prepare_production_audit", "completed", audit);
  await updateStep(admin, runId, "owner_publication_gate", "completed", {
    approval_source: "website_setup_review",
    approval_id: approvalId,
    additional_owner_click_required: false,
    force_push_allowed: false,
  });
  await admin.from("website_automation_runs").update({ status: "production_audit", current_step: "production_promotion" }).eq("id", runId);

  if (sourceSha !== mainSha) await fastForwardMain(configRes.data.github_owner, configRes.data.github_repo, sourceSha, token);

  let deploymentId: string;
  const existingDeployment = await admin.from("project_deployments").select("id").eq("project_id", job.project_id)
    .eq("deploy_kind", "production").eq("git_commit_sha", sourceSha).limit(1).maybeSingle();
  if (existingDeployment.data?.id) {
    deploymentId = existingDeployment.data.id;
  } else {
    const inserted = await admin.from("project_deployments").insert({
      deployment_config_id: configRes.data.id,
      project_id: job.project_id,
      client_id: job.client_id,
      trigger_source: "system",
      deploy_kind: "production",
      branch: "main",
      git_commit_sha: sourceSha,
      status: "building",
      started_at: new Date().toISOString(),
    }).select("id").single();
    if (inserted.error || !inserted.data?.id) throw new Error(inserted.error?.message || "Production deployment record could not be created.");
    deploymentId = inserted.data.id;
  }

  const build = await triggerProductionBuild(configRes.data.netlify_site_id);
  await admin.from("project_deployment_configs").update({ last_deployment_status: "building" }).eq("id", configRes.data.id);

  const queued = await admin.rpc("enqueue_automation_job", {
    target_client_id: job.client_id,
    target_project_id: job.project_id,
    target_job_type: "website_check_production",
    target_idempotency_key: `website-run:${runId}:check-production:${sourceSha}`,
    target_payload: {
      execution_target: "edge",
      website_automation_run_id: runId,
      expected_commit_sha: sourceSha,
      netlify_site_id: configRes.data.netlify_site_id,
      deployment_config_id: configRes.data.id,
      deployment_record_id: deploymentId,
      requires_external_worker: true,
    },
    target_run_after: new Date(Date.now() + 30_000).toISOString(),
    target_priority: 55,
  });
  if (queued.error) throw new Error(`Production verification queue failed: ${queued.error.message}`);

  return {
    run_id: runId,
    source_commit_sha: sourceSha,
    previous_main_commit_sha: mainSha,
    netlify_build_id: build?.id || null,
    deployment_record_id: deploymentId,
    production_check_job_id: queued.data,
    force_push_used: false,
  };
}

async function processProductionCheck(admin: AdminClient, job: AutomationJob) {
  await validateSingleApproval(admin, job);
  const payload = job.payload || {};
  const runId = String(payload.website_automation_run_id || "");
  const expectedCommit = String(payload.expected_commit_sha || "");
  const siteId = String(payload.netlify_site_id || "");
  const configId = String(payload.deployment_config_id || "");
  const deploymentId = String(payload.deployment_record_id || "");
  if (!runId || !expectedCommit || !siteId || !configId || !deploymentId) throw new Error("Production verification job is incomplete.");

  const deploy = await findExactProductionDeploy(siteId, expectedCommit);
  if (!deploy) {
    const deferred = await admin.rpc("defer_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_reason: "Exact Netlify production commit is still building.",
      retry_after: "30 seconds",
    });
    if (deferred.error) throw new Error(`Production wait deferral failed: ${deferred.error.message}`);
    return { run_id: runId, status: "production_building", deferred: true };
  }

  const configUpdate = await admin.from("project_deployment_configs").update({
    production_url: deploy.url,
    last_deployed_commit: expectedCommit,
    last_deployment_status: "published",
  }).eq("id", configId).eq("project_id", job.project_id).eq("client_id", job.client_id);
  if (configUpdate.error) throw new Error(configUpdate.error.message);

  const deploymentUpdate = await admin.from("project_deployments").update({
    netlify_deploy_id: deploy.id,
    deploy_url: deploy.url,
    status: "published",
    completed_at: new Date().toISOString(),
  }).eq("id", deploymentId).eq("project_id", job.project_id).eq("client_id", job.client_id);
  if (deploymentUpdate.error) throw new Error(deploymentUpdate.error.message);

  const projectUpdate = await admin.from("projects").update({
    stage: "live",
    current_blocker: null,
    next_step: "NXQ is monitoring and maintaining your live website.",
  }).eq("id", job.project_id).eq("client_id", job.client_id);
  if (projectUpdate.error) throw new Error(projectUpdate.error.message);

  const runUpdate = await admin.from("website_automation_runs").update({
    status: "published",
    current_step: "maintenance",
    latest_commit_sha: expectedCommit,
    completed_at: new Date().toISOString(),
  }).eq("id", runId).eq("project_id", job.project_id).eq("client_id", job.client_id);
  if (runUpdate.error) throw new Error(runUpdate.error.message);

  const maintenance = await admin.rpc("bootstrap_live_website_maintenance");
  if (maintenance.error) throw new Error(`Maintenance bootstrap failed: ${maintenance.error.message}`);

  await admin.from("automation_audit_log").insert({
    client_id: job.client_id,
    project_id: job.project_id,
    automation_job_id: job.id,
    event_type: "business_website_published_automatically",
    actor_type: "backend",
    details: {
      production_url: deploy.url,
      commit_sha: expectedCommit,
      original_owner_approval_reused: true,
      maintenance_bootstrap: maintenance.data,
    },
  });

  return {
    run_id: runId,
    production_url: deploy.url,
    production_commit_sha: expectedCommit,
    netlify_deploy_id: deploy.id,
    maintenance_bootstrap: maintenance.data,
    status: "published",
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "POST required." }, 405);

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const anonKey = requiredSecret("SUPABASE_ANON_KEY");
  const serviceRole = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const internalToken = Deno.env.get("NXQ_AUTOMATION_WORKER_TOKEN")?.trim() || "";
  const suppliedInternalToken = request.headers.get("x-nxq-worker-token")?.trim() || "";
  const authorization = request.headers.get("Authorization") || "";
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  let authorized = Boolean(internalToken && suppliedInternalToken && suppliedInternalToken === internalToken);
  if (!authorized && authorization) {
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const user = await caller.auth.getUser();
    if (user.data.user) {
      const owner = await admin.from("owner_users").select("id").eq("auth_user_id", user.data.user.id).maybeSingle();
      authorized = Boolean(owner.data?.id);
    }
  }
  if (!authorized) return response({ error: "Trusted automation or owner access required." }, 403);

  const claim = await admin.rpc("claim_next_external_automation_job_v2", {
    target_execution_target: "edge",
    worker_name: workerName,
    target_job_types: ["website_promote_production", "website_check_production"],
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: AutomationJob | null;
  try { job = normalizeJob(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid production claim." }, 500); }
  if (!job) return response({ ok: true, message: "No Business production jobs are ready." });

  try {
    const result = job.job_type === "website_promote_production"
      ? await processPromotion(admin, job)
      : await processProductionCheck(admin, job);

    if ("deferred" in result && result.deferred === true) {
      return response({ ok: true, job_id: job.id, ...result });
    }

    const completed = await admin.rpc("complete_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_result: result,
    });
    if (completed.error) throw new Error(completed.error.message);
    return response({ ok: true, job_id: job.id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Business production failure.";
    const providerBillingBlocked = /credit usage exceeded|operational credits|production deploys .* paused/i.test(message);

    if (providerBillingBlocked) {
      const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const blocker = `EXTERNAL_PROVIDER_BILLING_BLOCKER: Netlify production deploy is paused by account credit limits. Automatic retry scheduled for ${retryAt}.`;
      const deferred = await admin.rpc("defer_external_provider_billing_job", {
        target_job_id: job.id,
        worker_name: workerName,
        target_error: blocker,
      });
      if (deferred.error) {
        console.error("Failed to defer provider billing blocker", deferred.error.message);
        return response({ error: message, job_id: job.id }, 500);
      }

      await admin.from("automation_audit_log").insert({
        client_id: job.client_id,
        project_id: job.project_id,
        automation_job_id: job.id,
        event_type: "external_provider_billing_blocker",
        actor_type: "backend",
        details: {
          provider: "netlify",
          blocker_type: "account_credit_limit",
          retry_at: retryAt,
          original_error: message,
          owner_action_required: true,
        },
      });

      return response({
        ok: true,
        blocked: true,
        provider: "netlify",
        blocker_type: "account_credit_limit",
        job_id: job.id,
        retry_at: retryAt,
        message: blocker,
      });
    }

    const failed = await admin.rpc("fail_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist production automation failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});
