// DRAFT: public "answer a visitor's question" function for the website Q&A assistant (no AI). NOT in supabase/functions, NOT deployed.
// When promoted it moves to supabase/functions/answer-site-question/index.ts (needs: migration 11 applied, an entry in the function manifest and
// supabase/config.toml next to ingest-business-lead, and the import below changed to "../_shared/assistant-match.mjs").
//
// Same front door as the contact form (ingest-business-lead): the site sends its lead-form key; the form must be active; the request must come from one of
// the form's allowed origins; hourly limits per form and per visitor fingerprint; a bot trap field; and the client must still be allowed to use lead capture
// under its plan and billing state. Visitors only ever get text the business wrote. Questions nobody could answer are kept (counts only, never personal
// details: see site_assistant_record_unanswered) so the business can add an answer.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ASSISTANT_LIMITS, matchQuestion } from "../../../../supabase/functions/_shared/assistant-match.mjs";

type Payload = { form_key?: string; action?: string; question?: string; company_website?: string };
type FormRow = { id: string; client_id: string; status: string; allowed_origins: string[] | null };
type Quota = { allowed?: boolean };
type LookupResult = { client_id: string; greeting: string; fallback_text: string; entries: Array<{ id: string; question: string; alt_phrasings: string[]; answer: string }> };

const MAX_REQUEST_BYTES = 4096;
const HOURLY_PER_FORM = 300;
const HOURLY_PER_VISITOR = 20;

function requestOrigin(req: Request) {
  const origin = (req.headers.get("origin") || "").trim();
  return /^https:\/\/[^\s/$.?#].*$/i.test(origin) ? origin : "";
}
function cors(origin: string) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin || "https://invalid.nxq.local",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}
function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}
function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = requestOrigin(req);
  if (req.method === "OPTIONS") return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
  if (req.method !== "POST") return respond({ ok: false, error: "Method not allowed." }, 405, origin);
  if (!origin) return respond({ ok: false, error: "A valid HTTPS origin is required." }, 403, origin);

  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return respond({ ok: false, error: "Request body is too large." }, 413, origin);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return respond({ ok: false, error: "Request body is too large." }, 413, origin);
  let payload: Payload;
  try { payload = JSON.parse(raw) as Payload; } catch { return respond({ ok: false, error: "Request body must be valid JSON." }, 400, origin); }

  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  try {
    const formKey = clean(payload.form_key, 90);
    if (!formKey) return respond({ ok: false, error: "Form key is required." }, 400, origin);
    const formResult = await admin.from("business_lead_forms").select("id,client_id,status,allowed_origins").eq("form_key", formKey).single();
    const form = formResult.data as FormRow | null;
    // The same answer for "no such form", "paused" and "assistant off": a visitor learns nothing about which it is.
    if (formResult.error || !form || form.status !== "active") return respond({ ok: false, error: "The assistant is unavailable." }, 404, origin);
    if (!(form.allowed_origins || []).includes(origin)) return respond({ ok: false, error: "Origin is not allowed." }, 403, origin);

    const lookedUp = await admin.rpc("site_assistant_lookup", { target_form_key: formKey });
    const site = lookedUp.data as LookupResult | null;
    if (lookedUp.error || !site) return respond({ ok: false, error: "The assistant is unavailable." }, 404, origin);

    const action = clean(payload.action, 20) || "ask";
    if (action === "config") return respond({ ok: true, greeting: site.greeting, fallback_text: site.fallback_text }, 200, origin);
    if (action !== "ask") return respond({ ok: false, error: "Unknown request." }, 400, origin);

    // Bot trap: look like success, do nothing.
    if (clean(payload.company_website, 500)) return respond({ ok: true, matched: false, message: site.fallback_text }, 200, origin);

    const forwarded = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const agent = req.headers.get("user-agent") || "unknown";
    const fingerprint = await sha256(`${secret("NXQ_LEAD_FINGERPRINT_SALT")}|${forwarded}|${agent}`);
    const scope = `assistant:${form.id}`;
    const total = await admin.rpc("nxq_reserve_ingress_capacity", {
      target_scope_key: scope, target_operation_key: "assistant_total_hourly", target_identity_hash: await sha256(scope),
      target_units: 1, target_limit_units: HOURLY_PER_FORM, target_window_seconds: 3600,
    });
    if (total.error) throw new Error(`Assistant quota failed: ${total.error.message}`);
    const visitor = (total.data as Quota | null)?.allowed
      ? await admin.rpc("nxq_reserve_ingress_capacity", {
        target_scope_key: scope, target_operation_key: "assistant_visitor_hourly", target_identity_hash: fingerprint,
        target_units: 1, target_limit_units: HOURLY_PER_VISITOR, target_window_seconds: 3600,
      })
      : total;
    if (visitor.error) throw new Error(`Assistant quota failed: ${visitor.error.message}`);
    if (!(visitor.data as Quota | null)?.allowed) return respond({ ok: false, error: "Too many questions for now. Please try again later." }, 429, origin);

    // The business must still be allowed to use its site features under its plan and billing state (same rule as the contact form).
    const authorization = await admin.rpc("nxq_authorize_paid_capability", {
      target_client_id: form.client_id, target_feature_key: "lead_capture", target_resources: { api_requests: 1 },
      target_estimated_provider_cost_cents: 0, target_idempotency_key: `assistant:${form.id}:${crypto.randomUUID()}`,
    });
    if (authorization.error || authorization.data?.allowed !== true) return respond({ ok: false, error: "The assistant is unavailable." }, 409, origin);

    const question = clean(payload.question, ASSISTANT_LIMITS.visitorQuestion + 1);
    if (!question) return respond({ ok: false, error: "Please type a question." }, 400, origin);
    if (question.length > ASSISTANT_LIMITS.visitorQuestion) return respond({ ok: false, error: `Please keep your question under ${ASSISTANT_LIMITS.visitorQuestion} characters.` }, 400, origin);

    const result = matchQuestion(question, site.entries);
    if (result.matched) return respond({ ok: true, matched: true, answer: result.answer }, 200, origin);

    // Nothing matched clearly: remember the question (the database refuses anything that looks like personal details) and offer the contact form.
    await admin.rpc("site_assistant_record_unanswered", { target_form_key: formKey, visitor_question: question });
    return respond({ ok: true, matched: false, message: site.fallback_text }, 200, origin);
  } catch {
    return respond({ ok: false, error: "The assistant is unavailable right now." }, 500, origin);
  }
});
