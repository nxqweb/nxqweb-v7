// create-client-checkout-link: the OWNER asks for a hosted Stripe checkout link for one client (billing model A1). Sign-in required, owner only.
// Switched OFF by default: it answers 503 unless NXQ_BILLING_ENABLED and NXQ_STRIPE_CHECKOUT_ENABLED are both "true". Test keys only until the owner turns live mode on.
// Draft, NOT in supabase/functions yet: see README.md in this folder ("Adopting"), every step is gated.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createClientCheckoutLink, type Deps } from "./core.ts";

const headers = { "Content-Type": "application/json" };
const STRIPE_TIMEOUT_MS = 20_000;
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const on = (name: string) => Deno.env.get(name)?.trim().toLowerCase() === "true";
function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return respond({ ok: false, error: "Method not allowed." }, 405);
  if (!on("NXQ_BILLING_ENABLED") || !on("NXQ_STRIPE_CHECKOUT_ENABLED")) return respond({ ok: false, error: "Checkout links are switched off." }, 503);
  try {
    const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const user = await admin.auth.getUser(token);
    if (user.error || !user.data.user) return respond({ ok: false, error: "Authentication required." }, 401);
    const owner = await admin.from("owner_users").select("id").eq("auth_user_id", user.data.user.id).maybeSingle();
    if (owner.error || !owner.data) return respond({ ok: false, error: "Owner access required." }, 403);
    const body = await req.json().catch(() => ({})) as { client_id?: unknown };
    const clientId = typeof body.client_id === "string" ? body.client_id : "";

    const returnBaseUrl = secret("NXQ_CHECKOUT_RETURN_BASE_URL");
    const deps: Deps = {
      async reserve({ clientId: target, requestedBy }) {
        const result = await admin.rpc("nxq_checkout_reserve", { target_client_id: target, requested_by: requestedBy });
        if (result.error) throw new Error("reserve failed");
        const data = result.data as { ok?: boolean; reason?: string; attempt_id?: string; client_id?: string; business_name?: string; contact_email?: string | null; plan_name?: string; amount_cents?: number; existing_customer_id?: string | null } | null;
        if (!data?.ok) return { ok: false as const, reason: String(data?.reason || "reserve_refused").slice(0, 60) };
        return { ok: true as const, reserved: { attemptId: String(data.attempt_id), clientId: String(data.client_id), businessName: String(data.business_name || ""), contactEmail: data.contact_email ?? null, planName: String(data.plan_name || ""), amountCents: Number(data.amount_cents), existingCustomerId: data.existing_customer_id ?? null } };
      },
      async recordCustomer({ attemptId, customerId }) {
        const result = await admin.rpc("nxq_checkout_record_customer", { target_attempt_id: attemptId, target_customer_id: customerId });
        return !result.error && (result.data as { ok?: boolean } | null)?.ok === true;
      },
      async markCreated({ attemptId, sessionId, expiresAtSeconds }) {
        const result = await admin.rpc("nxq_checkout_mark_created", { target_attempt_id: attemptId, target_session_id: sessionId, target_expires_at: expiresAtSeconds === null ? null : new Date(expiresAtSeconds * 1000).toISOString() });
        return !result.error && (result.data as { ok?: boolean } | null)?.ok === true;
      },
      async markFailed({ attemptId, reason }) { await admin.rpc("nxq_checkout_mark_failed", { target_attempt_id: attemptId, target_reason: reason }); },
      async send(request) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
        try {
          const result = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
          return { status: result.status, text: (await result.text()).slice(0, 20_000) };
        } finally { clearTimeout(timer); }
      },
      nowSeconds: () => Math.floor(Date.now() / 1000),
    };

    const result = await createClientCheckoutLink({ clientId, requestedBy: user.data.user.id }, deps, {
      secretKey: secret("STRIPE_SECRET_KEY"),
      liveAllowed: on("NXQ_STRIPE_LIVE_MODE_ENABLED"),
      returnBaseUrl,
      allowedReturnHosts: [new URL(returnBaseUrl).hostname],
    });
    if (!result.ok) return respond({ ok: false, reason: result.reason, retry_safe: result.retrySafe }, result.retrySafe ? 502 : 409);
    return respond({ ok: true, url: result.url, session_id: result.sessionId, attempt_id: result.attemptId, amount_cents: result.amountCents, plan_name: result.planName, mode: result.mode });
  } catch {
    // A generic answer only: no error text from Stripe or the database ever reaches the caller.
    return respond({ ok: false, error: "Checkout link could not be created." }, 500);
  }
});
