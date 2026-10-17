// Offline test: referral credit on a Stripe invoice, run against a PRETEND database and a PRETEND Stripe (no network, no keys). Proves the money rules:
// only eligible invoices, never below the $10 floor, never twice, credit handed back only when Stripe definitely refused, and the key never leaks.
import fs from "node:fs";
import { applyReferralCreditToDraftInvoice, buildInvoiceItemRequest, creditableInvoice, hasCreditLine, minimumInvoiceCents } from "../supabase/functions/_shared/referral-invoice-credit.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const KEY = "sk_test_FAKEFAKEFAKEFAKE";
const invoice = (extra = {}) => ({ id: "in_1AbC2dEf", customer: "cus_Test12345", status: "draft", billing_reason: "subscription_cycle", currency: "usd", subtotal: 5000, lines: { data: [] }, ...extra });

function world({ credit = 40, stripeStatus = 200, stripeThrows = false, matureThrows = false } = {}) {
  const calls = { mature: 0, reserve: [], release: [], send: [] };
  return {
    calls,
    deps: {
      matureCredits: async () => { calls.mature += 1; if (matureThrows) throw new Error("db down"); },
      reserve: async (input) => { calls.reserve.push(input); return { creditDollars: credit }; },
      release: async (input) => { calls.release.push(input); },
      send: async (request) => { calls.send.push(request); if (stripeThrows) throw new Error(`socket hang up ${request.headers.Authorization}`); return { status: stripeStatus }; },
    },
  };
}
const run = (obj, w, key = KEY) => applyReferralCreditToDraftInvoice(obj, "client-1", key, w.deps);

// ---- which invoices qualify
check("a draft USD renewal invoice of $50 qualifies", creditableInvoice(invoice()).ok === true);
check("everything else is skipped before any money logic runs", [
  invoice({ status: "open" }), invoice({ status: "paid" }), invoice({ status: "finalized" }), invoice({ billing_reason: "subscription_create" }), invoice({ billing_reason: "manual" }),
  invoice({ currency: "eur" }), invoice({ subtotal: 999 }), invoice({ subtotal: 5000.5 }), invoice({ subtotal: "5000" }), invoice({ subtotal: -5000 }), invoice({ id: "xx_1" }), invoice({ customer: "evil&x=1" }), invoice({ id: "in_../../x" }),
].every((o) => creditableInvoice(o).ok === false));
check("no database or Stripe call happens for an ineligible invoice", await (async () => { const w = world(); const r = await run(invoice({ status: "open" }), w); return r.outcome === "skipped" && w.calls.reserve.length === 0 && w.calls.send.length === 0 && w.calls.mature === 0; })());
check("an invoice that already carries our credit line is skipped without touching credit", await (async () => { const w = world(); const r = await run(invoice({ lines: { data: [{ metadata: { nxq_referral_credit: "true" } }] } }), w); return r.reason === "credit_line_already_present" && w.calls.reserve.length === 0 && w.calls.send.length === 0; })() && hasCreditLine(invoice({ lines: { data: [{ metadata: { other: "x" } }, { metadata: { nxq_referral_credit: "true" } }] } })) && !hasCreditLine(invoice()));
check("no Stripe key means nothing happens", await (async () => { const w = world(); const r = await run(invoice(), w, ""); return r.reason === "stripe_key_missing" && w.calls.reserve.length === 0; })());

// ---- the happy path
check("a $40 credit on a $50 invoice sends exactly one negative line of 4000 cents", await (async () => {
  const w = world({ credit: 40 }); const r = await run(invoice(), w);
  const sent = w.calls.send[0]; const body = new URLSearchParams(sent?.body || "");
  return r.outcome === "applied" && r.creditCents === 4000 && w.calls.send.length === 1 && sent.url === "https://api.stripe.com/v1/invoiceitems" && sent.method === "POST"
    && body.get("amount") === "-4000" && body.get("currency") === "usd" && body.get("invoice") === "in_1AbC2dEf" && body.get("customer") === "cus_Test12345" && body.get("metadata[nxq_referral_credit]") === "true" && w.calls.release.length === 0;
})());
check("the request carries the key only in the Authorization header, and a stable idempotency key", await (async () => {
  const w = world(); await run(invoice(), w); const sent = w.calls.send[0];
  const again = buildInvoiceItemRequest(KEY, creditableInvoice(invoice()).invoice, 4000);
  return sent.headers.Authorization === `Bearer ${KEY}` && !sent.body.includes(KEY) && !sent.url.includes(KEY) && sent.headers["Idempotency-Key"] === "nxq-referral-credit-in_1AbC2dEf-4000" && again.headers["Idempotency-Key"] === sent.headers["Idempotency-Key"];
})());
check("due credit is matured first, and a failure there does not stop the invoice", await (async () => { const w = world({ matureThrows: true }); const r = await run(invoice(), w); return w.calls.mature === 1 && r.outcome === "applied"; })());
check("the database is asked about the exact invoice and subtotal in dollars", await (async () => { const w = world(); await run(invoice(), w); return JSON.stringify(w.calls.reserve[0]) === JSON.stringify({ clientId: "client-1", invoiceId: "in_1AbC2dEf", subtotalDollars: 50 }); })());
check("cents are rounded safely (floating point cannot add or lose a cent)", await (async () => { const w = world({ credit: 19.99 }); const r = await run(invoice(), w); return r.creditCents === 1999 && w.calls.send[0].body.includes("amount=-1999"); })());

// ---- no credit
check("no credit means no Stripe call and nothing handed back", await (async () => { const w = world({ credit: 0 }); const r = await run(invoice(), w); return r.reason === "no_credit_available" && w.calls.send.length === 0 && w.calls.release.length === 0; })());

// ---- the $10 floor, checked again here
check("a credit that would take the invoice under $10 is never sent and is handed back", await (async () => { const w = world({ credit: 45 }); const r = await run(invoice(), w); return r.outcome === "failed_released" && w.calls.send.length === 0 && w.calls.release.length === 1; })());
check("exactly the allowed maximum ($40 of $50) is sent", await (async () => { const w = world({ credit: 40 }); const r = await run(invoice(), w); return r.outcome === "applied" && w.calls.send.length === 1; })());
check("the request builder refuses zero, negative, fractional and over-floor amounts", [0, -5, 1.5, 4001].every((c) => { try { buildInvoiceItemRequest(KEY, creditableInvoice(invoice()).invoice, c); return false; } catch { return true; } }) && minimumInvoiceCents === 1000);

// ---- Stripe failures
check("Stripe definitely refuses (400, 401, 402, 403, 404, 422): the credit is handed back, once", await (async () => {
  for (const status of [400, 401, 402, 403, 404, 422]) { const w = world({ stripeStatus: status }); const r = await run(invoice(), w); if (r.outcome !== "failed_released" || w.calls.release.length !== 1 || w.calls.release[0].invoiceId !== "in_1AbC2dEf") return false; }
  return true;
})());
check("Stripe answer is unknown (408, 409, 429, 500, 502, 503): the credit is NOT handed back, so no double credit", await (async () => {
  for (const status of [408, 409, 429, 500, 502, 503]) { const w = world({ stripeStatus: status }); const r = await run(invoice(), w); if (r.outcome !== "uncertain" || w.calls.release.length !== 0 || r.creditCents !== 4000) return false; }
  return true;
})());
check("a network failure is 'uncertain', never handed back, and the key never leaks into the result", await (async () => { const w = world({ stripeThrows: true }); const r = await run(invoice(), w); return r.outcome === "uncertain" && w.calls.release.length === 0 && !JSON.stringify(r).includes(KEY); })());
check("no outcome of any kind ever contains the key", await (async () => { for (const opts of [{}, { stripeStatus: 400 }, { stripeStatus: 500 }, { stripeThrows: true }, { credit: 0 }, { credit: 45 }]) { const w = world(opts); const r = await run(invoice(), w); if (JSON.stringify(r).includes(KEY)) return false; } return true; })());

// ---- source hygiene
const src = fs.readFileSync("supabase/functions/_shared/referral-invoice-credit.ts", "utf8");
check("the module never logs, and never reads secrets from the environment itself", !/console\./.test(src) && !/Deno\.env/.test(src) && !/process\.env/.test(src));
check("the module only ever talks to Stripe's invoice item endpoint over https", [...src.matchAll(/https?:\/\/[^"'`\s)]+/g)].map((m) => m[0]).every((u) => u === "https://api.stripe.com/v1/invoiceitems"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll referral-invoice-credit checks passed (offline).");
process.exit(failures ? 1 : 0);
