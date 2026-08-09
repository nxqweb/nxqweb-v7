import { createClient } from "npm:@supabase/supabase-js@2";

type Delivery = {
  id: string;
  client_id: string | null;
  project_id: string | null;
  channel: string;
  recipient_kind: string;
  recipient_reference: string | null;
  template_key: string;
  subject: string | null;
  body: string;
  priority: string;
  status: string;
  provider_key: string | null;
  attempts: number;
  max_attempts: number;
  metadata: Record<string, unknown> | null;
};

type AdapterResponse = Record<string, unknown>;
type DeliveryDecision={decision?:string;reason?:string;next_run_after?:string};
const headers = { "Content-Type": "application/json" };

function secret(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing protected secret: ${name}`); return value; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
function asAdapterResponse(value: unknown): AdapterResponse { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return value as AdapterResponse; }
function asDecision(value:unknown):DeliveryDecision{if(!value||typeof value!=="object"||Array.isArray(value))return {};return value as DeliveryDecision;}

async function postAdapter(delivery: Delivery) {
  const endpoint = Deno.env.get("NXQ_NOTIFICATION_ADAPTER_URL")?.trim();
  const token = Deno.env.get("NXQ_NOTIFICATION_ADAPTER_TOKEN")?.trim();
  if (!endpoint || !token) throw new Error("Notification provider adapter is not configured.");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ channel: delivery.channel, provider_key: delivery.provider_key, recipient_kind: delivery.recipient_kind, recipient_reference: delivery.recipient_reference, template_key: delivery.template_key, subject: delivery.subject, body: delivery.body, metadata: delivery.metadata || {} }), signal: controller.signal });
    const text = await res.text(); let body: AdapterResponse = {};
    try { body = text ? asAdapterResponse(JSON.parse(text) as unknown) : {}; } catch { body = { message: text }; }
    if (!res.ok) throw new Error(`Notification adapter failed (${res.status}): ${String(body.message || "unknown")}`);
    return { provider_message_id: String(body.provider_message_id || body.id || ""), provider_status: String(body.status || "delivered") };
  } finally { clearTimeout(timeout); }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  if (req.headers.get("x-nxq-worker-token") !== secret("NXQ_AUTOMATION_WORKER_TOKEN")) return response({ ok: false, error: "Unauthorized." }, 401);
  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  try {
    const due = await admin.from("notification_deliveries").select("*").in("status", ["queued", "failed"]).lte("run_after", new Date().toISOString()).order("priority", { ascending: false }).order("created_at", { ascending: true }).limit(25);
    if (due.error) throw new Error(`Notification queue read failed: ${due.error.message}`);
    let delivered = 0, failed = 0, blocked = 0, deferred = 0, digestPending = 0;

    for (const raw of due.data || []) {
      const delivery = raw as Delivery;
      const policy=await admin.rpc("notification_delivery_decision",{target_delivery_id:delivery.id});
      if(policy.error)throw new Error(`Notification policy failed: ${policy.error.message}`);
      const decision=asDecision(policy.data);
      if(decision.decision==="digest"){digestPending++;continue;}
      if(decision.decision==="defer"){
        const next=typeof decision.next_run_after==="string"?decision.next_run_after:new Date(Date.now()+3600000).toISOString();
        await admin.from("notification_deliveries").update({run_after:next,last_error:null,updated_at:new Date().toISOString()}).eq("id",delivery.id).in("status",["queued","failed"]);
        deferred++;continue;
      }
      if(decision.decision==="blocked"){
        await admin.from("notification_deliveries").update({status:"blocked",last_error:`Delivery blocked by notification preference: ${String(decision.reason||"policy")}`,updated_at:new Date().toISOString()}).eq("id",delivery.id).in("status",["queued","failed"]);
        blocked++;continue;
      }
      if(decision.decision!=="immediate")throw new Error(`Unsupported notification policy decision: ${String(decision.decision||"missing")}`);

      const claim = await admin.from("notification_deliveries").update({ status: "sending", attempts: Number(delivery.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq("id", delivery.id).in("status", ["queued", "failed"]).select("*").maybeSingle();
      if (claim.error || !claim.data) continue;
      const current = claim.data as Delivery;
      try {
        if (current.channel === "in_app") {
          const done = await admin.from("notification_deliveries").update({ status: "delivered", delivered_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", current.id);
          if (done.error) throw new Error(done.error.message); delivered++; continue;
        }
        const endpointReady = Boolean(Deno.env.get("NXQ_NOTIFICATION_ADAPTER_URL")?.trim() && Deno.env.get("NXQ_NOTIFICATION_ADAPTER_TOKEN")?.trim());
        if (!endpointReady) { await admin.from("notification_deliveries").update({ status: "blocked", last_error: "Notification provider adapter is not configured.", updated_at: new Date().toISOString() }).eq("id", current.id); blocked++; continue; }
        const result = await postAdapter(current);
        await admin.from("notification_deliveries").update({ status: "delivered", provider_message_id: result.provider_message_id || null, delivered_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(), metadata: { ...(current.metadata || {}), provider_status: result.provider_status } }).eq("id", current.id);
        delivered++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown notification failure"; const exhausted = current.attempts >= current.max_attempts;
        await admin.from("notification_deliveries").update({ status: exhausted ? "blocked" : "failed", last_error: message.slice(0, 2000), run_after: exhausted ? current.metadata?.run_after : new Date(Date.now() + Math.min(3600000, Math.max(120000, 2 ** Math.min(current.attempts, 5) * 60000))).toISOString(), updated_at: new Date().toISOString() }).eq("id", current.id);
        if (exhausted && current.client_id) await admin.from("automation_escalations").insert({ client_id: current.client_id, project_id: current.project_id, escalation_type: "notification_delivery_exhausted", severity: "warning", title: "Notification delivery needs attention", summary: `A ${current.channel} notification exhausted automatic retries.`, details: { notification_delivery_id: current.id, channel: current.channel, error: message } });
        failed++;
      }
    }
    return response({ ok: true, processed: (due.data || []).length, delivered, failed, blocked, deferred, digest_pending: digestPending });
  } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : "Notification dispatcher failed." }, 500); }
});
