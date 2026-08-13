import { createClient } from "npm:@supabase/supabase-js@2";

type AutomationJob = {
  id: string;
  client_id: string;
  project_id?: string | null;
  result?: Record<string, unknown> | null;
};

const workerName = "prepare-build-plan";
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
  if (!normalized || typeof normalized !== "object") throw new Error("Build-plan claim returned an invalid job shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id) throw new Error("Build-plan claim is missing job or client id.");
  return job;
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
    target_execution_target: "ai",
    worker_name: workerName,
    target_job_types: ["prepare_build_plan"],
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: AutomationJob | null;
  try { job = normalizeJob(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid build-plan claim." }, 500); }
  if (!job) return response({ ok: true, message: "No build-plan jobs are ready." });

  try {
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

    const intake = intakeRes.data;
    const businessName = clean(clientRes.data.business_name) || clean(intake.business_name);
    const businessType = clean(intake.business_type) || clean(clientRes.data.business_type);
    const services = listFromText(intake.services);
    const goals = clean(intake.goals);
    const desiredStyle = clean(intake.desired_style);
    const serviceArea = clean(intake.service_area) || clean(clientRes.data.service_area);
    const pages = suggestedPages(services, businessType);

    let familySlug = clean(intake.product_family_slug) || "business";
    if (clientRes.data.product_family_id) {
      const familyRes = await admin.from("product_families").select("slug").eq("id", clientRes.data.product_family_id).maybeSingle();
      if (familyRes.data?.slug) familySlug = familyRes.data.slug;
    }

    let tierKey = clean(intake.product_tier_key) || "starter";
    if (clientRes.data.product_tier_id) {
      const tierRes = await admin.from("product_family_tiers").select("tier_key").eq("id", clientRes.data.product_tier_id).maybeSingle();
      if (tierRes.data?.tier_key) tierKey = tierRes.data.tier_key;
    }

    const buildPlan = {
      version: "v2-deterministic-foundation",
      generated_by: "nxq_build_plan_worker",
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
      goals,
      desired_style: desiredStyle,
      services,
      information_architecture: {
        pages,
        primary_cta: "Contact us",
        mobile_first: true,
        local_seo: Boolean(serviceArea),
      },
      quality_requirements: {
        responsive: true,
        accessibility_baseline: true,
        seo_metadata: true,
        performance_budget: true,
        production_auto_publish: false,
      },
      source: {
        client_intake_id: intake.id,
        owner_approval_required: true,
        owner_approval_confirmed: true,
      },
      created_at: new Date().toISOString(),
    };

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
        website_automation_bootstrap: bootstrap.data,
      },
    });
    if (completed.error) throw new Error(completed.error.message);

    return response({
      ok: true,
      job_id: job.id,
      project_id: projectId,
      build_plan_version: buildPlan.version,
      website_automation_bootstrap: bootstrap.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown build-plan failure.";
    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist build-plan failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});
