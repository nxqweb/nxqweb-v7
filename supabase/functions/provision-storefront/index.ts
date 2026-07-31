import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const githubHeaders = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2026-03-10",
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

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
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

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: githubHeaders(jwt),
    body: JSON.stringify({ permissions: { administration: "write", contents: "write", metadata: "read" } }),
  });
  const body = await responseJson(response);
  if (!response.ok || !body?.token) {
    throw new Error(`GitHub installation token failed (${response.status}): ${body?.message || "Unknown GitHub error"}`);
  }
  return body.token as string;
}

async function ensureRepository(job: any, businessName: string) {
  const owner = requiredSecret("GITHUB_REPOSITORY_OWNER");
  const templateOwner = requiredSecret("GITHUB_TEMPLATE_OWNER");
  const templateRepo = requiredSecret("GITHUB_TEMPLATE_REPO");
  const token = await githubInstallationToken();
  const repositoryName = job.repository_name || `${slugify(businessName)}-storefront`;

  const existing = await fetch(`https://api.github.com/repos/${owner}/${repositoryName}`, {
    headers: githubHeaders(token),
  });
  if (existing.ok) {
    const repository = await responseJson(existing);
    return repository;
  }
  if (existing.status !== 404) {
    const body = await responseJson(existing);
    throw new Error(`GitHub repository lookup failed (${existing.status}): ${body?.message || "Unknown GitHub error"}`);
  }

  const response = await fetch(`https://api.github.com/repos/${templateOwner}/${templateRepo}/generate`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      owner,
      name: repositoryName,
      description: `${businessName} storefront managed by NXQ Commerce`,
      include_all_branches: false,
      private: true,
    }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(`GitHub repository creation failed (${response.status}): ${body?.message || "Unknown GitHub error"}`);
  }
  return body;
}

async function ensureNetlifySite(job: any, repositoryFullName: string, storefrontSlug: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const siteName = job.netlify_site_name || slugify(repositoryFullName.split("/")[1]);
  const supabaseUrl = requiredSecret("PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requiredSecret("PUBLIC_SUPABASE_ANON_KEY");

  if (job.netlify_site_id) {
    const existing = await fetch(`https://api.netlify.com/api/v1/sites/${job.netlify_site_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (existing.ok) return await responseJson(existing);
  }

  const response = await fetch("https://api.netlify.com/api/v1/sites", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: siteName,
      repo: {
        provider: "github",
        repo: repositoryFullName,
        branch: "main",
        cmd: "npm run build",
        dir: "dist",
      },
      build_settings: {
        env: {
          VITE_SUPABASE_URL: supabaseUrl,
          VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
          VITE_STOREFRONT_SLUG: storefrontSlug,
        },
      },
    }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Netlify site creation failed (${response.status}): ${body?.message || body?.error || "Unknown Netlify error"}`);
  }
  return body;
}

async function waitForPreview(siteId: string, token: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const site = await responseJson(response);
    if (!response.ok) throw new Error(`Netlify status check failed (${response.status}): ${site?.message || "Unknown Netlify error"}`);
    const deploy = site?.published_deploy;
    if (deploy?.state === "ready") {
      return { ready: true, previewUrl: deploy.ssl_url || deploy.deploy_ssl_url || site.ssl_url || site.url, site };
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

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || userData.user?.email?.toLowerCase() !== "nxqweb@protonmail.com") {
    return new Response(JSON.stringify({ error: "Owner access required." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const workerToken = crypto.randomUUID();
  const claim = await admin.rpc("claim_next_storefront_provisioning_job", { worker_token: workerToken });
  if (claim.error) {
    return new Response(JSON.stringify({ error: claim.error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const job = claim.data;
  if (!job) {
    return new Response(JSON.stringify({ ok: true, message: "No provisioning jobs are ready." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
      return new Response(JSON.stringify({ ok: true, job_id: job.id, status: "live", production_url: productionUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      provider_metadata: { ...(job.provider_metadata || {}), github_full_name: repository.full_name, netlify_admin_url: site.admin_url },
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
      return new Response(JSON.stringify({ ok: true, job_id: job.id, status: "preview_building" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    return new Response(JSON.stringify({ ok: true, job_id: job.id, status: "preview_ready", preview_url: preview.previewUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

    return new Response(JSON.stringify({ error: message, job_id: job.id, error_step: step }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
