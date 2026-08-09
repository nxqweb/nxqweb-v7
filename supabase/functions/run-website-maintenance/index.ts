import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

type JsonRecord = Record<string, unknown>;
type MaintenanceTask = {
  id: string;
  maintenance_plan_id: string;
  client_id: string;
  project_id: string;
  task_type: string;
  input?: JsonRecord | null;
};

const workerName = "run-website-maintenance";
const headers = { "Content-Type": "application/json" };

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTask(value: unknown): MaintenanceTask | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("Maintenance claim returned an invalid task shape.");
  const task = normalized as MaintenanceTask;
  if (!task.id || !task.client_id || !task.project_id || !task.task_type) {
    throw new Error("Maintenance claim is missing required task identifiers.");
  }
  return task;
}

async function timedFetch(input: string, init: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(input, { ...init, redirect: "follow", signal: controller.signal });
    return { res, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Maintenance HTTP request timed out after ${Math.round(timeoutMs / 1000)} seconds.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requireHttpsUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Maintenance URL is invalid."); }
  if (url.protocol !== "https:") throw new Error("Maintenance requires an HTTPS monitored URL.");
  return url;
}

function firstMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function extractSameOriginLinks(html: string, base: URL) {
  const links = new Set<string>();
  const regex = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && links.size < 20) {
    try {
      const url = new URL(match[1], base);
      if (url.origin === base.origin && ["http:", "https:"].includes(url.protocol)) {
        url.hash = "";
        links.add(url.toString());
      }
    } catch {
      // malformed links are reported by the deterministic quality scan elsewhere
    }
  }
  return [...links];
}

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
  const tokenRes = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
  });
  const body = await tokenRes.json();
  if (!tokenRes.ok || !body?.token) throw new Error(`GitHub maintenance verification token failed (${tokenRes.status}).`);
  return body.token as string;
}

async function uptimeCheck(urlText: string) {
  const url = requireHttpsUrl(urlText);
  const { res, durationMs } = await timedFetch(url.toString(), { method: "GET" });
  return {
    healthy: res.status >= 200 && res.status < 400,
    status_code: res.status,
    response_ms: durationMs,
    final_url: res.url,
    checked_at: new Date().toISOString(),
  };
}

async function sslCheck(urlText: string) {
  const url = requireHttpsUrl(urlText);
  const { res, durationMs } = await timedFetch(url.toString(), { method: "HEAD" });
  return {
    healthy: res.status >= 200 && res.status < 500 && new URL(res.url).protocol === "https:",
    https_reachable: true,
    status_code: res.status,
    response_ms: durationMs,
    final_url: res.url,
    certificate_expiry_checked: false,
    limitation: "TLS reachability is verified here; certificate-expiry metadata requires a connected certificate/provider API.",
    checked_at: new Date().toISOString(),
  };
}

async function formCheck(urlText: string) {
  const url = requireHttpsUrl(urlText);
  const { res } = await timedFetch(url.toString());
  const html = await res.text();
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map((match) => match[0]);
  const malformed: string[] = [];
  for (const form of forms) {
    const action = firstMatch(form, /action\s*=\s*["']([^"']*)["']/i);
    if (action) {
      try { new URL(action, url); } catch { malformed.push(action); }
    }
  }
  return {
    healthy: res.ok && malformed.length === 0,
    forms_found: forms.length,
    malformed_form_actions: malformed,
    real_form_submission_performed: false,
    checked_at: new Date().toISOString(),
  };
}

async function brokenLinkCheck(urlText: string) {
  const base = requireHttpsUrl(urlText);
  const { res } = await timedFetch(base.toString());
  const html = await res.text();
  const links = extractSameOriginLinks(html, base);
  const broken: Array<{ url: string; status: number | null }> = [];
  for (const link of links) {
    try {
      let checked = await timedFetch(link, { method: "HEAD" }, 8000);
      if (checked.res.status === 405) checked = await timedFetch(link, { method: "GET" }, 8000);
      if (checked.res.status >= 400) broken.push({ url: link, status: checked.res.status });
    } catch {
      broken.push({ url: link, status: null });
    }
  }
  return {
    healthy: res.ok && broken.length === 0,
    links_checked: links.length,
    broken_links: broken,
    scan_limit: 20,
    checked_at: new Date().toISOString(),
  };
}

async function securityBaselineCheck(urlText: string) {
  const url = requireHttpsUrl(urlText);
  const { res } = await timedFetch(url.toString());
  const securityHeaders = {
    strict_transport_security: Boolean(res.headers.get("strict-transport-security")),
    content_security_policy: Boolean(res.headers.get("content-security-policy")),
    x_content_type_options: Boolean(res.headers.get("x-content-type-options")),
    referrer_policy: Boolean(res.headers.get("referrer-policy")),
    permissions_policy: Boolean(res.headers.get("permissions-policy")),
  };
  const passed = Object.values(securityHeaders).filter(Boolean).length;
  return {
    healthy: res.ok && new URL(res.url).protocol === "https:" && passed >= 3,
    https: new URL(res.url).protocol === "https:",
    security_headers: securityHeaders,
    header_score: `${passed}/5`,
    destructive_scan_performed: false,
    limitation: "This is a non-destructive transport/header baseline, not a penetration test.",
    checked_at: new Date().toISOString(),
  };
}

async function seoCheck(urlText: string) {
  const url = requireHttpsUrl(urlText);
  const { res } = await timedFetch(url.toString());
  const html = await res.text();
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "");
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["'][^>]*>/i)
    || firstMatch(html, /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["'][^>]*>/i);
  const robots = firstMatch(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["'][^>]*>/i).toLowerCase();
  const noindex = robots.includes("noindex");
  return {
    healthy: res.ok && Boolean(title && description && h1) && !noindex,
    title_present: Boolean(title),
    title_length: title.length,
    description_present: Boolean(description),
    description_length: description.length,
    h1_present: Boolean(h1),
    canonical_present: Boolean(canonical),
    noindex_detected: noindex,
    checked_at: new Date().toISOString(),
  };
}

async function backupCheck(admin: ReturnType<typeof createClient>, projectId: string) {
  const config = await admin.from("project_deployment_configs")
    .select("github_owner,github_repo,production_branch,last_production_commit,last_deployment_status")
    .eq("project_id", projectId).maybeSingle();
  if (config.error || !config.data?.github_owner || !config.data?.github_repo) {
    throw new Error("Deployment configuration is missing GitHub backup metadata.");
  }
  const branch = clean(config.data.production_branch) || "main";
  const token = await githubInstallationToken();
  const repoRes = await fetch(`https://api.github.com/repos/${config.data.github_owner}/${config.data.github_repo}/branches/${encodeURIComponent(branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const body = await repoRes.json();
  if (!repoRes.ok || !body?.commit?.sha) throw new Error(`GitHub production branch verification failed (${repoRes.status}).`);
  const expected = clean(config.data.last_production_commit);
  const actual = clean(body.commit.sha);
  return {
    healthy: Boolean(actual) && (!expected || expected === actual),
    repository_verified: true,
    production_branch: branch,
    expected_commit: expected || null,
    actual_commit: actual,
    exact_commit_match: expected ? expected === actual : null,
    checked_at: new Date().toISOString(),
  };
}

async function monthlyReport(admin: ReturnType<typeof createClient>, task: MaintenanceTask) {
  const reportMonth = clean(task.input?.report_month) || new Date().toISOString().slice(0, 7) + "-01";
  const monthStart = new Date(reportMonth + "T00:00:00.000Z");
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const tasks = await admin.from("website_maintenance_tasks")
    .select("task_type,status,result,last_error,completed_at")
    .eq("project_id", task.project_id)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString());
  if (tasks.error) throw new Error(tasks.error.message);
  const rows = tasks.data || [];
  const completed = rows.filter((row) => row.status === "completed");
  const failed = rows.filter((row) => ["failed", "blocked"].includes(String(row.status)));
  const healthSummary = {
    total_checks: rows.length,
    completed_checks: completed.length,
    unresolved_checks: failed.length,
    uptime_checks: rows.filter((row) => row.task_type === "uptime_check").length,
    generated_from_real_checks: true,
  };
  const recommendations = failed.length
    ? ["Review unresolved maintenance exceptions in the NXQ owner portal."]
    : ["No unresolved maintenance exceptions were recorded for this reporting period."];
  const save = await admin.from("website_monthly_reports").update({
    status: "ready",
    health_summary: healthSummary,
    recommendations,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("project_id", task.project_id).eq("report_month", reportMonth);
  if (save.error) throw new Error(save.error.message);
  return { healthy: failed.length === 0, report_month: reportMonth, ...healthSummary, recommendations };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "POST required." }, 405);

  const serviceRole = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const internalToken = Deno.env.get("NXQ_AUTOMATION_WORKER_TOKEN")?.trim() || "";
  const suppliedToken = request.headers.get("x-nxq-worker-token")?.trim() || "";
  if (!internalToken || suppliedToken !== internalToken) return response({ error: "Trusted automation access required." }, 403);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const claim = await admin.rpc("claim_next_website_maintenance_task", { worker_name: workerName });
  if (claim.error) return response({ error: claim.error.message }, 500);

  let task: MaintenanceTask | null;
  try { task = normalizeTask(claim.data); }
  catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid maintenance claim." }, 500); }
  if (!task) return response({ ok: true, message: "No maintenance tasks are ready." });

  try {
    const plan = await admin.from("website_maintenance_plans")
      .select("monitored_url,status")
      .eq("id", task.maintenance_plan_id)
      .eq("project_id", task.project_id)
      .maybeSingle();
    if (plan.error || !plan.data) throw new Error(plan.error?.message || "Maintenance plan not found.");
    if (plan.data.status !== "active") throw new Error(`Maintenance plan status ${plan.data.status} is not active.`);

    const url = clean(task.input?.url) || clean(plan.data.monitored_url);
    let result: JsonRecord;
    switch (task.task_type) {
      case "uptime_check": result = await uptimeCheck(url); break;
      case "ssl_check": result = await sslCheck(url); break;
      case "form_test": result = await formCheck(url); break;
      case "broken_link_scan": result = await brokenLinkCheck(url); break;
      case "security_scan": result = await securityBaselineCheck(url); break;
      case "seo_check": result = await seoCheck(url); break;
      case "backup_check": result = await backupCheck(admin, task.project_id); break;
      case "monthly_report": result = await monthlyReport(admin, task); break;
      default: throw new Error(`Maintenance task type ${task.task_type} is not supported by the internal worker.`);
    }

    const healthy = result.healthy !== false;
    if (!healthy && ["uptime_check", "ssl_check", "backup_check"].includes(task.task_type)) {
      throw new Error(`${task.task_type} returned an unhealthy result.`);
    }

    const completed = await admin.rpc("complete_website_maintenance_task", {
      target_task_id: task.id,
      worker_name: workerName,
      target_result: result,
    });
    if (completed.error) throw new Error(completed.error.message);

    return response({ ok: true, task_id: task.id, task_type: task.task_type, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown maintenance failure.";
    const failed = await admin.rpc("fail_website_maintenance_task", {
      target_task_id: task.id,
      worker_name: workerName,
      target_error: message,
      target_details: { worker: workerName, failed_at: new Date().toISOString() },
    });
    if (failed.error) console.error("Could not persist maintenance failure", failed.error.message);
    return response({ error: message, task_id: task.id, task_type: task.task_type }, 500);
  }
});
