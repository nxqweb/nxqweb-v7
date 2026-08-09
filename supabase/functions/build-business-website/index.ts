import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";
import type { DynamicDatabase } from "../_shared/dynamic-database.ts";

type AutomationJob = {
  id: string;
  client_id: string;
  project_id: string;
  job_type: string;
  payload?: Record<string, unknown> | null;
};

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient<DynamicDatabase>>;

const workerName = "build-business-website";
const headers = { "Content-Type": "application/json" };
const blueprintFiles = ["index.html", "app.js", "styles.css", "lead-form.js", "analytics.js"];
const supportedThemeKeys = new Set(["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"]);

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
  if (!normalized || typeof normalized !== "object") throw new Error("Website build claim returned an invalid job shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id || !job.project_id || !job.job_type) throw new Error("Website build claim is missing required ids.");
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
  if (!res.ok) return null;
  const body = await readJson(res);
  return typeof body?.object?.sha === "string" ? body.object.sha : null;
}

async function ensureSafeBranch(owner: string, repo: string, sourceBranch: string, token: string) {
  const existing = await getBranchSha(owner, repo, sourceBranch, token);
  if (existing) return existing;

  const mainSha = await getBranchSha(owner, repo, "main", token);
  if (!mainSha) throw new Error("Client repository main branch is not ready.");
  const res = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${sourceBranch}`, sha: mainSha }),
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(`GitHub safe branch creation failed (${res.status}): ${String(body?.message || "Unknown error")}`);
  }
  return mainSha;
}

async function fetchBlueprintFile(path: string, token: string) {
  const owner = requiredSecret("NXQ_AUTOMATION_SOURCE_OWNER");
  const repo = requiredSecret("NXQ_AUTOMATION_SOURCE_REPO");
  const ref = Deno.env.get("NXQ_AUTOMATION_SOURCE_REF")?.trim() || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/templates/business-v1/${path}?ref=${encodeURIComponent(ref)}`;
  const res = await timedFetch(url, { headers: githubHeaders(token) });
  const body = await readJson(res);
  if (!res.ok || typeof body?.content !== "string") throw new Error(`Business blueprint ${path} could not be loaded.`);
  return body.content.replace(/\n/g, "");
}

async function upsertRepoFile(owner: string, repo: string, branch: string, path: string, base64Content: string, token: string, message: string) {
  const lookup = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(token),
  });
  let sha: string | undefined;
  if (lookup.ok) {
    const existing = await readJson(lookup);
    if (typeof existing?.sha === "string") sha = existing.sha;
  } else if (lookup.status !== 404) {
    throw new Error(`GitHub file lookup failed for ${path} (${lookup.status}).`);
  }

  const res = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify({ message, content: base64Content, branch, ...(sha ? { sha } : {}) }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(`GitHub file write failed for ${path} (${res.status}): ${String(body?.message || "Unknown error")}`);
  return body;
}

function encodeBase64(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function textList(value: unknown, max: number) {
  return Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean).slice(0, max) : [];
}

function serviceDescription(service: string, businessType: string) {
  return `${service} from a professional ${businessType || "local service"} team, with clear communication and a straightforward path to getting started.`;
}

function buildSiteConfig(buildPlan: JsonRecord, runtime: JsonRecord = {}) {
  const business = record(buildPlan.business);
  const architecture = record(buildPlan.information_architecture);
  const enrichment = record(buildPlan.ai_enrichment);
  const enrichmentValidated = enrichment.status === "validated"
    && enrichment.deterministic_safety_merge === true
    && enrichment.schema_version === "nxq-business-build-plan-v1";
  const contentStrategy = enrichmentValidated ? record(buildPlan.content_strategy) : {};
  const designStrategy = enrichmentValidated ? record(buildPlan.design_strategy) : {};
  const hero = record(contentStrategy.hero);
  const strategySeo = record(contentStrategy.seo);
  const services = Array.isArray(buildPlan.services) ? buildPlan.services.map(String).filter(Boolean).slice(0, 8) : [];
  const serviceCopy = Array.isArray(contentStrategy.service_descriptions)
    ? contentStrategy.service_descriptions.map(record)
    : [];
  const serviceCopyLookup = new Map(serviceCopy.map((item) => [clean(item.service).toLowerCase(), clean(item.description)]));
  const businessName = clean(business.name) || "Local Business";
  const businessType = clean(business.type) || "local service business";
  const serviceArea = clean(business.service_area);
  const goals = clean(buildPlan.goals);
  const desiredStyle = clean(buildPlan.desired_style);
  const primaryCta = clean(architecture.primary_cta) || "Contact us";
  const secondaryCta = clean(architecture.secondary_cta) || "View Services";
  const tierKey = clean(buildPlan.product_tier_key).toLowerCase() || "starter";
  const requestedThemeKey = clean(designStrategy.theme_key).toLowerCase();
  const themeKey = supportedThemeKeys.has(requestedThemeKey) ? requestedThemeKey : "midnight_blue";
  const analyticsEndpoint = clean(runtime.analytics_endpoint);
  const analyticsIngestKey = clean(runtime.analytics_ingest_key);
  const analyticsProfileEnabled = runtime.analytics_profile_enabled === true;
  const leadEndpoint = clean(runtime.lead_endpoint);
  const leadFormKey = clean(runtime.lead_form_key);
  const advancedAnalytics = ["growth", "intelligence", "enterprise"].includes(tierKey);
  const mouseTracking = ["intelligence", "enterprise"].includes(tierKey);

  return {
    schemaVersion: "nxq-business-v1",
    business: {
      name: businessName,
      type: businessType,
      phone: clean(business.contact_phone),
      email: clean(business.contact_email),
      serviceArea,
    },
    brand: {
      eyebrow: clean(hero.eyebrow) || (serviceArea ? `Serving ${serviceArea}` : "Trusted local service"),
      headline: clean(hero.headline) || `${businessName}. Professional service. Clear results.`,
      subheadline: clean(hero.subheadline) || goals || `Premium ${businessType} services with clear communication and dependable support.`,
      primaryCta,
      secondaryCta,
      styleDirection: desiredStyle,
      positioning: clean(contentStrategy.positioning),
      valueProposition: clean(contentStrategy.value_proposition),
      voice: clean(contentStrategy.voice),
    },
    services: services.length ? services.map((service) => ({
      title: service,
      description: serviceCopyLookup.get(service.toLowerCase()) || serviceDescription(service, businessType),
    })) : [
      { title: "Professional Service", description: serviceDescription("Professional service", businessType) },
    ],
    trust: {
      heading: "Built around trust and reliable service",
      points: textList(contentStrategy.trust_points, 6).length >= 3
        ? textList(contentStrategy.trust_points, 6)
        : ["Clear communication", "Professional service", serviceArea ? `Local to ${serviceArea}` : "Local support", "Straightforward next steps"],
    },
    about: {
      heading: `${businessName} is focused on doing the job right`,
      body: clean(contentStrategy.about_summary) || goals || `${businessName} provides ${businessType} services with a focus on reliable work, clear communication, and a strong customer experience.`,
    },
    seo: {
      title: clean(strategySeo.title) || `${businessName} | ${businessType}`,
      description: clean(strategySeo.description) || `${businessName} provides ${businessType} services${serviceArea ? ` in ${serviceArea}` : ""}. Contact the team to get started.`.slice(0, 155),
      keywords: textList(strategySeo.keywords, 10),
    },
    design: {
      themeKey,
      mood: clean(designStrategy.mood),
      paletteGuidance: textList(designStrategy.palette_guidance, 6),
      typographyGuidance: clean(designStrategy.typography_guidance),
      motionGuidance: clean(designStrategy.motion_guidance),
      selectedThroughDeterministicAllowlist: true,
    },
    strategy: {
      audiences: textList(contentStrategy.audiences, 5),
      aiEnrichmentValidated: enrichmentValidated,
      pageStrategy: Array.isArray(architecture.page_strategy) ? architecture.page_strategy.slice(0, 8) : [],
    },
    leads: {
      enabled: Boolean(leadEndpoint && leadFormKey),
      endpoint: leadEndpoint,
      formKey: leadFormKey,
    },
    analytics: {
      enabled: advancedAnalytics && analyticsProfileEnabled && Boolean(analyticsEndpoint && analyticsIngestKey),
      endpoint: analyticsEndpoint,
      ingestKey: analyticsIngestKey,
      consentRequired: true,
      consentVersion: "v1",
      clicks: true,
      scrollDepth: true,
      mouseTracking,
    },
  };
}

async function updateStep(admin: AdminClient, runId: string, stepKey: string, status: string, output: JsonRecord = {}) {
  const patch: JsonRecord = { status, output };
  if (status === "running") patch.started_at = new Date().toISOString();
  if (["completed", "failed", "blocked", "skipped"].includes(status)) patch.completed_at = new Date().toISOString();
  const res = await admin.from("website_automation_steps").update(patch).eq("run_id", runId).eq("step_key", stepKey);
  if (res.error) throw new Error(`Website step ${stepKey} update failed: ${res.error.message}`);
}

async function triggerBranchBuild(siteId: string, branch: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=${encodeURIComponent(branch)}&clear_cache=true`, {
    method: "POST",
    headers: netlifyHeaders(token),
    body: "{}",
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(`Netlify preview build failed to start (${res.status}): ${String(body?.message || body?.error || "Unknown error")}`);
  return body;
}

async function findReadyBranchDeploy(siteId: string, branch: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`, {
    headers: netlifyHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body)) throw new Error(`Netlify preview lookup failed (${res.status}).`);
  const deploy = body.find((item: JsonRecord) => item.branch === branch || item.context === `branch-deploy` && item.branch === branch);
  if (!deploy) return null;
  if (deploy.state === "error") throw new Error(`Netlify branch preview failed: ${String(deploy.error_message || "Unknown build error")}`);
  if (deploy.state !== "ready") return null;
  return {
    id: String(deploy.id || ""),
    url: String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || ""),
  };
}

async function processBuild(admin: AdminClient, job: AutomationJob) {
  const [clientRes, projectRes, configRes, approvalRes] = await Promise.all([
    admin.from("clients").select("id,status,business_name").eq("id", job.client_id).single(),
    admin.from("projects").select("id,build_plan,product_family_id").eq("id", job.project_id).eq("client_id", job.client_id).single(),
    admin.from("project_deployment_configs").select("github_owner,github_repo,netlify_site_id").eq("project_id", job.project_id).single(),
    admin.from("owner_approval_requests").select("id").eq("client_id", job.client_id).eq("request_type", "website_setup_review").eq("status", "accepted").limit(1).maybeSingle(),
  ]);
  if (!clientRes.data || !["approved", "active"].includes(String(clientRes.data.status))) throw new Error("Client is not approved for website generation.");
  if (!approvalRes.data) throw new Error("Accepted owner approval is required for website generation.");
  if (!projectRes.data?.build_plan || Object.keys(projectRes.data.build_plan).length === 0) throw new Error("Website build plan is not ready.");
  if (!configRes.data?.github_owner || !configRes.data?.github_repo || !configRes.data?.netlify_site_id) throw new Error("Project infrastructure is not ready yet.");

  let familySlug = "business";
  if (projectRes.data.product_family_id) {
    const family = await admin.from("product_families").select("slug").eq("id", projectRes.data.product_family_id).single();
    familySlug = String(family.data?.slug || "business");
  }
  if (familySlug !== "business") throw new Error(`Business website worker cannot build product family ${familySlug}.`);

  const runRes = await admin.from("website_automation_runs").select("id,source_branch,status").eq("project_id", job.project_id)
    .not("status", "in", '(published,failed,cancelled)').order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!runRes.data?.id) throw new Error("Website automation run was not found.");
  const runId = runRes.data.id;
  const sourceBranch = String(runRes.data.source_branch);

  const analyticsEndpoint = Deno.env.get("NXQ_PUBLIC_ANALYTICS_ENDPOINT")?.trim() || "";
  const leadEndpoint = Deno.env.get("NXQ_PUBLIC_LEAD_ENDPOINT")?.trim() || "";
  const analyticsSetup = await admin.rpc("configure_website_analytics_for_project", { target_client_id: job.client_id, target_project_id: job.project_id });
  if (analyticsSetup.error) throw new Error(`Analytics profile setup failed: ${analyticsSetup.error.message}`);
  const analyticsProfile = await admin.from("website_analytics_profiles").select("public_ingest_key,status").eq("project_id", job.project_id).single();
  if (analyticsProfile.error) throw new Error(`Analytics profile load failed: ${analyticsProfile.error.message}`);
  if (analyticsEndpoint) {
    const analyticsFlag = await admin.from("website_analytics_profiles").update({ ingest_endpoint_configured: true, updated_at: new Date().toISOString() }).eq("project_id", job.project_id);
    if (analyticsFlag.error) throw new Error(`Analytics endpoint state failed: ${analyticsFlag.error.message}`);
  }
  const leadForm = await admin.rpc("create_default_business_lead_form", { target_client_id: job.client_id, target_project_id: job.project_id });
  if (leadForm.error) throw new Error(`Lead form setup failed: ${leadForm.error.message}`);
  const runtimeConfig: JsonRecord = {
    analytics_endpoint: analyticsEndpoint,
    analytics_ingest_key: String(analyticsProfile.data?.public_ingest_key || ""),
    analytics_profile_enabled: analyticsProfile.data?.status === "enabled",
    lead_endpoint: leadEndpoint,
    lead_form_key: String(leadForm.data || ""),
  };

  const token = await githubInstallationToken();
  await updateStep(admin, runId, "prepare_safe_branch", "running");
  await ensureSafeBranch(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, token);
  await updateStep(admin, runId, "prepare_safe_branch", "completed", { branch: sourceBranch });

  await updateStep(admin, runId, "generate_website_draft", "running");
  for (const file of blueprintFiles) {
    const content = await fetchBlueprintFile(file, token);
    await upsertRepoFile(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, file, content, token, `NXQ Business v1: sync ${file}`);
  }
  const generatedConfig = `export const siteConfig = ${JSON.stringify(buildSiteConfig(projectRes.data.build_plan as JsonRecord, runtimeConfig), null, 2)};\n`;
  await upsertRepoFile(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, "site.config.js", encodeBase64(generatedConfig), token, "NXQ: generate client website config");
  await updateStep(admin, runId, "generate_website_draft", "completed", { blueprint: "business-v1" });

  await updateStep(admin, runId, "run_quality_checks", "running");
  const generated = buildSiteConfig(projectRes.data.build_plan as JsonRecord, runtimeConfig);
  const quality = {
    business_name: Boolean(generated.business.name),
    services: generated.services.length > 0,
    contact_path: Boolean(generated.business.phone || generated.business.email),
    seo_title: Boolean(generated.seo.title),
    safe_branch: sourceBranch !== "main",
    production_auto_publish: false,
  };
  if (!quality.business_name || !quality.services || !quality.contact_path || !quality.seo_title || !quality.safe_branch) {
    throw new Error(`Website quality gate failed: ${JSON.stringify(quality)}`);
  }
  await updateStep(admin, runId, "run_quality_checks", "completed", quality);

  await updateStep(admin, runId, "prepare_preview_request", "running");
  const build = await triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch);
  await updateStep(admin, runId, "prepare_preview_request", "completed", { branch: sourceBranch, netlify_build_id: build?.id || null });
  await admin.from("website_automation_runs").update({ status: "testing", current_step: "preview_building" }).eq("id", runId);

  const queued = await admin.rpc("enqueue_automation_job", {
    target_client_id: job.client_id,
    target_project_id: job.project_id,
    target_job_type: "website_check_preview",
    target_idempotency_key: `website-run:${runId}:check-preview:v1`,
    target_payload: { execution_target: "edge", website_automation_run_id: runId, source_branch: sourceBranch, netlify_site_id: configRes.data.netlify_site_id },
    target_run_after: new Date(Date.now() + 30_000).toISOString(),
    target_priority: 45,
  });
  if (queued.error) throw new Error(`Preview check queue failed: ${queued.error.message}`);

  return { run_id: runId, source_branch: sourceBranch, blueprint: "business-v1", preview_check_job_id: queued.data };
}

async function processPreviewCheck(admin: AdminClient, job: AutomationJob) {
  const payload = job.payload || {};
  const runId = String(payload.website_automation_run_id || "");
  const branch = String(payload.source_branch || "");
  const siteId = String(payload.netlify_site_id || "");
  if (!runId || !branch || !siteId) throw new Error("Preview check job is missing run, branch, or site id.");

  const deploy = await findReadyBranchDeploy(siteId, branch);
  if (!deploy) throw new Error("Netlify preview is still building.");

  await admin.from("website_automation_runs").update({
    status: "preview_ready",
    current_step: "client_review",
  }).eq("id", runId).eq("client_id", job.client_id).eq("project_id", job.project_id);
  await updateStep(admin, runId, "client_review", "completed", { automatic_preview_validation: true, preview_url: deploy.url });

  return { run_id: runId, preview_url: deploy.url, netlify_deploy_id: deploy.id, status: "preview_ready" };
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
    target_job_types: ["website_prepare_safe_branch", "website_check_preview"],
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: AutomationJob | null;
  try { job = normalizeJob(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid website build claim." }, 500); }
  if (!job) return response({ ok: true, message: "No Business website jobs are ready." });

  try {
    const result = job.job_type === "website_prepare_safe_branch"
      ? await processBuild(admin, job)
      : await processPreviewCheck(admin, job);

    const completed = await admin.rpc("complete_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_result: result,
    });
    if (completed.error) throw new Error(completed.error.message);
    return response({ ok: true, job_id: job.id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Business website build failure.";
    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist website build failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});
