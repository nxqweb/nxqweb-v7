import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";
import { normalizeGithubPrivateKey } from "../_shared/github-private-key.ts";

const workerName = "run-staging-evidence-suite";
const headers = { "Content-Type": "application/json" };

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function readJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { message: text }; }
}

const githubHeaders = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

async function githubReadToken() {
  const privateKey = await importPKCS8(normalizeGithubPrivateKey(secret("GITHUB_APP_PRIVATE_KEY")), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(secret("GITHUB_APP_ID"))
    .setIssuedAt(now - 30).setExpirationTime(now + 540).sign(privateKey);
  const res = await timedFetch(`https://api.github.com/app/installations/${encodeURIComponent(secret("GITHUB_APP_INSTALLATION_ID"))}/access_tokens`, {
    method: "POST",
    headers: githubHeaders(jwt),
    body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
  });
  const body = await readJson(res);
  if (!res.ok || typeof body?.token !== "string") throw new Error(`GitHub read-only installation token failed (${res.status}).`);
  return body.token;
}

async function verifyBusinessTemplateAccess(token: string) {
  const owner = secret("NXQ_AUTOMATION_SOURCE_OWNER");
  const repo = secret("NXQ_AUTOMATION_SOURCE_REPO");
  const ref = Deno.env.get("NXQ_AUTOMATION_SOURCE_REF")?.trim() || "main";
  const requiredFiles = ["index.html", "app.js", "styles.css", "lead-form.js", "analytics.js"];
  const checks: Record<string, boolean> = {};
  for (const file of requiredFiles) {
    const res = await timedFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/templates/business-v1/${encodeURIComponent(file)}?ref=${encodeURIComponent(ref)}`, { headers: githubHeaders(token) });
    const body = await readJson(res);
    checks[file] = res.ok && typeof body?.content === "string" && body.content.length > 0;
  }
  if (Object.values(checks).some((passed) => !passed)) throw new Error(`Business template access failed: ${JSON.stringify(checks)}`);
  return { owner, repo, ref, checks, access: "read_only", github_calls: requiredFiles.length + 1 };
}

async function probeRequiredWorkers(baseUrl: string) {
  const requiredWorkers = ["provision-project-infrastructure", "prepare-build-plan", "build-business-website", "promote-business-production", "run-website-maintenance"];
  const checks: Record<string, boolean> = {};
  for (const worker of requiredWorkers) {
    const res = await timedFetch(`${baseUrl}/${worker}`, { method: "GET" });
    checks[worker] = res.status === 405;
  }
  if (Object.values(checks).some((passed) => !passed)) throw new Error(`Required Edge worker coverage failed: ${JSON.stringify(checks)}`);
  return { checks, probe_method: "non_mutating_get", provider_mutations: 0 };
}

async function runReadinessProbe(baseUrl: string, worker: string, token: string) {
  const res = await timedFetch(`${baseUrl}/${worker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nxq-worker-token": token },
    body: JSON.stringify({ readiness_probe: true, source: workerName }),
  });
  const body = await readJson(res);
  if (!body || !res.ok || body.ok !== true || body.readiness_probe !== true || body.netlify_calls !== 0 || body.production_changed !== false) {
    throw new Error(`${worker} readiness probe failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function recordEvidence(admin: SupabaseClient, checkKey: string, suiteVersion: string, checks: unknown, baseDetails: Record<string, unknown>, expiresAt: string) {
  const passedCount = checks && typeof checks === "object" ? Object.keys(checks).length : 1;
  return requireOk(admin.rpc("record_staging_readiness_evidence", {
    target_check_key: checkKey,
    target_suite_version: suiteVersion,
    target_passed_count: passedCount,
    target_failed_count: 0,
    target_evidence_digest: await sha256({ checkKey, suiteVersion, checks, runId: baseDetails.run_id }),
    target_details: { ...baseDetails, checks },
    target_expires_at: expiresAt,
  }), `Record ${checkKey} evidence`);
}

async function requireOk<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, label: string) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function signIn(url: string, anonKey: string, email: string, password: string) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session?.access_token) throw new Error(`Fixture sign-in failed: ${result.error?.message || "missing session"}`);
  return { client, accessToken: result.data.session.access_token };
}

async function removeFixtures(admin: SupabaseClient, bucket: string, paths: string[], clientIds: string[], userIds: string[]) {
  const errors: string[] = [];
  if (paths.length) {
    const removed = await admin.storage.from(bucket).remove(paths);
    if (removed.error) errors.push(`storage: ${removed.error.message}`);
  }
  if (clientIds.length) {
    const removed = await admin.from("clients").delete().in("id", clientIds);
    if (removed.error) errors.push(`clients: ${removed.error.message}`);
  }
  for (const userId of userIds) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) errors.push(`auth user: ${removed.error.message}`);
  }
  return errors;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  if (req.headers.get("x-nxq-worker-token") !== secret("NXQ_AUTOMATION_WORKER_TOKEN")) return response({ ok: false, error: "Unauthorized." }, 401);
  if (secret("NXQ_RUNTIME_ENVIRONMENT").toLowerCase() !== "staging") return response({ ok: false, error: "Staging evidence suite refused outside staging." }, 403);

  const url = secret("SUPABASE_URL");
  const anonKey = secret("SUPABASE_ANON_KEY");
  const admin = createClient(url, secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const runId = crypto.randomUUID();
  const bucket = "client-files";
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const storagePaths: string[] = [];

  try {
    await requireOk(admin.rpc("record_worker_heartbeat", {
      target_worker_key: workerName,
      target_execution_target: "scheduler",
      target_status: "healthy",
      target_metadata: { run_id: runId, mode: "staging_only", external_provider_calls: 0, started_at: new Date().toISOString() },
      target_last_error: null,
    }), "Start evidence heartbeat");

    const password = `Nxq-${crypto.randomUUID()}-Aa9!`;
    const emails = [`nxq-evidence-a-${runId}@example.invalid`, `nxq-evidence-b-${runId}@example.invalid`];
    for (const email of emails) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`Fixture user creation failed: ${created.error?.message || "missing user"}`);
      userIds.push(created.data.user.id);
    }

    const clientRows = (await requireOk(admin.from("clients").insert(userIds.map((userId, index) => ({
      auth_user_id: userId,
      business_name: `NXQ Evidence Tenant ${index + 1} ${runId}`,
      contact_email: emails[index],
      status: "lead",
      monthly_price: 0,
      qa_only: true,
      notes: "Ephemeral staging isolation evidence fixture",
    }))).select("id,auth_user_id"), "Create tenant fixtures")) || [];
    for (const row of clientRows) clientIds.push(String(row.id));
    if (clientIds.length !== 2) throw new Error("Expected exactly two tenant fixtures.");

    const projectRows = (await requireOk(admin.from("projects").insert(clientIds.map((clientId, index) => ({
      client_id: clientId,
      project_name: `NXQ Evidence Project ${index + 1} ${runId}`,
      stage: "intake",
      website_status: "intake",
    }))).select("id,client_id"), "Create project fixtures")) || [];

    const sessions = [await signIn(url, anonKey, emails[0], password), await signIn(url, anonKey, emails[1], password)];
    const ownClients = (await requireOk(sessions[0].client.from("clients").select("id"), "Tenant A client read")) || [];
    const ownProjects = (await requireOk(sessions[0].client.from("projects").select("id,client_id"), "Tenant A project read")) || [];
    const crossUpdate = await sessions[0].client.from("clients").update({ notes: "cross-tenant-write-must-not-land" }).eq("id", clientIds[1]).select("id");
    const expectedCrossTenantDenial = crossUpdate.error?.code === "42501"
      || /permission denied|row-level security/i.test(crossUpdate.error?.message || "");
    if (crossUpdate.error && !expectedCrossTenantDenial) {
      throw new Error(`Cross-tenant update probe: ${crossUpdate.error.message}`);
    }
    const rlsChecks = {
      tenant_a_sees_only_own_client: ownClients.length === 1 && String(ownClients[0].id) === clientIds[0],
      tenant_a_sees_only_own_project: ownProjects.length === 1 && String(ownProjects[0].client_id) === clientIds[0],
      tenant_a_cannot_update_tenant_b: expectedCrossTenantDenial || (crossUpdate.data || []).length === 0,
      fixture_projects_are_distinct: projectRows.length === 2 && String(projectRows[0].client_id) !== String(projectRows[1].client_id),
    };
    if (Object.values(rlsChecks).some((value) => !value)) throw new Error(`RLS isolation failed: ${JSON.stringify(rlsChecks)}`);

    for (let index = 0; index < clientIds.length; index += 1) {
      const path = `${clientIds[index]}/evidence-${runId}-${index + 1}.txt`;
      const uploaded = await admin.storage.from(bucket).upload(path, new TextEncoder().encode(`NXQ staging evidence ${runId} tenant ${index + 1}`), { contentType: "text/plain", upsert: false });
      if (uploaded.error) throw new Error(`Storage fixture upload failed: ${uploaded.error.message}`);
      storagePaths.push(path);
    }
    const fileRows = (await requireOk(admin.from("client_files").insert(clientIds.map((clientId, index) => ({
      client_id: clientId,
      bucket_name: bucket,
      bucket_id: bucket,
      storage_path: storagePaths[index],
      file_name: `evidence-${index + 1}.txt`,
      file_type: "text/plain",
      file_size: 48,
      status: "uploaded",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }))).select("id,client_id"), "Create file metadata fixtures")) || [];
    for (const fileRow of fileRows) {
      await requireOk(admin.from("client_file_security_scans").update({
        status: "clean",
        quarantine_status: "released",
        provider_key: "nxq-staging-evidence",
        content_sha256: await sha256({ runId, fileId: fileRow.id }),
        scanned_at: new Date().toISOString(),
        released_at: new Date().toISOString(),
        findings: { staging_fixture: true, external_scanner_called: false },
      }).eq("client_file_id", fileRow.id), "Release evidence fixture");
    }

    const tenantAFileRows = (await requireOk(sessions[0].client.from("client_files").select("id,client_id"), "Tenant A file metadata read")) || [];
    const ownFile = fileRows.find((row) => String(row.client_id) === clientIds[0]);
    const otherFile = fileRows.find((row) => String(row.client_id) === clientIds[1]);
    if (!ownFile || !otherFile) throw new Error("File fixtures were not tenant-bound.");
    const secureUrl = `${url}/functions/v1/secure-client-file-access`;
    const secureCall = (fileId: string) => fetch(secureUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessions[0].accessToken}` },
      body: JSON.stringify({ client_file_id: fileId }),
    });
    const ownAccess = await secureCall(String(ownFile.id));
    const crossAccess = await secureCall(String(otherFile.id));
    const storageChecks = {
      tenant_a_sees_only_own_file_metadata: tenantAFileRows.length === 1 && String(tenantAFileRows[0].client_id) === clientIds[0],
      tenant_a_receives_own_signed_access: ownAccess.status === 200 && Boolean((await ownAccess.json().catch(() => ({})))?.signed_url),
      tenant_a_is_denied_tenant_b_file: crossAccess.status === 404,
      storage_paths_are_client_namespaced: storagePaths.every((path, index) => path.startsWith(`${clientIds[index]}/`) && !path.includes("..")),
    };
    if (Object.values(storageChecks).some((value) => !value)) throw new Error(`Storage isolation failed: ${JSON.stringify(storageChecks)}`);

    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const baseDetails = { environment: "staging", production_changed: false, netlify_calls: 0, github_calls: 0, ephemeral_fixtures: true, run_id: runId };
    await requireOk(admin.rpc("record_staging_readiness_evidence", {
      target_check_key: "rls_isolation_passed",
      target_suite_version: "staging-isolation-v1",
      target_passed_count: Object.keys(rlsChecks).length,
      target_failed_count: 0,
      target_evidence_digest: await sha256({ runId, check: "rls", rlsChecks }),
      target_details: { ...baseDetails, checks: rlsChecks },
      target_expires_at: expiresAt,
    }), "Record RLS evidence");
    await requireOk(admin.rpc("record_staging_readiness_evidence", {
      target_check_key: "storage_isolation_passed",
      target_suite_version: "staging-isolation-v1",
      target_passed_count: Object.keys(storageChecks).length,
      target_failed_count: 0,
      target_evidence_digest: await sha256({ runId, check: "storage", storageChecks }),
      target_details: { ...baseDetails, checks: storageChecks },
      target_expires_at: expiresAt,
    }), "Record storage evidence");

    const published = await requireOk(admin.from("project_deployment_configs").select("project_id").eq("last_deployment_status", "published").not("production_url", "is", null).not("last_deployed_commit", "is", null).limit(1).maybeSingle(), "Find restore fixture");
    if (!published?.project_id) throw new Error("No verified published staging project is available for the restore simulation.");
    const restorePointId = await requireOk(admin.rpc("create_verified_project_restore_point", { target_project_id: published.project_id, target_restore_kind: "full_project" }), "Create restore point");
    const restoreResult = await requireOk(admin.rpc("simulate_project_restore", { target_restore_point_id: restorePointId }), "Simulate restore");
    if (!restoreResult?.ok || restoreResult?.external_changes_made !== false) throw new Error("Non-destructive restore simulation did not pass.");

    const edgeBaseUrl = `${url.replace(/\/$/, "")}/functions/v1`;
    const workerToken = secret("NXQ_AUTOMATION_WORKER_TOKEN");
    const githubToken = await githubReadToken();
    const templateEvidence = await verifyBusinessTemplateAccess(githubToken);
    const workerEvidence = await probeRequiredWorkers(edgeBaseUrl);
    const domainEvidence = await runReadinessProbe(edgeBaseUrl, "reconcile-domain", workerToken);
    const maintenanceEvidence = await runReadinessProbe(edgeBaseUrl, "run-website-maintenance", workerToken);
    const seoEvidence = await runReadinessProbe(edgeBaseUrl, "build-business-seo-artifacts", workerToken);

    const extendedBaseDetails = {
      environment: "staging", production_changed: false, netlify_calls: 0,
      github_calls: templateEvidence.github_calls, github_access: "read_only", run_id: runId,
    };
    await recordEvidence(admin, "business_template_ready", "zero-netlify-readiness-v2", {
      source_repository: `${templateEvidence.owner}/${templateEvidence.repo}`, source_ref: templateEvidence.ref,
      required_files: templateEvidence.checks, access: templateEvidence.access,
    }, extendedBaseDetails, expiresAt);
    await recordEvidence(admin, "workers_deployed", "zero-netlify-readiness-v2", workerEvidence.checks, extendedBaseDetails, expiresAt);
    await recordEvidence(admin, "domain_flow_passed", "zero-netlify-readiness-v2", domainEvidence.checks, extendedBaseDetails, expiresAt);
    await recordEvidence(admin, "maintenance_passed", "zero-netlify-readiness-v2", maintenanceEvidence.checks, extendedBaseDetails, expiresAt);

    const readiness = await requireOk(admin.rpc("evaluate_launch_readiness"), "Refresh launch readiness");
    await requireOk(admin.rpc("evaluate_staging_readiness_evidence"), "Refresh staging evidence");
    const cleanupErrors = await removeFixtures(admin, bucket, storagePaths, clientIds, userIds);
    if (cleanupErrors.length) throw new Error(`Evidence passed but fixture cleanup failed: ${cleanupErrors.join("; ")}`);
    storagePaths.length = 0; clientIds.length = 0; userIds.length = 0;

    await requireOk(admin.rpc("record_worker_heartbeat", {
      target_worker_key: workerName,
      target_execution_target: "scheduler",
      target_status: "healthy",
      target_metadata: { run_id: runId, completed_at: new Date().toISOString(), rls_checks: rlsChecks, storage_checks: storageChecks, backup_restore_passed: true, worker_coverage: workerEvidence.checks, business_template: templateEvidence.checks, domain_probe: domainEvidence.checks, maintenance_probe: maintenanceEvidence.checks, seo_probe: seoEvidence.checks, netlify_calls: 0, github_calls: templateEvidence.github_calls, production_changed: false },
      target_last_error: null,
    }), "Complete evidence heartbeat");
    return response({ ok: true, run_id: runId, rls_checks: rlsChecks, storage_checks: storageChecks, backup_restore_passed: true, worker_coverage: workerEvidence.checks, business_template: templateEvidence.checks, domain_probe: domainEvidence.checks, maintenance_probe: maintenanceEvidence.checks, seo_probe: seoEvidence.checks, readiness, netlify_calls: 0, github_calls: templateEvidence.github_calls, github_access: "read_only", production_changed: false, fixtures_removed: true });
  } catch (error) {
    const cleanupErrors = await removeFixtures(admin, bucket, storagePaths, clientIds, userIds);
    const message = error instanceof Error ? error.message : "Staging evidence suite failed.";
    const fullMessage = cleanupErrors.length ? `${message} Cleanup errors: ${cleanupErrors.join("; ")}` : message;
    await admin.rpc("record_worker_heartbeat", { target_worker_key: workerName, target_execution_target: "scheduler", target_status: "error", target_metadata: { run_id: runId, failed_at: new Date().toISOString(), netlify_calls: 0, production_changed: false, fixtures_removed: cleanupErrors.length === 0 }, target_last_error: fullMessage });
    return response({ ok: false, error: fullMessage, run_id: runId, netlify_calls: 0, production_changed: false, fixtures_removed: cleanupErrors.length === 0 }, 500);
  }
});
