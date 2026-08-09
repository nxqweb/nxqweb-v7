import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

type AutomationJob = {
  id: string;
  client_id: string;
  project_id: string;
  job_type: string;
  result?: Record<string, unknown> | null;
};

type JsonRecord = Record<string, unknown>;

const jsonHeaders = { "Content-Type": "application/json" };
const workerName = "provision-project-infrastructure";

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "nxq-client";
}

function normalizeJob(value: unknown): AutomationJob | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Automation claim returned an invalid job shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id || !job.project_id) throw new Error("Automation claim is missing job, client, or project id.");
  return job;
}

async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Provider request timed out after ${Math.round(timeoutMs / 1000)} seconds.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(res: Response): Promise<JsonRecord | JsonRecord[] | null> {
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

async function githubInstallationToken() {
  const appId = requiredSecret("GITHUB_APP_ID");
  const installationId = requiredSecret("GITHUB_APP_INSTALLATION_ID");
  const privateKey = await importPKCS8(requiredSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"), "RS256");
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
    body: JSON.stringify({ permissions: { administration: "write", contents: "write", metadata: "read" } }),
  });
  const body = await readJson(res) as JsonRecord | null;
  if (!res.ok || typeof body?.token !== "string") {
    throw new Error(`GitHub installation token failed (${res.status}): ${String(body?.message || "Unknown GitHub error")}`);
  }
  return body.token;
}

function templateForFamily(familySlug: string) {
  if (familySlug === "business") {
    return {
      owner: requiredSecret("NXQ_BUSINESS_TEMPLATE_OWNER"),
      repo: requiredSecret("NXQ_BUSINESS_TEMPLATE_REPO"),
      suffix: "website",
    };
  }
  if (familySlug === "commerce") {
    return {
      owner: requiredSecret("GITHUB_TEMPLATE_OWNER"),
      repo: requiredSecret("GITHUB_TEMPLATE_REPO"),
      suffix: "storefront",
    };
  }
  throw new Error(`Product family ${familySlug} does not have an approved infrastructure template yet.`);
}

async function ensureRepository(
  businessName: string,
  projectId: string,
  familySlug: string,
  checkpoint: JsonRecord,
) {
  const owner = requiredSecret("GITHUB_REPOSITORY_OWNER");
  const template = templateForFamily(familySlug);
  const token = await githubInstallationToken();
  const repositoryName = typeof checkpoint.github_repo === "string"
    ? checkpoint.github_repo
    : `${slugify(businessName)}-${projectId.slice(0, 8)}-${template.suffix}`;

  const existing = await timedFetch(`https://api.github.com/repos/${owner}/${repositoryName}`, {
    headers: githubHeaders(token),
  });
  if (existing.ok) return await readJson(existing) as JsonRecord;
  if (existing.status !== 404) {
    const body = await readJson(existing) as JsonRecord | null;
    throw new Error(`GitHub repository lookup failed (${existing.status}): ${String(body?.message || "Unknown GitHub error")}`);
  }

  const created = await timedFetch(`https://api.github.com/repos/${template.owner}/${template.repo}/generate`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      owner,
      name: repositoryName,
      description: `${businessName} ${familySlug} website managed by NXQ Web`,
      include_all_branches: false,
      private: true,
    }),
  });
  const body = await readJson(created) as JsonRecord | null;
  if (!created.ok) {
    throw new Error(`GitHub repository creation failed (${created.status}): ${String(body?.message || "Unknown GitHub error")}`);
  }
  return body || {};
}

async function verifyPrivateRepository(repositoryFullName: string) {
  const token = await githubInstallationToken();
  const res = await timedFetch(`https://api.github.com/repos/${repositoryFullName}`, {
    headers: githubHeaders(token),
  });
  const body = await readJson(res) as JsonRecord | null;
  if (!res.ok || !body) {
    throw new Error(`GitHub repository privacy verification failed (${res.status}).`);
  }
  if (body.full_name !== repositoryFullName || body.private !== true) {
    throw new Error("Generated GitHub repository is not verified private.");
  }
  return { fullName: repositoryFullName, private: true };
}

async function createNetlifySite(repositoryFullName: string, familySlug: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const installationId = Number(requiredSecret("NETLIFY_GITHUB_INSTALLATION_ID"));
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("NETLIFY_GITHUB_INSTALLATION_ID must be a positive numeric installation id.");
  }

  const siteName = slugify(repositoryFullName.split("/")[1]);
  const buildCommand = familySlug === "business" ? "" : "npm run build";
  const publishDirectory = familySlug === "business" ? "." : "dist";
  const created = await timedFetch("https://api.netlify.com/api/v1/sites", {
    method: "POST",
    headers: netlifyHeaders(token),
    body: JSON.stringify({
      name: siteName,
      repo: {
        provider: "github",
        repo_path: repositoryFullName,
        repo: repositoryFullName,
        repo_url: `https://github.com/${repositoryFullName}`,
        repo_branch: "main",
        branch: "main",
        cmd: buildCommand,
        dir: publishDirectory,
        public_repo: false,
        installation_id: installationId,
      },
    }),
  });
  const body = await readJson(created) as JsonRecord | null;
  if (!created.ok) {
    throw new Error(`Netlify site creation failed (${created.status}): ${String(body?.message || body?.error || "Unknown Netlify error")}`);
  }
  return body || {};
}

async function upsertNetlifyEnv(siteId: string, values: Record<string, string>) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const siteRes = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, { headers: netlifyHeaders(token) });
  const site = await readJson(siteRes) as JsonRecord | null;
  if (!siteRes.ok || typeof site?.account_id !== "string") throw new Error("Netlify site lookup did not return an account id.");
  const accountId = site.account_id;

  const listRes = await timedFetch(`https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${encodeURIComponent(siteId)}`, {
    headers: netlifyHeaders(token),
  });
  const existing = await readJson(listRes);
  if (!listRes.ok) throw new Error(`Netlify environment lookup failed (${listRes.status}).`);
  const keys = new Set(Array.isArray(existing) ? existing.map((item) => String(item.key || "")) : []);

  for (const [key, value] of Object.entries(values)) {
    const payload = { key, values: [{ value, context: "all" }], is_secret: false };
    const exists = keys.has(key);
    const url = exists
      ? `https://api.netlify.com/api/v1/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${encodeURIComponent(siteId)}`
      : `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${encodeURIComponent(siteId)}`;
    const res = await timedFetch(url, {
      method: exists ? "PUT" : "POST",
      headers: netlifyHeaders(token),
      body: JSON.stringify(exists ? payload : [payload]),
    });
    if (!res.ok) throw new Error(`Netlify environment update failed for ${key} (${res.status}).`);
  }
}

async function triggerBaselineBuild(siteId: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=main&clear_cache=true`, {
    method: "POST",
    headers: netlifyHeaders(token),
    body: "{}",
  });
  const body = await readJson(res) as JsonRecord | null;
  if (!res.ok) throw new Error(`Netlify baseline build failed to start (${res.status}): ${String(body?.message || body?.error || "Unknown Netlify error")}`);
  return body || {};
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

  const claim = await admin.rpc("claim_next_external_automation_job", {
    target_execution_target: "edge",
    worker_name: workerName,
    target_job_types: ["provision_project_infrastructure"],
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: AutomationJob | null;
  try { job = normalizeJob(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid job claim." }, 500); }
  if (!job) return response({ ok: true, message: "No project infrastructure jobs are ready." });

  let checkpoint: JsonRecord = job.result || {};
  const saveCheckpoint = async (patch: JsonRecord) => {
    checkpoint = { ...checkpoint, ...patch, checkpoint_at: new Date().toISOString() };
    const update = await admin.from("automation_jobs").update({ result: checkpoint })
      .eq("id", job!.id).eq("status", "running").eq("locked_by", workerName);
    if (update.error) throw new Error(`Automation checkpoint failed: ${update.error.message}`);
  };

  try {
    const [clientRes, projectRes, approvalRes] = await Promise.all([
      admin.from("clients").select("id,business_name,status").eq("id", job.client_id).single(),
      admin.from("projects").select("id,client_id,product_family_id").eq("id", job.project_id).eq("client_id", job.client_id).single(),
      admin.from("owner_approval_requests").select("id,status").eq("client_id", job.client_id)
        .eq("request_type", "website_setup_review").eq("status", "accepted").limit(1).maybeSingle(),
    ]);
    if (clientRes.error || !clientRes.data) throw new Error(clientRes.error?.message || "Client not found.");
    if (projectRes.error || !projectRes.data) throw new Error(projectRes.error?.message || "Project not found.");
    if (approvalRes.error || !approvalRes.data) throw new Error("Accepted owner website setup approval is required.");
    if (!["approved", "active"].includes(String(clientRes.data.status))) {
      throw new Error(`Client status ${clientRes.data.status} is not eligible for infrastructure provisioning.`);
    }

    const familyRes = projectRes.data.product_family_id
      ? await admin.from("product_families").select("slug").eq("id", projectRes.data.product_family_id).single()
      : { data: { slug: "business" }, error: null };
    if (familyRes.error || !familyRes.data?.slug) throw new Error("Project product family could not be resolved.");
    const familySlug = String(familyRes.data.slug);
    templateForFamily(familySlug); // fail early if the family has no approved template

    let configRes = await admin.from("project_deployment_configs").select("*").eq("project_id", job.project_id).maybeSingle();
    if (configRes.error) throw new Error(configRes.error.message);
    if (!configRes.data) {
      const inserted = await admin.from("project_deployment_configs").insert({
        project_id: job.project_id,
        client_id: job.client_id,
        production_branch: "main",
        auto_publish_locked: true,
        last_deployment_status: "not_configured",
      }).select("*").single();
      if (inserted.error) throw new Error(inserted.error.message);
      configRes = inserted;
    }
    let config = configRes.data as JsonRecord;

    let repositoryFullName = typeof checkpoint.github_full_name === "string" ? checkpoint.github_full_name : "";
    if (!repositoryFullName && typeof config.github_owner === "string" && typeof config.github_repo === "string") {
      repositoryFullName = `${config.github_owner}/${config.github_repo}`;
    }
    if (!repositoryFullName) {
      const repository = await ensureRepository(clientRes.data.business_name, job.project_id, familySlug, checkpoint);
      if (typeof repository.full_name !== "string" || typeof repository.name !== "string") throw new Error("GitHub repository response was incomplete.");
      repositoryFullName = repository.full_name;
      await saveCheckpoint({ checkpoint: "github_repository_ready", github_full_name: repositoryFullName, github_repo: repository.name });
      const owner = repositoryFullName.split("/")[0];
      const saved = await admin.from("project_deployment_configs").update({ github_owner: owner, github_repo: repository.name })
        .eq("project_id", job.project_id).eq("client_id", job.client_id).select("*").single();
      if (saved.error) throw new Error(saved.error.message);
      config = saved.data as JsonRecord;
    }

    const repositoryPrivacy = await verifyPrivateRepository(repositoryFullName);
    await saveCheckpoint({
      checkpoint: "github_repository_privacy_verified",
      github_full_name: repositoryPrivacy.fullName,
      github_repository_private_verified: repositoryPrivacy.private,
      github_repository_private_verified_at: new Date().toISOString(),
    });

    let netlifySiteId = typeof checkpoint.netlify_site_id === "string" ? checkpoint.netlify_site_id : "";
    if (!netlifySiteId && typeof config.netlify_site_id === "string") netlifySiteId = config.netlify_site_id;
    let netlifySite: JsonRecord | null = null;
    if (!netlifySiteId) {
      netlifySite = await createNetlifySite(repositoryFullName, familySlug);
      if (typeof netlifySite.id !== "string") throw new Error("Netlify site creation returned no site id.");
      netlifySiteId = netlifySite.id;
      await saveCheckpoint({ checkpoint: "netlify_site_ready", netlify_site_id: netlifySiteId });
      const saved = await admin.from("project_deployment_configs").update({
        netlify_site_id: netlifySiteId,
        last_deployment_status: "ready",
      }).eq("project_id", job.project_id).eq("client_id", job.client_id).select("*").single();
      if (saved.error) throw new Error(saved.error.message);
      config = saved.data as JsonRecord;
    }

    await upsertNetlifyEnv(netlifySiteId, {
      VITE_SUPABASE_URL: requiredSecret("PUBLIC_SUPABASE_URL"),
      VITE_SUPABASE_ANON_KEY: requiredSecret("PUBLIC_SUPABASE_ANON_KEY"),
      VITE_NXQ_CLIENT_ID: job.client_id,
      VITE_NXQ_PROJECT_ID: job.project_id,
      VITE_NXQ_PRODUCT_FAMILY: familySlug,
    });
    await saveCheckpoint({ checkpoint: "netlify_environment_ready" });

    if (!checkpoint.baseline_build_id) {
      const build = await triggerBaselineBuild(netlifySiteId);
      await saveCheckpoint({
        checkpoint: "baseline_build_started",
        baseline_build_id: typeof build.id === "string" ? build.id : null,
      });
    }

    const completed = await admin.rpc("complete_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_result: {
        ...checkpoint,
        checkpoint: "infrastructure_ready",
        product_family_slug: familySlug,
        github_full_name: repositoryFullName,
        github_repository_private_verified: repositoryPrivacy.private,
        netlify_site_id: netlifySiteId,
        auto_publish_locked: true,
      },
    });
    if (completed.error) throw new Error(completed.error.message);

    return response({
      ok: true,
      job_id: job.id,
      project_id: job.project_id,
      product_family_slug: familySlug,
      github_repository: repositoryFullName,
      github_repository_private_verified: repositoryPrivacy.private,
      netlify_site_id: netlifySiteId,
      production_publish_automatic: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown project infrastructure failure.";
    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist external automation failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});
