import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";

const jsonHeaders = { "Content-Type": "application/json" };
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function secret(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing protected secret: ${name}`); return value; }
function optional(name: string) { return Deno.env.get(name)?.trim() || ""; }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function deterministic(name: string, city: string, findings: string[]) {
  const observation = findings[0] || "I could not find a clear, mobile-friendly path for customers to request service";
  return { subject: `A website idea for ${name}`, body: `Hi ${name} team,\n\nI reviewed the public information available for your business${city ? ` in ${city}` : ""}. ${observation}.\n\nNXQ Web builds and manages professional small-business websites, including the setup, updates, hosting, and lead-ready contact experience. If improving that part of your business is a priority, I can send a short plan based only on the services and facts you approve.\n\nWould you like me to send it?`, ai_used: false };
}

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
    const body = await req.json() as { prospect_id?: string; sequence_step?: number };
    if (!body.prospect_id) throw new Error("prospect_id is required.");
    const prospect = await admin.from("nxq_sales_prospects").select("id,business_name,niche_key,city,state_region,website_url,website_audit_summary,status,source_provider").eq("id", body.prospect_id).single();
    if (prospect.error || !prospect.data) throw new Error("Prospect not found.");
    if (prospect.data.status === "do_not_contact") throw new Error("This prospect is on the do-not-contact list.");
    const findings = Array.isArray(prospect.data.website_audit_summary?.findings) ? prospect.data.website_audit_summary.findings.map(String).slice(0, 5) : [];
    let draft = deterministic(prospect.data.business_name, prospect.data.city || "", findings);
    const endpoint = optional("NXQ_AI_MODEL_PROVIDER_URL"); const apiToken = optional("NXQ_AI_MODEL_PROVIDER_TOKEN"); const model = optional("NXQ_AI_MODEL_PROVIDER_MODEL");
    if (endpoint && apiToken && model && prospect.data.source_provider !== "zero_key_fictional") {
      const safeEndpoint = requirePublicHttpsUrl(endpoint, "AI provider URL");
      const prompt = { task: "draft_truthful_small_business_outreach", rules: ["Use only supplied facts.", "Do not claim guaranteed results.", "Describe NXQ as a premium done-for-you website service, not an AI product.", "Ask one low-pressure question.", "No markdown."], prospect: { business_name: prospect.data.business_name, niche: prospect.data.niche_key, city: prospect.data.city, state: prospect.data.state_region, website: prospect.data.website_url, factual_findings: findings } };
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const ai = await fetch(safeEndpoint, { method: "POST", redirect: "error", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` }, body: JSON.stringify({ model, store: false, input: JSON.stringify(prompt), text: { format: { type: "json_schema", name: "nxq_outreach_draft", strict: true, schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false } } }, max_output_tokens: 700 }) });
        if (ai.ok) {
          const payload = await ai.json() as Record<string, unknown>; const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
          const raw = output.flatMap((item) => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : []).map((item) => text(item.text, 6000)).find(Boolean);
          if (raw) { const parsed = JSON.parse(raw) as { subject?: unknown; body?: unknown }; const subject = text(parsed.subject, 180); const message = text(parsed.body, 5000); if (subject && message) draft = { subject, body: message, ai_used: true }; }
        }
      } finally { clearTimeout(timeout); }
    }
    const step = Math.min(Math.max(Number(body.sequence_step) || 1, 1), 3);
    const created = await userClient.rpc("owner_create_sales_outreach_draft", { target_prospect_id: prospect.data.id, target_channel: "email", target_sequence_step: step, target_subject: draft.subject, target_body: draft.body, target_scheduled_for: null });
    if (created.error) throw new Error(created.error.message);
    return response({ ok: true, draft: created.data, ai_used: draft.ai_used, zero_key_fallback: !draft.ai_used, status: "needs_review", messages_sent: 0 });
  } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : "Outreach drafting failed." }, 400); }
});
