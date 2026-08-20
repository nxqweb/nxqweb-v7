import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";
import type { DynamicDatabase } from "../_shared/dynamic-database.ts";
import { getBusinessIndustryPreset, getPresetServiceDescription } from "../_shared/business-industry-presets.ts";

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

type MutationGuardRpcClient = {
  rpc: (fn: never, args?: never) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function assertProviderMutationAllowed(admin: MutationGuardRpcClient, job: AutomationJob) {
  for (const [scopeType, scopeReference] of [["client", job.client_id], ["project", job.project_id]] as const) {
    const allowed = await admin.rpc("nxq_automation_scope_allowed" as never, {
      target_scope_type: scopeType,
      target_scope_reference: scopeReference,
    } as never);
    if (allowed.error) throw new Error(`Automation kill-switch check failed for ${scopeType}: ${allowed.error.message}`);
    if (allowed.data !== true) throw new Error(`Automation is paused by an NXQ ${scopeType} or global kill switch.`);
  }
}

function normalizeJob(value: unknown): AutomationJob | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Website build claim returned an invalid job shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id || !job.project_id || !job.job_type || !job.lock_token) throw new Error("Website build claim is missing required ids.");
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
    const existingContent = typeof existing?.content === "string" ? existing.content.replace(/\s/g, "") : "";
    if (existingContent && existingContent === base64Content.replace(/\s/g, "")) {
      return { unchanged: true, content: { sha } };
    }
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

function clipText(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const candidate = normalized.slice(0, max + 1);
  const boundary = candidate.lastIndexOf(" ");
  const clipped = boundary >= Math.floor(max * 0.7)
    ? candidate.slice(0, boundary)
    : normalized.slice(0, max);
  return clipped.replace(/[-,:;/]+$/g, "").trim();
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
  const industryPreset = getBusinessIndustryPreset(businessType);
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
      eyebrow: clean(hero.eyebrow) || industryPreset?.heroEyebrow(serviceArea) || (serviceArea ? `Serving ${serviceArea}` : "Trusted local service"),
      headline: clean(hero.headline) || industryPreset?.heroHeadline(businessName) || `${businessName}. Professional service. Clear results.`,
      subheadline: clean(hero.subheadline) || goals || industryPreset?.heroSubheadline || `Premium ${businessType} services with clear communication and dependable support.`,
      primaryCta: clean(architecture.primary_cta) || industryPreset?.primaryCta || primaryCta,
      secondaryCta: clean(architecture.secondary_cta) || industryPreset?.secondaryCta || secondaryCta,
      styleDirection: desiredStyle,
      positioning: clean(contentStrategy.positioning),
      valueProposition: clean(contentStrategy.value_proposition),
      voice: clean(contentStrategy.voice),
    },
    services: services.length ? services.map((service) => ({
      title: service,
      description: serviceCopyLookup.get(service.toLowerCase()) || getPresetServiceDescription(industryPreset, service) || serviceDescription(service, businessType),
    })) : [
      { title: "Professional Service", description: serviceDescription("Professional service", businessType) },
    ],
    trust: {
      heading: industryPreset?.trustHeading || "Built around trust and reliable service",
      points: textList(contentStrategy.trust_points, 6).length >= 3
        ? textList(contentStrategy.trust_points, 6)
        : industryPreset?.trustPoints || ["Clear communication", "Professional service", serviceArea ? `Local to ${serviceArea}` : "Local support", "Straightforward next steps"],
    },
    about: {
      heading: `${businessName} is focused on doing the job right`,
      body: clean(contentStrategy.about_summary) || goals || industryPreset?.aboutBody(businessName, serviceArea) || `${businessName} provides ${businessType} services with a focus on reliable work, clear communication, and a strong customer experience.`,
    },
    seo: {
      title: clean(strategySeo.title) || `${businessName} | ${businessType}`,
      description: clipText(clean(strategySeo.description) || `${businessName} provides ${businessType} services${serviceArea ? ` in ${serviceArea}` : ""}. Contact the team to get started.`, 160),
      keywords: textList(strategySeo.keywords, 10).length ? textList(strategySeo.keywords, 10) : (industryPreset?.seoKeywords || []),
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
      industryPresetKey: industryPreset?.key || null,
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

async function activatePreviewBuilds(siteId: string, branch: string) {
  if (!branch || branch === "main") throw new Error("Refusing to activate preview builds for main.");
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const patchRes = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: netlifyHeaders(token),
    body: JSON.stringify({
      build_settings: {
        allowed_branches: [branch],
        stop_builds: false,
      },
    }),
  });
  const patched = await readJson(patchRes);
  if (!patchRes.ok) throw new Error(`Netlify preview build activation failed (${patchRes.status}): ${String((patched as JsonRecord | null)?.message || "Unknown Netlify error")}`);
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

async function findExistingBranchDeploy(siteId: string, branch: string, expectedCommitSha: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`, {
    headers: netlifyHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body)) throw new Error(`Netlify preview reconciliation lookup failed (${res.status}).`);
  const deploy = body.find((item: JsonRecord) =>
    item.branch === branch
    && item.commit_ref === expectedCommitSha
    && (item.context === "branch-deploy" || item.branch === branch)
  );
  if (!deploy) return null;
  if (deploy.state === "error") throw new Error(`Netlify branch preview failed: ${String(deploy.error_message || "Unknown build error")}`);
  return {
    id: String(deploy.id || ""),
    state: String(deploy.state || "unknown"),
    url: String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || ""),
    commitSha: String(deploy.commit_ref || ""),
    reconciled_existing_deploy: true,
  };
}

async function findBranchDeployState(siteId: string, branch: string, expectedCommitSha: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`, {
    headers: netlifyHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body)) throw new Error(`Netlify preview state lookup failed (${res.status}).`);
  const deploy = body.find((item: JsonRecord) =>
    item.branch === branch
    && item.commit_ref === expectedCommitSha
    && (item.context === "branch-deploy" || item.branch === branch)
  );
  if (!deploy) return null;
  return {
    id: String(deploy.id || ""),
    state: String(deploy.state || "unknown"),
    url: String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || ""),
    commitSha: String(deploy.commit_ref || ""),
    createdAt: String(deploy.created_at || ""),
    updatedAt: String(deploy.updated_at || ""),
    errorMessage: String(deploy.error_message || ""),
  };
}

function providerBillingBlockReason(message: string) {
  return /credit usage exceeded|operational credits|production deploys .* paused|account.*credit/i.test(message)
    ? "EXTERNAL_PROVIDER_BILLING_BLOCKER: Netlify deployment capacity is paused by account credits. NXQ preserved the existing repository, safe branch, generated files, and exact commit and will retry after the provider account resumes."
    : "";
}

function providerCapacityBlockReason(deploy: { state: string; createdAt: string; updatedAt: string } | null, waitStartedAt: string) {
  if (deploy && ["ready", "error"].includes(deploy.state)) return "";
  const started = Date.parse(deploy?.createdAt || deploy?.updatedAt || waitStartedAt);
  if (!Number.isFinite(started)) return "";
  const ageMs = Date.now() - started;
  if (ageMs < 20 * 60 * 1000) return "";
  return deploy
    ? `EXTERNAL_PROVIDER_CAPACITY_BLOCKER: Netlify preview deploy has remained ${deploy.state || "pending"} for more than 20 minutes. NXQ will keep the exact commit queued and retry automatically when provider capacity resumes.`
    : "EXTERNAL_PROVIDER_CAPACITY_BLOCKER: Netlify has not created a preview deploy for the exact commit after 20 minutes. Provider builds may be paused by account credits or capacity. NXQ preserved the repository, safe branch, generated files, and exact commit and will retry automatically.";
}

async function findReadyBranchDeploy(siteId: string, branch: string, expectedCommitSha: string) {
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const res = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`, {
    headers: netlifyHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body)) throw new Error(`Netlify preview lookup failed (${res.status}).`);
  const deploy = body.find((item: JsonRecord) =>
    item.branch === branch
    && item.commit_ref === expectedCommitSha
    && (item.context === "branch-deploy" || item.branch === branch)
  );
  if (!deploy) return null;
  if (deploy.state === "error") throw new Error(`Netlify branch preview failed: ${String(deploy.error_message || "Unknown build error")}`);
  if (deploy.state !== "ready") return null;
  return {
    id: String(deploy.id || ""),
    url: String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || ""),
    commitSha: String(deploy.commit_ref || ""),
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
  await assertProviderMutationAllowed(admin, job);
  await ensureSafeBranch(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, token);
  await updateStep(admin, runId, "prepare_safe_branch", "completed", { branch: sourceBranch });

  await updateStep(admin, runId, "generate_website_draft", "running");
  for (const file of blueprintFiles) {
    const content = await fetchBlueprintFile(file, token);
    await assertProviderMutationAllowed(admin, job);
    await upsertRepoFile(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, file, content, token, `NXQ Business v1: sync ${file}`);
  }
  const generatedConfig = `export const siteConfig = ${JSON.stringify(buildSiteConfig(projectRes.data.build_plan as JsonRecord, runtimeConfig), null, 2)};\n`;
  await assertProviderMutationAllowed(admin, job);
  await upsertRepoFile(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, "site.config.js", encodeBase64(generatedConfig), token, "NXQ: generate client website config");
  const expectedPreviewCommitSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, token);
  if (!expectedPreviewCommitSha) throw new Error("Generated preview branch commit could not be resolved.");
  await updateStep(admin, runId, "generate_website_draft", "completed", { blueprint: "business-v1", expected_preview_commit_sha: expectedPreviewCommitSha });

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
  await updateStep(admin, runId, "run_quality_checks", "completed", { ...quality, expected_preview_commit_sha: expectedPreviewCommitSha });

  await updateStep(admin, runId, "prepare_preview_request", "running");
  const previewRequestedAt = new Date().toISOString();
  await assertProviderMutationAllowed(admin, job);
  await activatePreviewBuilds(configRes.data.netlify_site_id, sourceBranch);
  let build = await findExistingBranchDeploy(configRes.data.netlify_site_id, sourceBranch, expectedPreviewCommitSha);
  if (!build) {
    await assertProviderMutationAllowed(admin, job);
    const started = await triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch);
    build = started && !Array.isArray(started) ? { ...started, reconciled_existing_deploy: false } : { reconciled_existing_deploy: false };
  }
  await updateStep(admin, runId, "prepare_preview_request", "completed", { branch: sourceBranch, netlify_build_id: build?.id || null, expected_preview_commit_sha: expectedPreviewCommitSha, preview_requested_at: previewRequestedAt });
  await admin.from("website_automation_runs").update({ status: "testing", current_step: "preview_building" }).eq("id", runId);

  const queued = await admin.rpc("enqueue_automation_job", {
    target_client_id: job.client_id,
    target_project_id: job.project_id,
    target_job_type: "website_check_preview",
    target_idempotency_key: `website-run:${runId}:check-preview:v1`,
    target_payload: { execution_target: "edge", website_automation_run_id: runId, source_branch: sourceBranch, netlify_site_id: configRes.data.netlify_site_id, expected_preview_commit_sha: expectedPreviewCommitSha, preview_requested_at: previewRequestedAt },
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
  const expectedPreviewCommitSha = String(payload.expected_preview_commit_sha || "");
  if (!runId || !branch || !siteId || !expectedPreviewCommitSha) throw new Error("Preview check job is missing run, branch, site id, or expected commit.");

  let previewRequestedAt = String(payload.preview_requested_at || "");
  if (!previewRequestedAt) {
    const previewStep = await admin.from("website_automation_steps")
      .select("completed_at,started_at,created_at")
      .eq("run_id", runId)
      .eq("step_key", "prepare_preview_request")
      .maybeSingle();
    previewRequestedAt = String(previewStep.data?.completed_at || previewStep.data?.started_at || previewStep.data?.created_at || "");
  }

  const deployState = await findBranchDeployState(siteId, branch, expectedPreviewCommitSha);
  if (deployState?.state === "error") {
    throw new Error(`Netlify branch preview failed: ${deployState.errorMessage || "Unknown build error"}`);
  }
  if (!deployState || deployState.state !== "ready") {
    const capacityReason = providerCapacityBlockReason(deployState, previewRequestedAt);
    const deferred = await admin.rpc("defer_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_reason: capacityReason || "Netlify preview is still building.",
      retry_after: capacityReason ? "5 minutes" : "30 seconds",
    });
    if (deferred.error) throw new Error(`Preview wait deferral failed: ${deferred.error.message}`);
    return { run_id: runId, status: "preview_building", deferred: true, provider_blocked: Boolean(capacityReason) };
  }

  const deploy = await findReadyBranchDeploy(siteId, branch, expectedPreviewCommitSha);
  if (!deploy) {
    const deferred = await admin.rpc("defer_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_reason: "Netlify preview readiness changed during verification; retrying exact commit.",
      retry_after: "30 seconds",
    });
    if (deferred.error) throw new Error(`Preview verification deferral failed: ${deferred.error.message}`);
    return { run_id: runId, status: "preview_building", deferred: true };
  }

  await admin.from("website_automation_runs").update({
    status: "preview_ready",
    current_step: "client_review",
  }).eq("id", runId).eq("client_id", job.client_id).eq("project_id", job.project_id);
  if (deploy.commitSha !== expectedPreviewCommitSha) throw new Error("Netlify preview commit does not match the generated source commit.");
  await updateStep(admin, runId, "client_review", "completed", {
    automatic_preview_validation: true,
    preview_url: deploy.url,
    netlify_deploy_id: deploy.id,
    verified_preview_commit_sha: expectedPreviewCommitSha,
  });

  return { run_id: runId, preview_url: deploy.url, netlify_deploy_id: deploy.id, verified_preview_commit_sha: expectedPreviewCommitSha, status: "preview_ready" };
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
    const message = error instanceof Error ? error.message : "Unknown Business website build failure.";
    const billingBlocker = providerBillingBlockReason(message);
    if (billingBlocker) {
      const deferred = await admin.rpc("defer_external_automation_job_v2", {
        target_job_id: job.id,
        target_lock_token: job.lock_token,
        worker_name: workerName,
        target_reason: billingBlocker,
        retry_after: "24 hours",
      });
      if (!deferred.error) {
        return response({ ok: true, job_id: job.id, deferred: true, provider_blocked: true, blocker: billingBlocker });
      }
      console.error("Failed to defer Netlify billing blocker", deferred.error.message);
    }
    const failed = await admin.rpc("fail_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist website build failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});
