import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";

const jsonHeaders = { "Content-Type": "application/json" };
const allowedNiches = new Set(["tree_services", "roofing", "auto_services"]);
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function secret(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing protected secret: ${name}`); return value; }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  try {
    const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const user = await admin.auth.getUser(token);
    if (user.error || !user.data.user) return response({ ok: false, error: "Authentication required." }, 401);
    const owner = await admin.from("owner_users").select("id").eq("auth_user_id", user.data.user.id).maybeSingle();
    if (owner.error || !owner.data) return response({ ok: false, error: "Owner access required." }, 403);
    const userClient = createClient(secret("SUPABASE_URL"), secret("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

    const body = await req.json() as Record<string, unknown>;
    const niche = clean(body.niche_key, 60);
    const geography = clean(body.geography, 120);
    const requestedLimit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    const fictional = body.fictional === true;
    if (!allowedNiches.has(niche) || geography.length < 2) throw new Error("Use an approved niche and a real geography.");

    if (fictional) {
      const rpc = await userClient.rpc("owner_create_fictional_sales_source_run", { target_niche_key: niche, target_geography: geography, target_limit: Math.min(requestedLimit, 20) });
      if (rpc.error) throw new Error(rpc.error.message);
      return response(rpc.data);
    }

    const endpoint = Deno.env.get("NXQ_PROSPECT_DISCOVERY_PROVIDER_URL")?.trim() || "";
    const providerToken = Deno.env.get("NXQ_PROSPECT_DISCOVERY_PROVIDER_TOKEN")?.trim() || "";
    if (!endpoint || !providerToken) return response({ ok: false, configured: false, error: "Prospect discovery provider is not configured. Fictional zero-key mode remains available." }, 503);
    const safeEndpoint = requirePublicHttpsUrl(endpoint, "Prospect discovery provider URL");

    const run = await admin.from("nxq_sales_source_runs").insert({ niche_key: niche, geography, provider_key: "approved_business_data_api", mode: "provider_api", status: "running", requested_limit: requestedLimit, requested_by_auth_user_id: user.data.user.id, started_at: new Date().toISOString() }).select("id").single();
    if (run.error) throw new Error(run.error.message);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    let imported = 0;
    try {
      const provider = await fetch(safeEndpoint, { method: "POST", redirect: "error", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerToken}` }, body: JSON.stringify({ niche, geography, limit: requestedLimit, fields: ["business_name", "website_url", "city", "state_region", "public_business_email", "source_url", "source_record_id"] }) });
      if (!provider.ok) throw new Error(`Discovery provider returned HTTP ${provider.status}.`);
      const payload = await provider.json() as { businesses?: Array<Record<string, unknown>>; cost_cents?: number };
      const businesses = Array.isArray(payload.businesses) ? payload.businesses.slice(0, requestedLimit) : [];
      for (const item of businesses) {
        const businessName = clean(item.business_name, 180); const sourceUrl = clean(item.source_url, 500); const sourceRecordId = clean(item.source_record_id, 180);
        if (!businessName || !sourceUrl || !sourceRecordId) continue;
        requirePublicHttpsUrl(sourceUrl, "Business-data source URL");
        const websiteUrl = clean(item.website_url, 500);
        let normalizedDomain: string | null = null;
        if (websiteUrl) { try { normalizedDomain = new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { normalizedDomain = null; } }
        const inserted = await admin.from("nxq_sales_prospects").upsert({ business_name: businessName, niche_key: niche, website_url: websiteUrl || null, normalized_domain: normalizedDomain, city: clean(item.city, 120) || null, state_region: clean(item.state_region, 120) || null, contact_email: clean(item.public_business_email, 180).toLowerCase() || null, source_url: sourceUrl, source_provider: "approved_business_data_api", source_record_id: sourceRecordId, source_retrieved_at: new Date().toISOString(), status: "research", research_notes: "Imported from an approved business-data API. Facts require owner review before outreach." }, { onConflict: "source_provider,source_record_id", ignoreDuplicates: true });
        if (!inserted.error) imported += 1;
      }
      await admin.from("nxq_sales_source_runs").update({ status: "completed", discovered_count: businesses.length, imported_count: imported, provider_cost_cents: Math.max(Number(payload.cost_cents) || 0, 0), completed_at: new Date().toISOString() }).eq("id", run.data.id);
      return response({ ok: true, run_id: run.data.id, discovered: businesses.length, imported, mode: "provider_api", messages_sent: 0 });
    } finally { clearTimeout(timeout); }
  } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : "Prospect discovery failed." }, 400); }
});
