// Stripe request builders and response readers for "NXQX creates a hosted checkout link" (billing model A1). Pure: no network, no environment, no logging.
// Everything that touches money or a redirect is checked here, so the same rules hold in the real function and in the offline test against a pretend Stripe.
//
// Safety rules:
//  1. A TEST key is the default. A live key is refused unless the caller says live mode is allowed (NXQ_STRIPE_LIVE_MODE_ENABLED), and the mode of every answer
//     from Stripe must match the mode of the key.
//  2. The amount is whole US cents between the $10 protected minimum and a sane ceiling. It always comes from the database, never from the caller.
//  3. The customer comes back to NXQX only on addresses we allow (https, exact host), never on an address the caller typed.
//  4. The page we hand to the client must be a Stripe-hosted checkout page (https, host checkout.stripe.com). Anything else is thrown away.
//  5. The secret key only ever goes into the Authorization header. It never appears in a body, URL, result or error text.

export type KeyMode = "test" | "live";
export type StripeRequest = { url: string; method: "POST"; headers: Record<string, string>; body: string };

export const MIN_AMOUNT_CENTS = 1000; // matches the $10 protected minimum used for referral credits
export const MAX_AMOUNT_CENTS = 1_000_000; // $10,000 a month is far above any plan; a bigger number is a mistake
export const CHECKOUT_HOST = "checkout.stripe.com";

const keyPattern = /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,200}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const customerPattern = /^cus_[A-Za-z0-9_]{4,120}$/;
const sessionPattern = /^cs_(test|live)_[A-Za-z0-9_]{4,255}$/;

export function readKeyMode(secretKey: string, liveAllowed: boolean): { ok: true; mode: KeyMode } | { ok: false; reason: string } {
  const match = keyPattern.exec(secretKey || "");
  if (!match) return { ok: false, reason: "stripe_key_missing_or_malformed" };
  const mode = match[2] as KeyMode;
  if (mode === "live" && !liveAllowed) return { ok: false, reason: "live_mode_not_allowed" };
  return { ok: true, mode };
}

// Plain text that goes into Stripe (names). Control characters and form-breaking characters are removed; length is capped.
export function cleanText(value: unknown, max: number): string {
  const printable = [...String(value ?? "")].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max);
}

export function returnUrl(base: string, allowedHosts: string[], path: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try { parsed = new URL(base); } catch { return { ok: false, reason: "return_base_invalid" }; }
  if (parsed.protocol !== "https:") return { ok: false, reason: "return_base_not_https" };
  if (parsed.username || parsed.password) return { ok: false, reason: "return_base_invalid" };
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(parsed.hostname.toLowerCase())) return { ok: false, reason: "return_host_not_allowed" };
  if (!/^\/[A-Za-z0-9/_\-.?=&]*$/.test(path) || path.startsWith("//")) return { ok: false, reason: "return_path_invalid" };
  return { ok: true, url: `${parsed.origin}${path}` };
}

function post(secretKey: string, path: string, params: URLSearchParams, idempotencyKey: string): StripeRequest {
  return {
    url: `https://api.stripe.com/v1/${path}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: params.toString(),
  };
}

export type CustomerInput = { clientId: string; businessName: string; contactEmail?: string | null };

export function buildCustomerRequest(secretKey: string, input: CustomerInput): StripeRequest {
  if (!uuidPattern.test(input.clientId)) throw new Error("Client id is invalid.");
  const name = cleanText(input.businessName, 120);
  if (!name) throw new Error("Business name is required.");
  const params = new URLSearchParams({ name, "metadata[nxq_client_id]": input.clientId });
  const email = cleanText(input.contactEmail, 200);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) params.set("email", email);
  // One customer per client: the same client always gives the same key, so a retry can never create a second customer.
  return post(secretKey, "customers", params, `nxq-customer-${input.clientId}`);
}

export type SessionInput = {
  attemptId: string;
  clientId: string;
  customerId: string;
  planName: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  expiresAtSeconds?: number;
};

export function buildCheckoutSessionRequest(secretKey: string, input: SessionInput): StripeRequest {
  if (!uuidPattern.test(input.attemptId) || !uuidPattern.test(input.clientId)) throw new Error("Attempt or client id is invalid.");
  if (!customerPattern.test(input.customerId)) throw new Error("Stripe customer id is invalid.");
  if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_AMOUNT_CENTS || input.amountCents > MAX_AMOUNT_CENTS) throw new Error("Plan amount is outside the allowed range.");
  for (const url of [input.successUrl, input.cancelUrl]) if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 500) throw new Error("Return address is invalid.");
  const plan = cleanText(input.planName, 80) || "Website plan";
  const params = new URLSearchParams({
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.clientId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": `NXQX ${plan}`,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[nxq_client_id]": input.clientId,
    "metadata[nxq_attempt_id]": input.attemptId,
    "subscription_data[metadata][nxq_client_id]": input.clientId,
    allow_promotion_codes: "false",
  });
  if (input.expiresAtSeconds !== undefined) {
    if (!Number.isInteger(input.expiresAtSeconds)) throw new Error("Expiry is invalid.");
    params.set("expires_at", String(input.expiresAtSeconds));
  }
  // The attempt id is the idempotency key: the same attempt can only ever produce the same session, even if we retry after a network failure.
  return post(secretKey, "checkout/sessions", params, `nxq-checkout-${input.attemptId}`);
}

export type ReadFail = { ok: false; kind: "refused" | "unknown"; reason: string };

// Stripe answers 4xx (except 408, 409, 429) when it definitely did NOT do the thing. Anything else (5xx, timeouts, odd bodies) is "unknown": retry the same key.
function failure(status: number, text: string): ReadFail {
  const definite = status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
  let code = "";
  // Only Stripe's own short lowercase codes (like "card_declined") are copied. Anything else, including text that echoes a secret, is dropped.
  try { const body = JSON.parse(text) as { error?: { code?: unknown; type?: unknown } }; const raw = cleanText(body?.error?.code || body?.error?.type, 60); code = /^[a-z]+(_[a-z]+){0,5}$/.test(raw) ? raw : ""; } catch { /* not JSON */ }
  return { ok: false, kind: definite ? "refused" : "unknown", reason: `stripe_status_${status}${code ? `_${code}` : ""}` };
}

function parse(text: string): Record<string, unknown> | null {
  try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}

export function readCustomerResponse(status: number, text: string, mode: KeyMode): { ok: true; customerId: string } | ReadFail {
  if (status < 200 || status >= 300) return failure(status, text);
  const body = parse(text);
  if (!body || typeof body.id !== "string" || !customerPattern.test(body.id)) return { ok: false, kind: "unknown", reason: "customer_answer_unusable" };
  if (body.livemode !== (mode === "live")) return { ok: false, kind: "unknown", reason: "customer_mode_mismatch" };
  return { ok: true, customerId: body.id };
}

export function readSessionResponse(status: number, text: string, expected: { mode: KeyMode; customerId: string; clientId: string }): { ok: true; sessionId: string; url: string; expiresAtSeconds: number | null } | ReadFail {
  if (status < 200 || status >= 300) return failure(status, text);
  const body = parse(text);
  const unusable = (reason: string): ReadFail => ({ ok: false, kind: "unknown", reason });
  if (!body || typeof body.id !== "string" || !sessionPattern.test(body.id)) return unusable("session_answer_unusable");
  if (body.id.startsWith(`cs_${expected.mode}_`) === false) return unusable("session_mode_mismatch");
  if (body.livemode !== (expected.mode === "live")) return unusable("session_mode_mismatch");
  if (body.mode !== "subscription" || body.customer !== expected.customerId || body.client_reference_id !== expected.clientId) return unusable("session_does_not_match_request");
  let page: URL;
  try { page = new URL(String(body.url ?? "")); } catch { return unusable("session_url_missing"); }
  if (page.protocol !== "https:" || page.hostname !== CHECKOUT_HOST || page.username || page.password) return unusable("session_url_not_stripe_checkout");
  return { ok: true, sessionId: body.id, url: page.toString(), expiresAtSeconds: Number.isInteger(body.expires_at) ? Number(body.expires_at) : null };
}
