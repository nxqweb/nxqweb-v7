// Referral credit on a Stripe invoice (owner chose "Option A": one negative line on each new DRAFT invoice). Pure decisions and one orchestration
// function; the real database calls and the real Stripe call are passed in (dependencies), so everything here is testable with pretend ones.
//
// Safety rules, in order of importance:
//  1. Money is only taken off draft, USD, subscription-cycle invoices of at least $10, and never below the $10 protected minimum (checked here AND in the database).
//  2. An invoice that already has an NXQX credit line is skipped, so a repeat event can never add a second one.
//  3. The credit is used up in the database FIRST (idempotent per invoice). If Stripe DEFINITELY refuses (a 4xx answer), the credit is handed back.
//     If the answer is unknown (network error, 5xx, timeout) the credit is NOT handed back, because Stripe may have added the line: the owner must check.
//  4. The Stripe secret key is only ever placed in the request header; it never appears in a result, log line or error message.
export type StripeInvoiceObject = Record<string, unknown>;

export type CreditableInvoice = { invoiceId: string; customerId: string; subtotalCents: number; subtotalDollars: number };
export type Skip = { ok: false; reason: string };

export const creditLineMarker = "nxq_referral_credit";
export const minimumInvoiceCents = 1000;
const invoiceIdPattern = /^in_[A-Za-z0-9_]{4,120}$/;
const customerIdPattern = /^cus_[A-Za-z0-9_]{4,120}$/;

export function creditableInvoice(object: StripeInvoiceObject): { ok: true; invoice: CreditableInvoice } | Skip {
  const invoiceId = typeof object.id === "string" ? object.id : "";
  const customerId = typeof object.customer === "string" ? object.customer : "";
  if (!invoiceIdPattern.test(invoiceId)) return { ok: false, reason: "invoice_id_invalid" };
  if (!customerIdPattern.test(customerId)) return { ok: false, reason: "customer_id_invalid" };
  if (object.status !== "draft") return { ok: false, reason: "invoice_not_draft" };
  if (object.billing_reason !== "subscription_cycle") return { ok: false, reason: "not_a_renewal_invoice" };
  if (String(object.currency || "").toLowerCase() !== "usd") return { ok: false, reason: "currency_not_usd" };
  const listed = object.subtotal;
  if (typeof listed !== "number" || !Number.isInteger(listed)) return { ok: false, reason: "subtotal_unusable" };
  // The protected minimum is measured on what the customer would actually owe: with a discount the total is lower than the subtotal.
  const subtotal = typeof object.total === "number" && Number.isInteger(object.total) ? Math.min(listed, object.total) : listed;
  if (subtotal < minimumInvoiceCents || subtotal > 100_000_000) return { ok: false, reason: "subtotal_unusable" };
  return { ok: true, invoice: { invoiceId, customerId, subtotalCents: subtotal, subtotalDollars: subtotal / 100 } };
}

// An invoice that already carries our credit line (we marked it in the line's metadata) must never get another one.
export function hasCreditLine(object: StripeInvoiceObject): boolean {
  const lines = (object.lines as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(lines)) return false;
  return lines.some((line) => {
    const metadata = (line as { metadata?: Record<string, unknown> } | null)?.metadata;
    return Boolean(metadata && String(metadata[creditLineMarker] ?? "") === "true");
  });
}

export type StripeRequest = { url: string; method: "POST"; headers: Record<string, string>; body: string };

export function buildInvoiceItemRequest(secretKey: string, invoice: CreditableInvoice, creditCents: number): StripeRequest {
  if (!Number.isInteger(creditCents) || creditCents <= 0) throw new Error("Credit amount is invalid.");
  if (creditCents > invoice.subtotalCents - minimumInvoiceCents) throw new Error("Credit would take the invoice below the protected minimum.");
  const body = new URLSearchParams({
    customer: invoice.customerId,
    invoice: invoice.invoiceId,
    amount: String(-creditCents),
    currency: "usd",
    description: "NXQX referral credit",
    [`metadata[${creditLineMarker}]`]: "true",
  }).toString();
  return {
    url: "https://api.stripe.com/v1/invoiceitems",
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Same invoice and same amount always gives the same key, so a repeated call cannot add a second line.
      "Idempotency-Key": `nxq-referral-credit-${invoice.invoiceId}-${creditCents}`,
    },
    body,
  };
}

export type CreditDeps = {
  // Moves referral rewards whose hold has ended into usable credit. Failure here is ignored (credit may just be a bit late).
  matureCredits: () => Promise<void>;
  // Uses up credit for exactly this invoice in the database. Returns dollars used (0 when the program is off or there is no credit).
  reserve: (input: { clientId: string; invoiceId: string; subtotalDollars: number }) => Promise<{ creditDollars: number }>;
  // Gives the credit back. Only called when Stripe definitely refused.
  release: (input: { invoiceId: string; reason: string }) => Promise<void>;
  // Sends the request to Stripe. Must resolve with the HTTP status (never throw on a non-2xx answer); may throw on a network failure.
  send: (request: StripeRequest) => Promise<{ status: number }>;
  // Optional: reads the invoice as it is NOW. A retry carries the old snapshot, so without this a retry could add a second line or hand back credit that
  // was already used. When present it is checked before any credit is used up; when it fails the credit is not touched.
  fetchInvoice?: (invoiceId: string) => Promise<StripeInvoiceObject>;
};

export type CreditOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "applied"; creditCents: number }
  | { outcome: "failed_released"; reason: string }
  | { outcome: "uncertain"; reason: string; creditCents: number };

const dollarsToCents = (dollars: number) => Math.round(dollars * 100);

export async function applyReferralCreditToDraftInvoice(
  object: StripeInvoiceObject,
  clientId: string,
  secretKey: string,
  deps: CreditDeps,
): Promise<CreditOutcome> {
  const checked = creditableInvoice(object);
  if (!checked.ok) return { outcome: "skipped", reason: checked.reason };
  if (hasCreditLine(object)) return { outcome: "skipped", reason: "credit_line_already_present" };
  if (!secretKey) return { outcome: "skipped", reason: "stripe_key_missing" };
  const invoice = checked.invoice;

  if (deps.fetchInvoice) {
    let live: StripeInvoiceObject;
    try { live = await deps.fetchInvoice(invoice.invoiceId); }
    catch { return { outcome: "skipped", reason: "live_invoice_unavailable" }; }
    if (live.status !== "draft") return { outcome: "skipped", reason: "invoice_not_draft" };
    if (hasCreditLine(live)) return { outcome: "skipped", reason: "credit_line_already_present" };
  }

  try { await deps.matureCredits(); } catch { /* late credit is better than a broken invoice */ }

  const reserved = await deps.reserve({ clientId, invoiceId: invoice.invoiceId, subtotalDollars: invoice.subtotalDollars });
  const creditCents = dollarsToCents(Number(reserved.creditDollars) || 0);
  if (creditCents <= 0) return { outcome: "skipped", reason: "no_credit_available" };

  let request: StripeRequest;
  try { request = buildInvoiceItemRequest(secretKey, invoice, creditCents); }
  catch (error) {
    // The database used more credit than the invoice can carry: hand it back and do not call Stripe.
    await deps.release({ invoiceId: invoice.invoiceId, reason: error instanceof Error ? error.message : "credit_rejected" });
    return { outcome: "failed_released", reason: "credit_over_limit" };
  }

  let status: number;
  try { status = (await deps.send(request)).status; }
  catch { return { outcome: "uncertain", reason: "stripe_unreachable", creditCents }; }

  if (status >= 200 && status < 300) return { outcome: "applied", creditCents };
  if (status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429) {
    await deps.release({ invoiceId: invoice.invoiceId, reason: `stripe_refused_${status}` });
    return { outcome: "failed_released", reason: `stripe_refused_${status}` };
  }
  return { outcome: "uncertain", reason: `stripe_status_${status}`, creditCents };
}
