import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function githubInstallationToken() {
  const appId = requiredSecret("GITHUB_APP_ID");
  const installationId = requiredSecret("GITHUB_APP_INSTALLATION_ID");
  const privateKeyText = requiredSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(privateKeyText, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .sign(privateKey);

  const tokenResponse = await fetch(
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

async function ensureRepository(job: any, businessName: string) {
  const owner = requiredSecret("GITHUB_REPOSITORY_OWNER");
  const templateOwner = requiredSecret("GITHUB_TEMPLATE_OWNER");
  const templateRepo = requiredSecret("GITHUB_TEMPLATE_REPO");
  const token = await githubInstallationToken();
  const repositoryName = job.repository_name || `${slugify(businessName)}-storefront`;

  const existingResponse = await fetch(
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

  const createResponse = await fetch(
    `https://api.github.com/repos/${templateOwner}/${templateRepo}/generate`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({
        owner,
        name: repositoryName,
        description: `${businessName} storefront managed by NXQ Commerce`,
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

async function upsertNetlifyEnvVars(
  accountId: string,
  siteId: string,
  token: string,
  values: Record<string, string>,
) {
  const listResponse = await fetch(
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
    Array.isArray(existing) ? existing.map((item: any) => item?.key).filter(Boolean) : [],
  );

  for (const [key, value] of Object.entries(values)) {
    const payload = {
      key,
      scopes: ["builds"],
      values: [{ value, context: "all" }],
      is_secret: false,
    };
    const url = existingKeys.has(key)
      ? `https://api.netlify.com/api/v1/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${encodeURIComponent(siteId)}`
      : `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${encodeURIComponent(siteId)}`;
    const envResponse = await fetch(url, {
      method: existingKeys.has(key) ? "PUT" : "POST",
      headers: netlifyHeaders(token),
      body: JSON.stringify(existingKeys.has(key) ? payload : [payload]),
    });
    const envBody = await readJson(envResponse);
    if (!envResponse.ok) {
      throw new Error(
        `Netlify environment update failed for ${key} (${envResponse.status}): ${envBody?.message || envBody?.error || "Unknown Netlify error"}`,
      );
    }
  }
}

async function triggerNetlifyBuild(siteId: string, token: string) {
  const buildResponse = await fetch(
    `https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=main&clear_cache=true`,
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

async function ensureNetlifySite(job: any, repositoryFullName: string, storefrontSlug: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const siteName = job.netlify_site_name || slugify(repositoryFullName.split("/")[1]);
  let site: any = null;

  if (job.netlify_site_id) {
    const existingResponse = await fetch(
      `https://api.netlify.com/api/v1/sites/${job.netlify_site_id}`,
      { headers: netlifyHeaders(token) },
    );
    if (existingResponse.ok) site = await readJson(existingResponse);
  }

  if (!site) {
    const createResponse = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: netlifyHeaders(token),
      body: JSON.stringify({
        name: siteName,
        repo: {
          provider: "github",
          repo_path: repositoryFullName,
          repo: repositoryFullName,
          repo_branch: "main",
          branch: "main",
          cmd: "npm run build",
          dir: "dist",
        },
      }),
    });
    site = await readJson(createResponse);
    if (!createResponse.ok) {
      throw new Error(
        `Netlify site creation failed (${createResponse.status}): ${site?.message || site?.error || "Unknown Netlify error"}`,
      );
    }
  }

  const siteId = String(site.id);
  const accountId = String(site.account_id || "");
  if (!accountId) throw new Error("Netlify site response did not include an account ID.");

  await upsertNetlifyEnvVars(accountId, siteId, token, {
    VITE_SUPABASE_URL: requiredSecret("PUBLIC_SUPABASE_URL"),
    VITE_SUPABASE_ANON_KEY: requiredSecret("PUBLIC_SUPABASE_ANON_KEY"),
    VITE_STOREFRONT_SLUG: storefrontSlug,
  });
  await triggerNetlifyBuild(siteId, token);
  return site;
}

async function waitForPreview(siteId: string, token: string) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const deploysResponse = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=5`,
      { headers: netlifyHeaders(token) },
    );
    const deploys = await readJson(deploysResponse);
    if (!deploysResponse.ok) {
      throw new Error(
        `Netlify deploy check failed (${deploysResponse.status}): ${deploys?.message || "Unknown Netlify error"}`,
      );
    }
    const latest = Array.isArray(deploys) ? deploys[0] : null;
    if (latest?.state === "error") {
      throw new Error(`Netlify build failed: ${latest.error_message || "Unknown build error"}`);
    }
    if (latest?.state === "ready") {
      return {
        ready: true,
        previewUrl: latest.deploy_ssl_url || latest.ssl_url || latest.deploy_url || latest.url,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return { ready: false };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const anonKey = requiredSecret("SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") || "";

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || userData.user?.email?.toLowerCase() !== "nxqweb@protonmail.com") {
    return response({ error: "Owner access required." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const workerToken = crypto.randomUUID();
  const claim = await admin.rpc("claim_next_storefront_provisioning_job", {
    worker_token: workerToken,
  });
  if (claim.error) return response({ error: claim.error.message }, 500);
  const job = claim.data;
  if (!job) return response({ ok: true, message: "No provisioning jobs are ready." });

  let step = "validation";
  try {
    const [{ data: client, error: clientError }, { data: storefront, error: storefrontError }] = await Promise.all([
      admin.from("clients").select("id,business_name,status").eq("id", job.client_id).single(),
      admin.from("commerce_storefronts").select("id,store_slug,status").eq("id", job.storefront_id).single(),
    ]);
    if (clientError || !client) throw new Error(clientError?.message || "Client record not found.");
    if (storefrontError || !storefront) throw new Error(storefrontError?.message || "Storefront record not found.");

    if (job.launch_approved_at) {
      step = "production_launch";
      const productionUrl = job.preview_url || job.production_url;
      if (!productionUrl) throw new Error("Preview URL is missing.");
      await admin.from("commerce_storefront_provisioning").update({
        status: "live",
        production_url: productionUrl,
        launched_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: null,
        error_step: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "live", production_url: productionUrl });
    }

    step = "github_repository";
    const repository = await ensureRepository(job, client.business_name);
    await admin.from("commerce_storefront_provisioning").update({
      status: "repository_created",
      repository_owner: repository.owner?.login,
      repository_name: repository.name,
      repository_url: repository.html_url,
      repository_id: repository.id,
      provider_metadata: { ...(job.provider_metadata || {}), github_full_name: repository.full_name },
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lock_token", workerToken);

    step = "netlify_site";
    const site = await ensureNetlifySite(job, repository.full_name, storefront.store_slug);
    const siteId = String(site.id);
    await admin.from("commerce_storefront_provisioning").update({
      status: "preview_building",
      netlify_site_id: siteId,
      netlify_site_name: site.name,
      preview_url: site.ssl_url || site.url || null,
      provider_metadata: {
        ...(job.provider_metadata || {}),
        github_full_name: repository.full_name,
        netlify_admin_url: site.admin_url,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lock_token", workerToken);

    step = "preview_build";
    const preview = await waitForPreview(siteId, requiredSecret("NETLIFY_ACCESS_TOKEN"));
    if (!preview.ready) {
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: "Netlify is still building. The worker will resume safely.",
        error_step: "preview_building",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "preview_building" });
    }

    await admin.from("commerce_storefront_provisioning").update({
      status: "preview_ready",
      preview_url: preview.previewUrl,
      preview_ready_at: new Date().toISOString(),
      locked_at: null,
      lock_token: null,
      last_error: null,
      error_step: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lock_token", workerToken);

    return response({ ok: true, job_id: job.id, status: "preview_ready", preview_url: preview.previewUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provisioning failure";
    await admin.from("commerce_storefront_provisioning").update({
      status: "failed",
      last_error: message.slice(0, 2000),
      error_step: step,
      locked_at: null,
      lock_token: null,
      next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lock_token", workerToken);
    return response({ error: message, job_id: job.id, error_step: step }, 500);
  }
});
