import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
type AutomationJob = {
  id: string;
  client_id: string;
  project_id: string;
  payload?: JsonRecord | null;
};

const workerName = "reconcile-domain";
const jsonHeaders = { "Content-Type": "application/json" };

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function normalizeJob(value: unknown): AutomationJob | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Domain job claim returned an invalid shape.");
  const job = normalized as AutomationJob;
  if (!job.id || !job.client_id || !job.project_id) throw new Error("Domain job claim is missing job, client, or project id.");
  return job;
}

function normalizeDomain(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const withoutProtocol = raw.replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
  if (!withoutProtocol || withoutProtocol.length > 253) throw new Error("A valid domain name is required.");
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})$/.test(withoutProtocol)) throw new Error("Localhost and raw IP addresses are not valid client domains.");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(withoutProtocol)) {
    throw new Error("Domain name format is invalid.");
  }
  return withoutProtocol;
}

async function readJson(res: Response): Promise<JsonRecord | null> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

const netlifyHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

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
    target_job_types: ["domain_reconcile"],
  });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let job: AutomationJob | null;
  try { job = normalizeJob(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid domain job claim." }, 500); }
  if (!job) return response({ ok: true, message: "No domain reconciliation jobs are ready." });

  try {
    const domainId = typeof job.payload?.domain_id === "string" ? job.payload.domain_id : "";
    if (!domainId) throw new Error("Domain reconciliation job is missing domain_id.");

    const [clientRes, approvalRes, domainRes, deploymentRes] = await Promise.all([
      admin.from("clients").select("id,status,business_name").eq("id", job.client_id).single(),
      admin.from("owner_approval_requests").select("id").eq("client_id", job.client_id)
        .eq("request_type", "website_setup_review").eq("status", "accepted").limit(1).maybeSingle(),
      admin.from("client_domains").select("id,client_id,domain_name,automation_enabled,automation_state,provider_adapter,provider_connection_ref")
        .eq("id", domainId).eq("client_id", job.client_id).single(),
      admin.from("project_deployment_configs").select("project_id,client_id,netlify_site_id,production_url,last_deployment_status")
        .eq("project_id", job.project_id).eq("client_id", job.client_id).maybeSingle(),
    ]);

    if (clientRes.error || !clientRes.data) throw new Error(clientRes.error?.message || "Client not found.");
    if (approvalRes.error || !approvalRes.data) throw new Error("Accepted owner website setup approval is required for domain automation.");
    if (!["approved", "active"].includes(String(clientRes.data.status))) throw new Error("Client is not eligible for domain automation.");
    if (domainRes.error || !domainRes.data) throw new Error(domainRes.error?.message || "Domain request not found.");
    if (!domainRes.data.automation_enabled) throw new Error("Domain automation is disabled for this domain.");
    if (deploymentRes.error || !deploymentRes.data?.netlify_site_id) throw new Error("Netlify deployment configuration is not ready for this domain.");

    const domain = normalizeDomain(domainRes.data.domain_name);
    const siteId = deploymentRes.data.netlify_site_id;
    const netlifyToken = requiredSecret("NETLIFY_ACCESS_TOKEN");

    const siteLookup = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`, {
      headers: netlifyHeaders(netlifyToken),
    });
    const site = await readJson(siteLookup);
    if (!siteLookup.ok) throw new Error(`Netlify site lookup failed (${siteLookup.status}): ${String(site?.message || "Unknown error")}`);

    if (site?.custom_domain !== domain) {
      const updateSite = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`, {
        method: "PATCH",
        headers: netlifyHeaders(netlifyToken),
        body: JSON.stringify({ custom_domain: domain, force_ssl: true }),
      });
      const updateBody = await readJson(updateSite);
      if (!updateSite.ok) throw new Error(`Netlify custom-domain assignment failed (${updateSite.status}): ${String(updateBody?.message || "Unknown error")}`);
    }

    await admin.from("client_domains").update({
      automation_state: "ssl_provisioning",
      dns_status: "checking",
      ssl_status: "provisioning",
      last_checked_at: new Date().toISOString(),
      automation_error: null,
      action_required_message: null,
    }).eq("id", domainId).eq("client_id", job.client_id);

    const sslRes = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/ssl`, {
      method: "POST",
      headers: netlifyHeaders(netlifyToken),
      body: "{}",
    });
    const sslBody = await readJson(sslRes);

    if (sslRes.ok) {
      const liveUrl = `https://${domain}`;
      await admin.from("client_domains").update({
        automation_state: "connected",
        dns_status: "verified",
        ssl_status: "active",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        automation_error: null,
        action_required_message: null,
      }).eq("id", domainId).eq("client_id", job.client_id);

      await admin.from("project_deployment_configs").update({ production_url: liveUrl })
        .eq("project_id", job.project_id).eq("client_id", job.client_id);

      await admin.from("website_maintenance_plans").update({ monitored_url: liveUrl, status: "active" })
        .eq("project_id", job.project_id).eq("client_id", job.client_id);

      const completed = await admin.rpc("complete_external_automation_job", {
        target_job_id: job.id,
        worker_name: workerName,
        target_result: {
          domain_id: domainId,
          domain_name: domain,
          domain_connected: true,
          ssl_active: true,
          production_url: liveUrl,
          registrar_adapter: domainRes.data.provider_adapter || null,
        },
      });
      if (completed.error) throw new Error(completed.error.message);

      return response({ ok: true, domain_id: domainId, domain_name: domain, connected: true, production_url: liveUrl });
    }

    if (sslRes.status === 422) {
      const providerConnected = Boolean(domainRes.data.provider_adapter && domainRes.data.provider_connection_ref);
      const actionMessage = providerConnected
        ? "The registrar adapter is connected, but DNS is not pointing to Netlify yet. NXQ will keep reconciling automatically."
        : `Point ${domain} to the NXQ/Netlify site using your registrar's DNS settings. NXQ will recheck automatically; no second owner approval is needed.`;

      await admin.from("client_domains").update({
        automation_state: providerConnected ? "dns_pending" : "action_required",
        dns_status: "pending",
        ssl_status: "waiting_for_dns",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        automation_error: String(sslBody?.message || "Netlify is waiting for DNS."),
        action_required_message: actionMessage,
      }).eq("id", domainId).eq("client_id", job.client_id);

      const completed = await admin.rpc("complete_external_automation_job", {
        target_job_id: job.id,
        worker_name: workerName,
        target_result: {
          domain_id: domainId,
          domain_name: domain,
          domain_connected: false,
          action_required: !providerConnected,
          dns_pending: true,
          recheck_minutes: 15,
        },
      });
      if (completed.error) throw new Error(completed.error.message);

      return response({ ok: true, domain_id: domainId, domain_name: domain, connected: false, action_required: !providerConnected, recheck_minutes: 15 });
    }

    throw new Error(`Netlify SSL provisioning failed (${sslRes.status}): ${String(sslBody?.message || "Unknown SSL error")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown domain reconciliation failure.";
    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist domain reconciliation failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});