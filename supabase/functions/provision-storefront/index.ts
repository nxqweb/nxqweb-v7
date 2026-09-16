import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";
import type { DynamicDatabase } from "../_shared/dynamic-database.ts";


type ProviderMetadata = {
  github_full_name?: string;
  netlify_build_triggered_at?: string;
  [key: string]: unknown;
};

type ProvisioningJob = {
  id: string;
  client_id: string;
  project_id?: string | null;
  storefront_id: string;
  repository_name?: string | null;
  repository_owner?: string | null;
  repository_url?: string | null;
  netlify_site_id?: string | null;
  launch_approved_at?: string | null;
  provider_metadata?: ProviderMetadata | null;
  [key: string]: unknown;
};

type SupabaseAdminClient = ReturnType<typeof createClient<DynamicDatabase>>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nxq-worker-token",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const netlifyHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});
const githubHeaders = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "nxq-storefront";
}

function normalizeClaimedJob(value: unknown): ProvisioningJob | null {
  if (value == null) return null;

  let normalized: unknown = value;
  if (typeof normalized === "string") {
    try {
      normalized = JSON.parse(normalized);
    } catch {
      throw new Error("Claim RPC returned an unreadable JSON string.");
    }
  }

  if (Array.isArray(normalized)) {
    normalized = normalized[0] ?? null;
  }

  if (!normalized || typeof normalized !== "object") {
    throw new Error(`Claim RPC returned an unsupported value type: ${typeof normalized}.`);
  }

  const job = normalized as ProvisioningJob;
  const id = typeof job.id === "string" ? job.id.trim() : "";
  if (!id) {
    throw new Error(`Claim RPC result is missing a job id. Keys: ${Object.keys(job).join(", ") || "none"}.`);
  }

  return job;
}

async function timedFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = 15000,
) {
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

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function saveCheckpoint(
  admin: SupabaseAdminClient,
  job: ProvisioningJob,
  workerToken: string,
  checkpoint: string,
  message: string,
) {
  const metadata = job.provider_metadata || {};
  const { data, error } = await admin
    .from("commerce_storefront_provisioning")
    .update({
      error_step: checkpoint,
      last_error: message,
      provider_metadata: {
        ...metadata,
        checkpoint,
        checkpoint_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("lock_token", workerToken)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Checkpoint save failed: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error(
      `Checkpoint save matched zero rows for job ${job.id}. The claim result or worker lock token did not match the database row.`,
    );
  }
}

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
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToPem(label: string, bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || encoded;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

function normalizeGithubPrivateKey(raw: string) {
  let pem = raw.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();

  if (pem.includes("-----BEGIN PRIVATE KEY-----")) return pem;
  if (!pem.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be a PKCS#8 or PKCS#1 RSA PEM private key.");
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
  return bytesToPem("PRIVATE KEY", pkcs8);
}

function protectedTokenMatches(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(actual);
  const right = encoder.encode(expected);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
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

  const tokenResponse = await timedFetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubHeaders(jwt),
      body: JSON.stringify({
        permissions: {
          administration: "write",
          contents: "write",
          metadata: "read",
        },
      }),
    },
  );
  const tokenBody = await readJson(tokenResponse);
  if (!tokenResponse.ok || !tokenBody?.token) {
    throw new Error(
      `GitHub installation token failed (${tokenResponse.status}): ${tokenBody?.message || "Unknown GitHub error"}`,
    );
  }
  return tokenBody.token as string;
}

async function ensureRepository(job: ProvisioningJob, businessName: string) {
  const owner = requiredSecret("GITHUB_REPOSITORY_OWNER");
  const templateOwner = requiredSecret("GITHUB_TEMPLATE_OWNER");
  const templateRepo = requiredSecret("GITHUB_TEMPLATE_REPO");
  const token = await githubInstallationToken();
  const repositoryName = job.repository_name || `${slugify(businessName)}-storefront`;

  const existingResponse = await timedFetch(
    `https://api.github.com/repos/${owner}/${repositoryName}`,
    { headers: githubHeaders(token) },
  );
  if (existingResponse.ok) return await readJson(existingResponse);
  if (existingResponse.status !== 404) {
    const body = await readJson(existingResponse);
    throw new Error(
      `GitHub repository lookup failed (${existingResponse.status}): ${body?.message || "Unknown GitHub error"}`,
    );
  }

  const createResponse = await timedFetch(
    `https://api.github.com/repos/${templateOwner}/${templateRepo}/generate`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({
        owner,
        name: repositoryName,
        description: `${businessName} storefront managed by NXQ-Commerce`,
        include_all_branches: false,
        private: true,
      }),
    },
  );
  const createBody = await readJson(createResponse);
  if (!createResponse.ok) {
    throw new Error(
      `GitHub repository creation failed (${createResponse.status}): ${createBody?.message || "Unknown GitHub error"}`,
    );
  }
  return createBody;
}

function commercePreviewBranch(storefrontId: string) {
  const suffix = storefrontId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "storefront";
  return `nxq/commerce-preview-${suffix}`;
}

async function ensureCommercePreviewBranch(repositoryFullName: string, branch: string) {
  if (!branch || branch === "main") throw new Error("Commerce preview branch must be a non-main branch.");
  const token = await githubInstallationToken();
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  const existing = await timedFetch(
    `https://api.github.com/repos/${repositoryFullName}/git/ref/heads/${encodedBranch}`,
    { headers: githubHeaders(token) },
  );
  if (existing.ok) {
    const body = await readJson(existing);
    return { branch, sha: body?.object?.sha || null };
  }
  if (existing.status !== 404) {
    const body = await readJson(existing);
    throw new Error(`GitHub preview branch lookup failed (${existing.status}): ${body?.message || "Unknown GitHub error"}`);
  }

  const mainRefResponse = await timedFetch(
    `https://api.github.com/repos/${repositoryFullName}/git/ref/heads/main`,
    { headers: githubHeaders(token) },
  );
  const mainRef = await readJson(mainRefResponse);
  const mainSha = mainRef?.object?.sha;
  if (!mainRefResponse.ok || typeof mainSha !== "string" || !mainSha) {
    throw new Error(`GitHub main ref lookup failed (${mainRefResponse.status}): ${mainRef?.message || "Missing main SHA"}`);
  }

  const create = await timedFetch(
    `https://api.github.com/repos/${repositoryFullName}/git/refs`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    },
  );
  const created = await readJson(create);
  if (!create.ok) {
    throw new Error(`GitHub preview branch creation failed (${create.status}): ${created?.message || "Unknown GitHub error"}`);
  }
  return { branch, sha: created?.object?.sha || mainSha };
}

async function createNetlifySite(repositoryFullName: string, previewBranch: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const installationIdText = requiredSecret("NETLIFY_GITHUB_INSTALLATION_ID");
  const installationId = Number(installationIdText);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("NETLIFY_GITHUB_INSTALLATION_ID must be a positive numeric Netlify GitHub App installation ID.");
  }

  const siteName = slugify(repositoryFullName.split("/")[1]);
  const createResponse = await timedFetch("https://api.netlify.com/api/v1/sites", {
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
        cmd: "npm run build",
        dir: "dist",
        public_repo: false,
        installation_id: installationId,
        allowed_branches: [previewBranch],
        stop_builds: true,
      },
    }),
  });
  const site = await readJson(createResponse);
  if (!createResponse.ok) {
    throw new Error(
      `Netlify site creation failed (${createResponse.status}): ${site?.message || site?.error || "Unknown Netlify error"}`,
    );
  }
  return site;
}

async function activateNetlifyBuilds(siteId: string, previewBranch: string) {
  if (!previewBranch || previewBranch === "main") throw new Error("Refusing to activate Commerce preview builds for main.");
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const current = await getNetlifySite(siteId);
  const existing = current?.build_settings && typeof current.build_settings === "object" ? current.build_settings : {};
  const patchResponse = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: netlifyHeaders(token),
    body: JSON.stringify({
      build_settings: {
        ...existing,
        allowed_branches: [previewBranch],
        stop_builds: false,
      },
    }),
  });
  const patched = await readJson(patchResponse);
  if (!patchResponse.ok) {
    throw new Error(`Netlify build activation failed (${patchResponse.status}): ${patched?.message || patched?.error || "Unknown Netlify error"}`);
  }
  return patched;
}

async function getNetlifySite(siteId: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const siteResponse = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    headers: netlifyHeaders(token),
  });
  const site = await readJson(siteResponse);
  if (!siteResponse.ok) {
    throw new Error(
      `Netlify site lookup failed (${siteResponse.status}): ${site?.message || site?.error || "Unknown Netlify error"}`,
    );
  }
  return site;
}

async function upsertNetlifyEnvVars(
  accountId: string,
  siteId: string,
  token: string,
  values: Record<string, string>,
) {
  const listResponse = await timedFetch(
    `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${encodeURIComponent(siteId)}`,
    { headers: netlifyHeaders(token) },
  );
  const existing = await readJson(listResponse);
  if (!listResponse.ok) {
    throw new Error(
      `Netlify environment lookup failed (${listResponse.status}): ${existing?.message || existing?.error || "Unknown Netlify error"}`,
    );
  }

  const existingKeys = new Set(
    Array.isArray(existing)
      ? existing
          .map((item: unknown) => {
            if (!item || typeof item !== "object" || !("key" in item)) return "";
            const key = (item as Record<string, unknown>).key;
            return typeof key === "string" ? key : "";
          })
          .filter(Boolean)
      : [],
  );

  for (const [key, value] of Object.entries(values)) {
    const payload = {
      key,
      values: [{ value, context: "all" }],
      is_secret: false,
    };
    const exists = existingKeys.has(key);
    const url = exists
      ? `https://api.netlify.com/api/v1/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${encodeURIComponent(siteId)}`
      : `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${encodeURIComponent(siteId)}`;
    const envResponse = await timedFetch(url, {
      method: exists ? "PUT" : "POST",
      headers: netlifyHeaders(token),
      body: JSON.stringify(exists ? payload : [payload]),
    });
    const envBody = await readJson(envResponse);
    if (!envResponse.ok) {
      throw new Error(
        `Netlify environment update failed for ${key} (${envResponse.status}): ${envBody?.message || envBody?.error || "Unknown Netlify error"}`,
      );
    }
  }
}

async function triggerNetlifyBuild(siteId: string, token: string, previewBranch: string) {
  if (!previewBranch || previewBranch === "main") throw new Error("Refusing to trigger a Commerce preview build for main.");
  const buildResponse = await timedFetch(
    `https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=${encodeURIComponent(previewBranch)}&clear_cache=true`,
    {
      method: "POST",
      headers: netlifyHeaders(token),
      body: JSON.stringify({}),
    },
  );
  const buildBody = await readJson(buildResponse);
  if (!buildResponse.ok) {
    throw new Error(
      `Netlify build trigger failed (${buildResponse.status}): ${buildBody?.message || buildBody?.error || "Unknown Netlify error"}`,
    );
  }
  return buildBody;
}

async function checkPreview(siteId: string, previewBranch: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const deploysResponse = await timedFetch(
    `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=5`,
    { headers: netlifyHeaders(token) },
  );
  const deploys = await readJson(deploysResponse);
  if (!deploysResponse.ok) {
    throw new Error(
      `Netlify deploy check failed (${deploysResponse.status}): ${deploys?.message || "Unknown Netlify error"}`,
    );
  }
  const latest = Array.isArray(deploys)
    ? deploys.find((deploy: unknown) => {
        if (!deploy || typeof deploy !== "object") return false;
        const candidate = deploy as Record<string, unknown>;
        return candidate.branch === previewBranch && candidate.context === "branch-deploy";
      }) || null
    : null;
  if (latest?.state === "error") {
    throw new Error(`Netlify build failed: ${latest.error_message || "Unknown build error"}`);
  }
  if (latest?.state === "ready") {
    return latest.deploy_ssl_url || latest.ssl_url || latest.deploy_url || latest.url;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const anonKey = requiredSecret("SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") || "";
  const suppliedWorkerToken = request.headers.get("x-nxq-worker-token")?.trim() || "";
  const expectedWorkerToken = Deno.env.get("NXQ_AUTOMATION_WORKER_TOKEN")?.trim() || "";
  const workerAuthorized = protectedTokenMatches(suppliedWorkerToken, expectedWorkerToken);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  if (!workerAuthorized) {
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) {
      return response({ error: "Owner access or protected worker token required." }, 403);
    }

    const ownerAccess = await admin
      .from("owner_users")
      .select("id,role")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    if (ownerAccess.error || !ownerAccess.data) {
      return response({ error: "Owner access required." }, 403);
    }
  }

  const workerToken = crypto.randomUUID();
  const claim = await admin.rpc("claim_next_storefront_provisioning_job", {
    worker_token: workerToken,
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: ProvisioningJob | null;
  try {
    job = normalizeClaimedJob(claim.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown claim normalization failure";
    console.error("Storefront claim normalization failed", { message, rawType: typeof claim.data });
    return response({ error: message, error_step: "claim_result_shape" }, 500);
  }

  if (!job) return response({ ok: true, message: "No provisioning jobs are ready." });

  let step = "worker_claimed";
  try {
    await saveCheckpoint(
      admin,
      job,
      workerToken,
      "worker_claimed",
      "Worker claimed the job and entered startup.",
    );

    step = "validation";
    const [
      { data: client, error: clientError },
      { data: storefront, error: storefrontError },
      { data: acceptedApproval, error: approvalError },
    ] = await Promise.all([
      admin.from("clients").select("id,business_name,status").eq("id", job.client_id).single(),
      admin.from("commerce_storefronts").select("id,store_slug,status").eq("id", job.storefront_id).single(),
      admin
        .from("owner_approval_requests")
        .select("id,status")
        .eq("client_id", job.client_id)
        .eq("request_type", "website_setup_review")
        .eq("status", "accepted")
        .order("resolved_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (clientError || !client) throw new Error(clientError?.message || "Client record not found.");
    if (storefrontError || !storefront) throw new Error(storefrontError?.message || "Storefront record not found.");
    if (["denied", "archived", "dormant"].includes(String(client.status))) {
      throw new Error(`Client status ${client.status} is not eligible for storefront provisioning.`);
    }
    if (approvalError || !acceptedApproval) {
      throw new Error(approvalError?.message || "Accepted owner website setup approval is required before provisioning.");
    }

    if (job.launch_approved_at) {
      step = "production_launch_guard";
      await admin.from("commerce_storefront_provisioning").update({
        status: "launch_approved",
        locked_at: null,
        lock_token: null,
        last_error: "Production publication is intentionally blocked in the storefront preview worker. Use the guarded production launch workflow.",
        error_step: "production_publish_required",
        provider_metadata: {
          ...(job.provider_metadata || {}),
          checkpoint: "production_publish_required",
          production_publish_required: true,
          production_publish_automatic: false,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({
        ok: true,
        job_id: job.id,
        status: "launch_approved",
        production_publish_required: true,
        message: "Preview approval is recorded. Production publication remains behind the guarded production workflow.",
      });
    }

    const metadata = job.provider_metadata || {};

    if (!job.repository_url) {
      step = "github_auth_start";
      await saveCheckpoint(
        admin,
        job,
        workerToken,
        "github_auth_start",
        "Starting GitHub App authentication and repository lookup.",
      );
      const repository = await ensureRepository(job, client.business_name);
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        repository_owner: repository.owner?.login,
        repository_name: repository.name,
        repository_url: repository.html_url,
        repository_id: repository.id,
        provider_metadata: { ...metadata, github_full_name: repository.full_name, checkpoint: "repository_created" },
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: null,
        error_step: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "repository_created" });
    }

    const repositoryFullName = metadata.github_full_name || `${job.repository_owner}/${job.repository_name}`;
    const previewBranch = typeof metadata.commerce_preview_branch === "string" && metadata.commerce_preview_branch
      ? metadata.commerce_preview_branch
      : commercePreviewBranch(job.storefront_id);

    if (!metadata.commerce_preview_branch) {
      step = "github_preview_branch";
      await saveCheckpoint(admin, job, workerToken, step, "Creating the protected Commerce preview branch.");
      const previewRef = await ensureCommercePreviewBranch(repositoryFullName, previewBranch);
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        provider_metadata: {
          ...metadata,
          github_full_name: repositoryFullName,
          commerce_preview_branch: previewBranch,
          commerce_preview_source_sha: previewRef.sha,
          checkpoint: "preview_branch_ready",
        },
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: null,
        error_step: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "preview_branch_ready" });
    }

    if (!job.netlify_site_id) {
      step = "netlify_site";
      await saveCheckpoint(
        admin,
        job,
        workerToken,
        "netlify_site",
        "Starting Netlify site creation.",
      );
      const site = await createNetlifySite(repositoryFullName, previewBranch);
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        netlify_site_id: String(site.id),
        netlify_site_name: site.name,
        preview_url: site.ssl_url || site.url || null,
        provider_metadata: {
          ...metadata,
          github_full_name: repositoryFullName,
          netlify_admin_url: site.admin_url,
          checkpoint: "netlify_site_created",
        },
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: null,
        error_step: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "netlify_site_created" });
    }

    if (!metadata.netlify_build_triggered_at) {
      step = "netlify_configuration";
      await saveCheckpoint(
        admin,
        job,
        workerToken,
        "netlify_configuration",
        "Configuring Netlify environment variables and starting the preview build.",
      );
      const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
      const site = await getNetlifySite(String(job.netlify_site_id));
      const accountId = String(site.account_id || "");
      if (!accountId) throw new Error("Netlify site response did not include an account ID.");
      await upsertNetlifyEnvVars(accountId, String(job.netlify_site_id), token, {
        VITE_SUPABASE_URL: requiredSecret("PUBLIC_SUPABASE_URL"),
        VITE_SUPABASE_ANON_KEY: requiredSecret("PUBLIC_SUPABASE_ANON_KEY"),
        VITE_NXQ_STOREFRONT_SLUG: storefront.store_slug,
      });
      const buildReservation = await admin.rpc("nxq_reserve_netlify_build", {
        target_client_id: job.client_id,
        target_project_id: job.project_id,
        target_build_kind: "preview",
        target_idempotency_key: `commerce-storefront:${job.id}:initial-preview`,
        target_metadata: { storefront_provisioning_id: job.id },
      });
      if (buildReservation.error || buildReservation.data?.ok !== true) {
        throw new Error("Netlify build denied by the protected build-credit budget.");
      }
      await activateNetlifyBuilds(String(job.netlify_site_id), previewBranch);
      const build = await triggerNetlifyBuild(String(job.netlify_site_id), token, previewBranch);
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        provider_metadata: {
          ...metadata,
          github_full_name: repositoryFullName,
          netlify_build_triggered_at: new Date().toISOString(),
          netlify_build_id: build?.id || null,
          commerce_preview_branch: previewBranch,
          checkpoint: "preview_building",
        },
        next_attempt_at: new Date(Date.now() + 20_000).toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: null,
        error_step: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "preview_building" });
    }

    step = "preview_check";
    await saveCheckpoint(
      admin,
      job,
      workerToken,
      "preview_check",
      "Checking whether the Netlify preview build is ready.",
    );
    const previewUrl = await checkPreview(String(job.netlify_site_id), previewBranch);
    if (!previewUrl) {
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: "Netlify is still building. Check again shortly.",
        error_step: "preview_building",
        provider_metadata: { ...metadata, checkpoint: "preview_building" },
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "preview_building" });
    }

    await admin.from("commerce_storefront_provisioning").update({
      status: "preview_ready",
      preview_url: previewUrl,
      preview_ready_at: new Date().toISOString(),
      locked_at: null,
      lock_token: null,
      last_error: null,
      error_step: null,
      provider_metadata: { ...metadata, checkpoint: "preview_ready" },
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lock_token", workerToken);

    return response({ ok: true, job_id: job.id, status: "preview_ready", preview_url: previewUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provisioning failure";
    console.error("Storefront provisioning failed", { jobId: job.id, step, message });

    const failure = await admin.from("commerce_storefront_provisioning").update({
      status: "failed",
      last_error: message.slice(0, 2000),
      error_step: step,
      locked_at: null,
      lock_token: null,
      next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lock_token", workerToken);

    if (failure.error) {
      console.error("Failed to persist provisioning error", {
        jobId: job.id,
        step,
        persistError: failure.error.message,
      });
    }

    return response({ error: message, job_id: job.id, error_step: step }, 500);
  }
});
