// Orchestration for "create a hosted checkout link for a client" (billing model A1). Every outside thing (database, Stripe) is passed in, so the whole flow runs
// in the offline test against a PRETEND database and a PRETEND Stripe. No environment reads, no logging, no network here.
//
// Order of steps (and why):
//  1. Check the key and the return addresses BEFORE touching anything.
//  2. RESERVE an attempt in the database. The database decides the amount and refuses clients that must not be billed (QA-only, denied, already subscribed).
//     A repeat request reuses the open attempt, so the idempotency keys repeat and Stripe hands back the same customer and the same session.
//  3. Use the client's linked Stripe customer, or create one and LINK it (the webhook only accepts events from linked customers).
//  4. Create the Checkout Session. Stripe "definitely refused" -> mark the attempt failed. Answer unknown -> leave it open so a retry is safe.
//  5. RECORD the session. If we cannot record it we do not hand out the link (fail closed).
import {
  buildCheckoutSessionRequest, buildCustomerRequest, readSessionResponse, readCustomerResponse, readKeyMode, returnUrl,
  type KeyMode, type StripeRequest,
} from "./stripe.ts";

export type Reserved = {
  attemptId: string;
  clientId: string;
  businessName: string;
  contactEmail: string | null;
  planName: string;
  amountCents: number;
  existingCustomerId: string | null;
};
export type ReserveResult = { ok: true; reserved: Reserved } | { ok: false; reason: string };

export type Deps = {
  reserve: (input: { clientId: string; requestedBy: string }) => Promise<ReserveResult>;
  recordCustomer: (input: { attemptId: string; customerId: string }) => Promise<boolean>;
  markCreated: (input: { attemptId: string; sessionId: string; expiresAtSeconds: number | null }) => Promise<boolean>;
  markFailed: (input: { attemptId: string; reason: string }) => Promise<void>;
  // Sends one request to Stripe and resolves with the status and body text. Must not throw on a non-2xx answer; may throw on a network failure.
  send: (request: StripeRequest) => Promise<{ status: number; text: string }>;
  nowSeconds: () => number;
};

export type Config = {
  secretKey: string;
  liveAllowed: boolean;
  returnBaseUrl: string;
  allowedReturnHosts: string[];
  // How long the link stays usable. Stripe allows 30 minutes to 24 hours.
  linkLifetimeSeconds?: number;
};

export type Result =
  | { ok: true; url: string; sessionId: string; attemptId: string; amountCents: number; planName: string; mode: KeyMode }
  | { ok: false; reason: string; retrySafe: boolean };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createClientCheckoutLink(input: { clientId: string; requestedBy: string }, deps: Deps, config: Config): Promise<Result> {
  if (!uuidPattern.test(input.clientId || "")) return { ok: false, reason: "client_id_invalid", retrySafe: false };
  if (!uuidPattern.test(input.requestedBy || "")) return { ok: false, reason: "requester_invalid", retrySafe: false };

  const key = readKeyMode(config.secretKey, config.liveAllowed);
  if (!key.ok) return { ok: false, reason: key.reason, retrySafe: false };
  const success = returnUrl(config.returnBaseUrl, config.allowedReturnHosts, "/client/billing?checkout=success");
  const cancel = returnUrl(config.returnBaseUrl, config.allowedReturnHosts, "/client/billing?checkout=cancelled");
  if (!success.ok) return { ok: false, reason: success.reason, retrySafe: false };
  if (!cancel.ok) return { ok: false, reason: cancel.reason, retrySafe: false };

  let reservation: ReserveResult;
  try { reservation = await deps.reserve({ clientId: input.clientId, requestedBy: input.requestedBy }); }
  catch { return { ok: false, reason: "reserve_failed", retrySafe: true }; }
  if (!reservation.ok) return { ok: false, reason: reservation.reason, retrySafe: false };
  const held = reservation.reserved;

  const fail = async (reason: string, definite: boolean): Promise<Result> => {
    if (definite) { try { await deps.markFailed({ attemptId: held.attemptId, reason }); } catch { /* the attempt simply expires */ } }
    return { ok: false, reason, retrySafe: !definite };
  };

  // Customer: reuse the linked one, otherwise create it once and link it.
  let customerId = held.existingCustomerId;
  if (!customerId) {
    let request: StripeRequest;
    try { request = buildCustomerRequest(config.secretKey, { clientId: held.clientId, businessName: held.businessName, contactEmail: held.contactEmail }); }
    catch { return fail("customer_request_invalid", true); }
    let answer: { status: number; text: string };
    try { answer = await deps.send(request); } catch { return fail("stripe_unreachable", false); }
    const customer = readCustomerResponse(answer.status, answer.text, key.mode);
    if (!customer.ok) return fail(customer.reason, customer.kind === "refused");
    let linked: boolean;
    try { linked = await deps.recordCustomer({ attemptId: held.attemptId, customerId: customer.customerId }); } catch { linked = false; }
    // The customer exists in Stripe but is not linked. A retry reuses the same Stripe customer (same idempotency key), so nothing is duplicated.
    if (!linked) return fail("customer_link_failed", false);
    customerId = customer.customerId;
  }

  const lifetime = Math.min(Math.max(config.linkLifetimeSeconds ?? 86_400 - 600, 1_800), 86_400 - 600);
  const expiresAtSeconds = deps.nowSeconds() + lifetime;
  let request: StripeRequest;
  try {
    request = buildCheckoutSessionRequest(config.secretKey, {
      attemptId: held.attemptId, clientId: held.clientId, customerId, planName: held.planName, amountCents: held.amountCents,
      successUrl: success.url, cancelUrl: cancel.url, expiresAtSeconds,
    });
  } catch { return fail("session_request_invalid", true); }

  let answer: { status: number; text: string };
  try { answer = await deps.send(request); } catch { return fail("stripe_unreachable", false); }
  const session = readSessionResponse(answer.status, answer.text, { mode: key.mode, customerId, clientId: held.clientId });
  if (!session.ok) return fail(session.reason, session.kind === "refused");

  let recorded: boolean;
  try { recorded = await deps.markCreated({ attemptId: held.attemptId, sessionId: session.sessionId, expiresAtSeconds: session.expiresAtSeconds }); } catch { recorded = false; }
  // Not recorded means the owner could not see this link later. It was never handed out and it expires by itself, so nobody can pay through it.
  if (!recorded) return fail("session_not_recorded", false);

  return { ok: true, url: session.url, sessionId: session.sessionId, attemptId: held.attemptId, amountCents: held.amountCents, planName: held.planName, mode: key.mode };
}
