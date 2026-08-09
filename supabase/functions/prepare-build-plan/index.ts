import { createClient } from "npm:@supabase/supabase-js@2";

type AutomationJob = {
  id: string;
  client_id: string;
  project_id?: string | null;
};

type JsonRecord = Record<string, unknown>;
type AiServiceCopy = { service: string; description: string };
type AiPageStrategy = { page: string; objective: string; sections: string[] };
type AiBuildStrategy = {
  positioning: string;
  audiences: string[];
  value_proposition: string;
  voice: string;
  hero: { eyebrow: string; headline: string; subheadline: string };
  service_descriptions: AiServiceCopy[];
  trust_points: string[];
  about_summary: string;
  seo: { title: string; description: string; keywords: string[] };
  page_strategy: AiPageStrategy[];
  design: {
    theme_key: string;
    mood: string;
    palette_guidance: string[];
    typography_guidance: string;
    motion_guidance: string;
  };
};
type AiAdapterResult = {
  schema_version: string;
  request_fingerprint: string;
  confidence: number;
  risk_flags: string[];
  strategy: AiBuildStrategy;
};

const workerName = "prepare-build-plan";
const workerVersion = "v3-ai-enriched-business";
const adapterSchemaVersion = "nxq-business-build-plan-v1";
const minimumConfidence = 0.82;
const supportedThemes = new Set(["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"]);
const headers = { "Content-Type": "application/json" };

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function optionalSecret(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeJob(value: unknown): AutomationJob | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Build-plan claim returned an invalid job shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id) throw new Error("Build-plan claim is missing job or client id.");
  return job;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function listFromText(value: unknown) {
  return clean(value)
    .split(/\n|,|;|\u2022|\|/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function suggestedPages(services: string[], businessType: string) {
  const pages = ["Home", "About", "Services", "Contact"];
  if (services.length >= 4) pages.splice(3, 0, "Service Areas");
  if (/roof|tree|hvac|plumb|electric|contract|detail|auto|landscap|clean/i.test(businessType)) pages.splice(3, 0, "Reviews");
  return [...new Set(pages)];
}

function unsafeAiText(value: string) {
  const containsControlData = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || code >= 14 && code <= 31;
  });
  return containsControlData || /[<>]|(?:https?:\/\/|javascript:|data:|mailto:|tel:)/i.test(value);
}

function aiText(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new Error(`AI build-plan ${label} must be text.`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`AI build-plan ${label} must be between ${min} and ${max} characters.`);
  }
  if (unsafeAiText(normalized)) throw new Error(`AI build-plan ${label} contains disallowed markup, control data, or links.`);
  return normalized;
}

function aiTextList(value: unknown, label: string, minItems: number, maxItems: number, itemMax: number) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new Error(`AI build-plan ${label} must contain ${minItems}-${maxItems} items.`);
  }
  const normalized = value.map((item, index) => aiText(item, `${label}[${index}]`, 2, itemMax));
  if (new Set(normalized.map((item) => item.toLowerCase())).size !== normalized.length) {
    throw new Error(`AI build-plan ${label} cannot contain duplicates.`);
  }
  return normalized;
}

function validateAdapterUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const privateIpv6 = host === "::1" || host === "[::1]" || /^\[(?:fc|fd|fe[89ab])/i.test(host);
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || privateIpv4 || privateIpv6) {
    throw new Error("AI build-plan adapter URL must be a credential-free public HTTPS endpoint.");
  }
  return url.toString();
}

function canonicalLookup(values: string[]) {
  return new Map(values.map((value) => [value.trim().toLowerCase(), value]));
}

function validateAiStrategy(value: unknown, services: string[], pages: string[]) {
  const root = record(value);
  const strategy = record(root.strategy);
  const schemaVersion = clean(root.schema_version);
  const requestFingerprint = clean(root.request_fingerprint);
  const confidence = Number(root.confidence);
  if (!Array.isArray(root.risk_flags)) throw new Error("AI build-plan adapter must return an explicit risk_flags array.");
  const riskFlags = root.risk_flags.map((item) => clean(item)).filter(Boolean);
  if (schemaVersion !== adapterSchemaVersion) throw new Error("AI build-plan adapter returned an unsupported schema version.");
  if (!requestFingerprint) throw new Error("AI build-plan adapter omitted the request fingerprint.");
  if (!Number.isFinite(confidence) || confidence < minimumConfidence || confidence > 1) {
    throw new Error(`AI build-plan confidence must be between ${minimumConfidence} and 1.`);
  }
  if (riskFlags.length > 0) throw new Error("AI build-plan adapter reported risk flags; automatic generation was stopped.");

  const hero = record(strategy.hero);
  const seo = record(strategy.seo);
  const design = record(strategy.design);
  const serviceLookup = canonicalLookup(services.slice(0, 8));
  const pageLookup = canonicalLookup(pages);
  const rawServices = Array.isArray(strategy.service_descriptions) ? strategy.service_descriptions : [];
  const rawPages = Array.isArray(strategy.page_strategy) ? strategy.page_strategy : [];
  if (rawServices.length !== serviceLookup.size) throw new Error("AI build-plan must describe every generated service exactly once.");
  if (rawPages.length !== pageLookup.size) throw new Error("AI build-plan must describe every approved page exactly once.");

  const serviceDescriptions: AiServiceCopy[] = rawServices.map((raw, index) => {
    const item = record(raw);
    const requestedService = aiText(item.service, `service_descriptions[${index}].service`, 2, 120);
    const canonicalService = serviceLookup.get(requestedService.toLowerCase());
    if (!canonicalService) throw new Error("AI build-plan attempted to add or rename an approved service.");
    return {
      service: canonicalService,
      description: aiText(item.description, `service_descriptions[${index}].description`, 30, 280),
    };
  });
  if (new Set(serviceDescriptions.map((item) => item.service.toLowerCase())).size !== serviceLookup.size) {
    throw new Error("AI build-plan service descriptions contain duplicates or omissions.");
  }

  const pageStrategy: AiPageStrategy[] = rawPages.map((raw, index) => {
    const item = record(raw);
    const requestedPage = aiText(item.page, `page_strategy[${index}].page`, 2, 80);
    const canonicalPage = pageLookup.get(requestedPage.toLowerCase());
    if (!canonicalPage) throw new Error("AI build-plan attempted to add an unapproved page.");
    return {
      page: canonicalPage,
      objective: aiText(item.objective, `page_strategy[${index}].objective`, 20, 240),
      sections: aiTextList(item.sections, `page_strategy[${index}].sections`, 2, 8, 100),
    };
  });
  if (new Set(pageStrategy.map((item) => item.page.toLowerCase())).size !== pageLookup.size) {
    throw new Error("AI build-plan page strategy contains duplicates or omissions.");
  }

  const themeKey = clean(design.theme_key).toLowerCase();
  if (!supportedThemes.has(themeKey)) throw new Error("AI build-plan selected a theme outside the deterministic allowlist.");

  return {
    schema_version: schemaVersion,
    request_fingerprint: requestFingerprint,
    confidence,
    risk_flags: riskFlags,
    strategy: {
      positioning: aiText(strategy.positioning, "positioning", 20, 300),
      audiences: aiTextList(strategy.audiences, "audiences", 1, 5, 120),
      value_proposition: aiText(strategy.value_proposition, "value_proposition", 25, 320),
      voice: aiText(strategy.voice, "voice", 10, 180),
      hero: {
        eyebrow: aiText(hero.eyebrow, "hero.eyebrow", 3, 80),
        headline: aiText(hero.headline, "hero.headline", 12, 110),
        subheadline: aiText(hero.subheadline, "hero.subheadline", 35, 260),
      },
      service_descriptions: serviceDescriptions,
      trust_points: aiTextList(strategy.trust_points, "trust_points", 3, 6, 100),
      about_summary: aiText(strategy.about_summary, "about_summary", 60, 600),
      seo: {
        title: aiText(seo.title, "seo.title", 12, 60),
        description: aiText(seo.description, "seo.description", 50, 160),
        keywords: aiTextList(seo.keywords, "seo.keywords", 3, 10, 80),
      },
      page_strategy: pageStrategy,
      design: {
        theme_key: themeKey,
        mood: aiText(design.mood, "design.mood", 10, 180),
        palette_guidance: aiTextList(design.palette_guidance, "design.palette_guidance", 2, 6, 100),
        typography_guidance: aiText(design.typography_guidance, "design.typography_guidance", 10, 180),
        motion_guidance: aiText(design.motion_guidance, "design.motion_guidance", 10, 180),
      },
    },
  } satisfies AiAdapterResult;
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestAiStrategy(adapterUrl: string, adapterToken: string, requestFingerprint: string, input: JsonRecord, services: string[], pages: string[]) {
  const endpoint = validateAdapterUrl(adapterUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adapterToken}` },
      body: JSON.stringify({
        task: "enrich_business_build_plan_v1",
        schema_version: adapterSchemaVersion,
        request_fingerprint: requestFingerprint,
        input,
        contract: {
          plain_text_only: true,
          no_links_or_markup: true,
          allowed_services: services.slice(0, 8),
          allowed_pages: pages,
          allowed_theme_keys: [...supportedThemes],
          minimum_confidence: minimumConfidence,
          production_or_provider_actions_forbidden: true,
          legal_financial_medical_guarantees_forbidden: true,
        },
      }),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (bodyText.length > 64_000) throw new Error("AI build-plan adapter response exceeded the 64 KB limit.");
    if (!res.ok) throw new Error(`AI build-plan adapter failed with HTTP ${res.status}.`);
    let parsed: unknown;
    try { parsed = bodyText ? JSON.parse(bodyText) : null; }
    catch { throw new Error("AI build-plan adapter returned invalid JSON."); }
    const result = validateAiStrategy(parsed, services, pages);
    if (result.request_fingerprint !== requestFingerprint) {
      throw new Error("AI build-plan adapter fingerprint did not match this intake.");
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function reusableBuildPlan(value: unknown, inputFingerprint: string) {
  const plan = record(value);
  const source = record(plan.source);
  const enrichment = record(plan.ai_enrichment);
  return plan.version === workerVersion
    && source.input_fingerprint === inputFingerprint
    && enrichment.status === "validated"
    && enrichment.schema_version === adapterSchemaVersion
    && enrichment.deterministic_safety_merge === true
    ? plan
    : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "POST required." }, 405);

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const anonKey = requiredSecret("SUPABASE_ANON_KEY");
  const serviceRole = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const internalToken = optionalSecret("NXQ_AUTOMATION_WORKER_TOKEN");
  const suppliedInternalToken = request.headers.get("x-nxq-worker-token")?.trim() || "";
  const authorization = request.headers.get("Authorization") || "";
  const adapterUrl = optionalSecret("NXQ_BUILD_PLAN_AI_ADAPTER_URL");
  const adapterToken = optionalSecret("NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN");
  const adapterConfigured = Boolean(adapterUrl && adapterToken);

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
    target_execution_target: "ai",
    worker_name: workerName,
    target_job_types: ["prepare_build_plan"],
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: AutomationJob | null;
  try { job = normalizeJob(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid build-plan claim." }, 500); }

  await admin.rpc("record_worker_heartbeat", {
    target_worker_key: workerName,
    target_execution_target: "ai",
    target_status: adapterConfigured ? "healthy" : "degraded",
    target_metadata: {
      worker_version: workerVersion,
      adapter_configured: adapterConfigured,
      adapter_schema_version: adapterSchemaVersion,
      deterministic_safety_merge: true,
      checked_at: new Date().toISOString(),
    },
    target_last_error: adapterConfigured ? null : "AI build-plan adapter URL/token are not configured.",
  });

  if (!job) return response({ ok: true, message: "No build-plan jobs are ready.", adapter_configured: adapterConfigured });

  try {
    if (!adapterConfigured) throw new Error("AI build-plan adapter is not configured.");

    const [clientRes, intakeRes, approvalRes] = await Promise.all([
      admin.from("clients").select("id,business_name,status,business_type,service_area,contact_name,contact_email,contact_phone,product_family_id,product_tier_id").eq("id", job.client_id).single(),
      admin.from("client_intakes").select("*").eq("client_id", job.client_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("owner_approval_requests").select("id,status").eq("client_id", job.client_id)
        .eq("request_type", "website_setup_review").eq("status", "accepted").limit(1).maybeSingle(),
    ]);
    if (clientRes.error || !clientRes.data) throw new Error(clientRes.error?.message || "Client not found.");
    if (approvalRes.error || !approvalRes.data) throw new Error("Accepted owner website setup approval is required before build planning.");
    if (!["approved", "active"].includes(String(clientRes.data.status))) {
      throw new Error(`Client status ${clientRes.data.status} is not eligible for build planning.`);
    }
    if (intakeRes.error || !intakeRes.data) throw new Error("Completed client intake is required before build planning.");

    let projectId = job.project_id || "";
    if (!projectId) {
      const projectLookup = await admin.from("projects").select("id").eq("client_id", job.client_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (projectLookup.error || !projectLookup.data?.id) throw new Error("Client project is not ready for build planning.");
      projectId = projectLookup.data.id;
      const jobUpdate = await admin.from("automation_jobs").update({ project_id: projectId }).eq("id", job.id).eq("locked_by", workerName);
      if (jobUpdate.error) throw new Error(jobUpdate.error.message);
    }
    const projectRes = await admin.from("projects").select("id,client_id,build_plan").eq("id", projectId).eq("client_id", job.client_id).single();
    if (projectRes.error || !projectRes.data) throw new Error("Client project does not match the claimed build-plan job.");

    const intake = intakeRes.data;
    const businessName = clean(clientRes.data.business_name) || clean(intake.business_name);
    const businessType = clean(intake.business_type) || clean(clientRes.data.business_type);
    const services = listFromText(intake.services);
    const goals = clean(intake.goals);
    const desiredStyle = clean(intake.desired_style);
    const serviceArea = clean(intake.service_area) || clean(clientRes.data.service_area);
    if (!businessName || !businessType || services.length === 0 || !goals || !desiredStyle) {
      throw new Error("Approved intake is missing required Business build-plan content.");
    }
    const pages = suggestedPages(services, businessType);

    let familySlug = clean(intake.product_family_slug) || "business";
    if (clientRes.data.product_family_id) {
      const familyRes = await admin.from("product_families").select("slug").eq("id", clientRes.data.product_family_id).maybeSingle();
      if (familyRes.data?.slug) familySlug = familyRes.data.slug;
    }
    if (familySlug !== "business") throw new Error(`Business build-plan worker cannot plan product family ${familySlug}.`);

    let tierKey = clean(intake.product_tier_key) || "starter";
    if (clientRes.data.product_tier_id) {
      const tierRes = await admin.from("product_family_tiers").select("tier_key").eq("id", clientRes.data.product_tier_id).maybeSingle();
      if (tierRes.data?.tier_key) tierKey = tierRes.data.tier_key;
    }

    const fingerprintInput = {
      client_id: job.client_id,
      project_id: projectId,
      client_intake_id: intake.id,
      product_family_slug: familySlug,
      product_tier_key: tierKey,
      business: {
        name: businessName,
        type: businessType,
        service_area: serviceArea,
        contact_name: clean(intake.contact_name) || clean(clientRes.data.contact_name),
        contact_email: clean(intake.contact_email) || clean(clientRes.data.contact_email),
        contact_phone: clean(intake.contact_phone) || clean(clientRes.data.contact_phone),
      },
      services,
      goals,
      desired_style: desiredStyle,
      pages,
    };
    const inputFingerprint = await sha256(fingerprintInput);
    const existingPlan = reusableBuildPlan(projectRes.data.build_plan, inputFingerprint);
    let buildPlan: JsonRecord;
    let adapterReused = false;

    if (existingPlan) {
      buildPlan = existingPlan;
      adapterReused = true;
    } else {
      // Contact details stay in NXQ's deterministic merge and are intentionally excluded from the AI adapter payload.
      const aiInput = {
        business_name: businessName,
        business_type: businessType,
        service_area: serviceArea,
        services,
        goals,
        desired_style: desiredStyle,
        approved_pages: pages,
        product_tier_key: tierKey,
      };
      const aiResult = await requestAiStrategy(adapterUrl, adapterToken, inputFingerprint, aiInput, services, pages);
      buildPlan = {
        version: workerVersion,
        generated_by: "nxq_ai_build_plan_worker",
        product_family_slug: familySlug,
        product_tier_key: tierKey,
        business: fingerprintInput.business,
        goals,
        desired_style: desiredStyle,
        services,
        information_architecture: {
          pages,
          page_strategy: aiResult.strategy.page_strategy,
          primary_cta: "Contact us",
          secondary_cta: "View Services",
          mobile_first: true,
          local_seo: Boolean(serviceArea),
        },
        content_strategy: {
          positioning: aiResult.strategy.positioning,
          audiences: aiResult.strategy.audiences,
          value_proposition: aiResult.strategy.value_proposition,
          voice: aiResult.strategy.voice,
          hero: aiResult.strategy.hero,
          service_descriptions: aiResult.strategy.service_descriptions,
          trust_points: aiResult.strategy.trust_points,
          about_summary: aiResult.strategy.about_summary,
          seo: aiResult.strategy.seo,
        },
        design_strategy: aiResult.strategy.design,
        quality_requirements: {
          responsive: true,
          accessibility_baseline: true,
          seo_metadata: true,
          performance_budget: true,
          plain_text_content_only: true,
          deterministic_tier_enforcement: true,
          production_auto_publish: false,
        },
        ai_enrichment: {
          status: "validated",
          schema_version: aiResult.schema_version,
          request_fingerprint: inputFingerprint,
          confidence: aiResult.confidence,
          risk_flags: [],
          deterministic_safety_merge: true,
          adapter_contract: "provider_neutral",
          validated_at: new Date().toISOString(),
        },
        source: {
          client_intake_id: intake.id,
          input_fingerprint: inputFingerprint,
          owner_approval_required: true,
          owner_approval_confirmed: true,
        },
        created_at: new Date().toISOString(),
      };
    }

    const projectSave = await admin.from("projects").update({
      build_plan: buildPlan,
      current_blocker: null,
      next_step: "NXQ is preparing the website workspace and first build.",
    }).eq("id", projectId).eq("client_id", job.client_id).select("id").single();
    if (projectSave.error) throw new Error(projectSave.error.message);

    const onboardingSave = await admin.from("client_onboarding_state").update({
      status: "completed",
      missing_fields: [],
      next_step: "NXQ is building your website.",
    }).eq("client_id", job.client_id);
    if (onboardingSave.error) throw new Error(onboardingSave.error.message);

    const bootstrap = await admin.rpc("bootstrap_ready_website_automation");
    if (bootstrap.error) throw new Error(`Website automation bootstrap failed: ${bootstrap.error.message}`);

    const completed = await admin.rpc("complete_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_result: {
        build_plan_version: buildPlan.version,
        project_id: projectId,
        product_family_slug: familySlug,
        product_tier_key: tierKey,
        input_fingerprint: inputFingerprint,
        ai_enrichment_validated: true,
        adapter_response_reused: adapterReused,
        website_automation_bootstrap: bootstrap.data,
      },
    });
    if (completed.error) throw new Error(completed.error.message);

    await admin.rpc("record_worker_heartbeat", {
      target_worker_key: workerName,
      target_execution_target: "ai",
      target_status: "healthy",
      target_metadata: {
        worker_version: workerVersion,
        adapter_configured: true,
        adapter_schema_version: adapterSchemaVersion,
        deterministic_safety_merge: true,
        last_input_fingerprint: inputFingerprint,
        adapter_response_reused: adapterReused,
        last_success_at: new Date().toISOString(),
      },
      target_last_error: null,
    });

    return response({
      ok: true,
      job_id: job.id,
      project_id: projectId,
      build_plan_version: buildPlan.version,
      input_fingerprint: inputFingerprint,
      ai_enrichment_validated: true,
      adapter_response_reused: adapterReused,
      website_automation_bootstrap: bootstrap.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown build-plan failure.";
    await admin.rpc("record_worker_heartbeat", {
      target_worker_key: workerName,
      target_execution_target: "ai",
      target_status: adapterConfigured ? "error" : "degraded",
      target_metadata: {
        worker_version: workerVersion,
        adapter_configured: adapterConfigured,
        adapter_schema_version: adapterSchemaVersion,
        deterministic_safety_merge: true,
        failed_at: new Date().toISOString(),
      },
      target_last_error: message,
    });
    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist build-plan failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});
