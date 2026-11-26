// Reads a Stripe `checkout.session.completed` event object and says whether it is a finished NXQX subscription checkout. Pure. On adoption this file is copied to
// supabase/functions/_shared/ and imported by ingest-stripe-webhook (see README, "Adopting").
// It only RECORDS that the client finished checkout. Money events (invoice.paid, subscription.*) still go through the existing, tested webhook paths.
export type CheckoutCompleted = { sessionId: string; customerId: string; subscriptionId: string; clientId: string; attemptId: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCheckoutCompleted(object: Record<string, unknown>): { ok: true; value: CheckoutCompleted } | { ok: false; reason: string } {
  const sessionId = typeof object.id === "string" ? object.id : "";
  const customerId = typeof object.customer === "string" ? object.customer : "";
  const subscriptionId = typeof object.subscription === "string" ? object.subscription : "";
  const clientId = typeof object.client_reference_id === "string" ? object.client_reference_id : "";
  if (!/^cs_(test|live)_[A-Za-z0-9_]{4,255}$/.test(sessionId)) return { ok: false, reason: "session_id_invalid" };
  if (object.mode !== "subscription") return { ok: false, reason: "not_a_subscription_checkout" };
  // Only a checkout that actually finished: "paid", or "no_payment_required" (a trial or a 100% coupon). "unpaid" (delayed payment methods) waits for its later event.
  if (object.payment_status !== "paid" && object.payment_status !== "no_payment_required") return { ok: false, reason: "payment_not_complete" };
  if (!/^cus_[A-Za-z0-9_]{4,120}$/.test(customerId)) return { ok: false, reason: "customer_id_invalid" };
  if (!/^sub_[A-Za-z0-9_]{4,120}$/.test(subscriptionId)) return { ok: false, reason: "subscription_id_invalid" };
  if (!uuid.test(clientId)) return { ok: false, reason: "client_reference_invalid" };
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  // A checkout we did not create (no NXQX marker) is ignored: someone else's Stripe product on the same account must not touch an NXQX client.
  if (String(metadata.nxq_client_id ?? "") !== clientId) return { ok: false, reason: "not_an_nxqx_checkout" };
  const attempt = String(metadata.nxq_attempt_id ?? "");
  return { ok: true, value: { sessionId, customerId, subscriptionId, clientId, attemptId: uuid.test(attempt) ? attempt : null } };
}
