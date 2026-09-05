import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePublicHttpsUrl, validatedRedirectTarget } from "../_shared/outbound-security.ts";

const jsonHeaders = { "Content-Type": "application/json" };
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function secret(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing protected secret: ${name}`); return value; }
function has(html: string, pattern: RegExp) { return pattern.test(html); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  try {
    const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const user = await admin.auth.getUser(token);
    if (user.error || !user.data.user) return response({ ok: false, error: "Authentication required." }, 401);
    const owner = await admin.from("owner_users").select("id").eq("auth_user_id", user.data.user.id).maybeSingle();
    if (owner.error || !owner.data) return response({ ok: false, error: "Owner access required." }, 403);
    const body = await req.json() as { prospect_id?: string };
    if (!body.prospect_id) throw new Error("prospect_id is required.");
    const prospect = await admin.from("nxq_sales_prospects").select("id,website_url,source_provider").eq("id", body.prospect_id).single();
    if (prospect.error || !prospect.data) throw new Error("Prospect not found.");
    if (prospect.data.source_provider === "zero_key_fictional") return response({ ok: false, blocked: true, error: "Fictional prospects are never fetched." }, 409);
    if (!prospect.data.website_url) {
      await admin.from("nxq_sales_prospects").update({ website_audit_status: "completed", website_quality_score: 0, website_audit_summary: { no_website: true } }).eq("id", prospect.data.id);
      return response({ ok: true, score: 0, findings: ["No public website URL was recorded."], factual_only: true });
    }
    const costReservationKey = `sales-website-audit:${prospect.data.id}:${crypto.randomUUID()}`;
    const costReservation = await admin.rpc("nxq_reserve_platform_usage", {
      target_operation_key: "sales_website_audit",
      target_estimated_cost_cents: 1,
      target_idempotency_key: costReservationKey,
      target_metadata: { prospect_id: prospect.data.id },
    });
    if (costReservation.error || costReservation.data?.allowed !== true) {
      return response({ ok: false, blocked: true, error: "Website auditing is blocked by the protected platform cost budget." }, 409);
    }
    let current = requirePublicHttpsUrl(prospect.data.website_url, "Prospect website URL");
    const audit = await admin.from("nxq_sales_website_audits").insert({ prospect_id: prospect.data.id, status: "running", requested_url: current.toString() }).select("id").single();
    if (audit.error) {
      await admin.rpc("nxq_finalize_platform_usage", { target_idempotency_key: costReservationKey, target_release: true });
      throw new Error(audit.error.message);
    }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      let page: Response | null = null;
      for (let redirects = 0; redirects <= 3; redirects++) {
        page = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "NXQWebsiteQualityAudit/1.0", Accept: "text/html" } });
        if (page.status < 300 || page.status >= 400) break;
        const location = page.headers.get("location"); if (!location) break; current = validatedRedirectTarget(location, current, "Website redirect");
      }
      if (!page || !page.ok) throw new Error(`Website returned HTTP ${page?.status || 0}.`);
      const length = Number(page.headers.get("content-length") || 0); if (length > 1_500_000) throw new Error("Website response exceeded the audit size limit.");
      const html = (await page.text()).slice(0, 1_500_000);
      const checks = {
        https: current.protocol === "https:",
        mobile_viewport: has(html, /<meta[^>]+name=["']viewport["']/i),
        title: has(html, /<title>[^<]{3,}/i),
        meta_description: has(html, /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i) || has(html, /<meta[^>]+content=["'][^"']{20,}["'][^>]+name=["']description["']/i),
        contact_action: has(html, /href=["'](?:tel:|mailto:)|contact|request (?:a )?quote|get (?:a )?quote/i),
        form: has(html, /<form\b/i),
        heading: has(html, /<h1\b/i),
        image_alt: !has(html, /<img(?![^>]+\balt=)[^>]*>/i),
        local_signals: has(html, /service area|serving|located in|near you|directions/i),
      };
      const values = Object.values(checks); const score = Math.round(values.filter(Boolean).length / values.length * 100);
      const findings = Object.entries(checks).filter(([, value]) => !value).map(([key]) => `${key.replaceAll("_", " ")} was not detected on the fetched page.`);
      await admin.from("nxq_sales_website_audits").update({ status: "completed", final_url: current.toString(), score, checks, factual_findings: findings, checked_at: new Date().toISOString() }).eq("id", audit.data.id);
      await admin.from("nxq_sales_prospects").update({ website_audit_status: "completed", website_quality_score: score, website_audit_summary: { checks, findings, audited_url: current.toString() } }).eq("id", prospect.data.id);
      const finalized = await admin.rpc("nxq_finalize_platform_usage", {
        target_idempotency_key: costReservationKey,
        target_actual_cost_cents: 1,
      });
      if (finalized.error) throw new Error("Website audit cost reservation could not be reconciled.");
      return response({ ok: true, audit_id: audit.data.id, score, checks, findings, factual_only: true, messages_sent: 0 });
    } finally { clearTimeout(timeout); }
  } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : "Website audit failed." }, 400); }
});
