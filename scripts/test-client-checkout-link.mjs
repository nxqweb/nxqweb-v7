// Offline test: "NXQX creates a hosted Stripe checkout link for a client" (billing model A1), 2026-11-26. The code is a DRAFT at
// docs/drafts/functions/create-client-checkout-link. Everything here runs against a PRETEND database and a PRETEND Stripe (no network, no keys, no real money).
// Proves: test keys by default, the amount only comes from the database, the customer is linked before checkout, only Stripe-hosted pages are handed out,
// retries never duplicate a customer or a session, the secret key never leaks, and the whole thing is still only a draft.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createClientCheckoutLink } from "../docs/drafts/functions/create-client-checkout-link/core.ts";
import {
  buildCheckoutSessionRequest, buildCustomerRequest, cleanText, readCustomerResponse, readKeyMode, readSessionResponse, returnUrl, MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS,
} from "../docs/drafts/functions/create-client-checkout-link/stripe.ts";
import { readCheckoutCompleted } from "../docs/drafts/functions/create-client-checkout-link/checkout-completed.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const dir = "docs/drafts/functions/create-client-checkout-link";
const KEY = "sk_test_FAKEFAKEFAKEFAKE1234";
const LIVE = "sk_live_FAKEFAKE1234";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const config = (extra = {}) => ({ secretKey: KEY, liveAllowed: false, returnBaseUrl: "https://app.example-nxqx.test", allowedReturnHosts: ["app.example-nxqx.test"], ...extra });

// ---- a pretend Stripe that remembers idempotency keys, like the real one, and can be told to misbehave
function pretendStripe(opts = {}) {
  const seen = new Map();
  const log = { customers: 0, sessions: 0, requests: [] };
  const mode = opts.livemode ?? false;
  async function send(request) {
    log.requests.push(request);
    if (opts.throwOn?.(request)) throw new Error(`socket hang up ${request.headers.Authorization}`);
    const forced = opts.answer?.(request);
    if (forced) return forced;
    const idem = request.headers["Idempotency-Key"];
    if (seen.has(idem)) return seen.get(idem);
    const form = new URLSearchParams(request.body);
    let reply;
    if (request.url.endsWith("/v1/customers")) {
      log.customers += 1;
      reply = { status: 200, text: JSON.stringify({ id: "cus_PretendOne123", object: "customer", livemode: mode }) };
    } else {
      log.sessions += 1;
      reply = { status: 200, text: JSON.stringify({
        id: `cs_${mode ? "live" : "test"}_PretendSession${log.sessions}`, object: "checkout.session", mode: "subscription", livemode: mode, customer: form.get("customer"),
        client_reference_id: form.get("client_reference_id"), url: `https://checkout.stripe.com/c/pay/cs_${mode ? "live" : "test"}_PretendSession${log.sessions}`, expires_at: Number(form.get("expires_at")),
      }) };
    }
    seen.set(idem, reply);
    return reply;
  }
  return { send, log };
}

// ---- a pretend database
function pretendDb(opts = {}) {
  const state = { attempt: null, customer: opts.existingCustomer ?? null, recorded: [], created: [], failed: [], reserveCalls: 0 };
  const deps = (stripe) => ({
    reserve: async () => {
      state.reserveCalls += 1;
      if (opts.reserveThrows) throw new Error("db down");
      if (opts.refuse) return { ok: false, reason: opts.refuse };
      state.attempt ||= ATTEMPT; // a repeat request reuses the open attempt
      return { ok: true, reserved: { attemptId: state.attempt, clientId: CLIENT, businessName: opts.businessName ?? "Light of the World", contactEmail: opts.email ?? "owner@example.test", planName: opts.planName ?? "Business", amountCents: opts.amountCents ?? 5000, existingCustomerId: state.customer } };
    },
    recordCustomer: async (input) => { if (opts.recordCustomerFails) return false; state.recorded.push(input); state.customer = input.customerId; return true; },
    markCreated: async (input) => { if (opts.markCreatedFails) return false; state.created.push(input); return true; },
    markFailed: async (input) => { state.failed.push(input); },
    send: stripe.send,
    nowSeconds: () => 1_800_000_000,
  });
  return { state, deps };
}
const run = (db, stripe, cfg = config(), input = { clientId: CLIENT, requestedBy: OWNER }) => createClientCheckoutLink(input, db.deps(stripe), cfg);
const noKey = (value, key = KEY) => !JSON.stringify(value).includes(key);

// ---- key and mode
check("a test key is accepted by default and reports test mode", (() => { const k = readKeyMode(KEY, false); return k.ok && k.mode === "test"; })());
check("a restricted test key is accepted", readKeyMode("rk_test_FAKEFAKEFAKE1234", false).ok === true);
check("a live key is refused unless live mode is allowed", readKeyMode(LIVE, false).ok === false && readKeyMode(LIVE, false).reason === "live_mode_not_allowed" && readKeyMode(LIVE, true).ok === true && readKeyMode(LIVE, true).mode === "live");
check("an empty, short or oddly shaped key is refused", ["", "sk_test_", "pk_test_FAKEFAKEFAKE1234", "sk_test_has space 12345", "whsec_FAKEFAKEFAKE1234"].every((k) => readKeyMode(k, true).ok === false));
check("with a live key, nothing starts when live mode is off (no database, no Stripe)", await (async () => { const db = pretendDb(); const s = pretendStripe(); const r = await run(db, s, config({ secretKey: LIVE })); return r.ok === false && r.reason === "live_mode_not_allowed" && db.state.reserveCalls === 0 && s.log.requests.length === 0; })());

// ---- return addresses
check("return addresses must be https on an allowed host, with a plain path", returnUrl("https://app.example-nxqx.test", ["app.example-nxqx.test"], "/client/billing?checkout=success").ok === true
  && [["http://app.example-nxqx.test", "/x"], ["https://evil.test", "/x"], ["https://user:pw@app.example-nxqx.test", "/x"], ["not a url", "/x"], ["https://app.example-nxqx.test", "//evil.test"], ["https://app.example-nxqx.test", "/x y"]]
    .every(([base, path]) => returnUrl(base, ["app.example-nxqx.test"], path).ok === false));
check("a bad return address stops everything before the database is touched", await (async () => { const db = pretendDb(); const s = pretendStripe(); const r = await run(db, s, config({ returnBaseUrl: "https://evil.test" })); return r.ok === false && r.reason === "return_host_not_allowed" && db.state.reserveCalls === 0 && s.log.requests.length === 0; })());

// ---- the happy path: new customer
await (async () => {
  const db = pretendDb(); const stripe = pretendStripe(); const r = await run(db, stripe);
  const [customerReq, sessionReq] = stripe.log.requests;
  const cust = new URLSearchParams(customerReq?.body || ""); const sess = new URLSearchParams(sessionReq?.body || "");
  check("a new client gets exactly two Stripe calls: one customer, then one checkout session", r.ok === true && stripe.log.requests.length === 2 && customerReq.url === "https://api.stripe.com/v1/customers" && sessionReq.url === "https://api.stripe.com/v1/checkout/sessions");
  check("the customer carries the client id and the business name", cust.get("metadata[nxq_client_id]") === CLIENT && cust.get("name") === "Light of the World" && cust.get("email") === "owner@example.test");
  check("the customer is linked in the database BEFORE the link is handed out", db.state.recorded.length === 1 && db.state.recorded[0].customerId === "cus_PretendOne123" && db.state.recorded[0].attemptId === ATTEMPT);
  check("the session is a monthly USD subscription for exactly the database amount", sess.get("mode") === "subscription" && sess.get("line_items[0][price_data][unit_amount]") === "5000" && sess.get("line_items[0][price_data][currency]") === "usd"
    && sess.get("line_items[0][price_data][recurring][interval]") === "month" && sess.get("line_items[0][quantity]") === "1" && sess.get("line_items[0][price_data][product_data][name]") === "NXQX Business");
  check("the session is tied to the client and the attempt, and promo codes are off", sess.get("client_reference_id") === CLIENT && sess.get("customer") === "cus_PretendOne123" && sess.get("metadata[nxq_client_id]") === CLIENT && sess.get("metadata[nxq_attempt_id]") === ATTEMPT && sess.get("subscription_data[metadata][nxq_client_id]") === CLIENT && sess.get("allow_promotion_codes") === "false");
  check("the customer returns to NXQX on the allowed address only", sess.get("success_url") === "https://app.example-nxqx.test/client/billing?checkout=success" && sess.get("cancel_url") === "https://app.example-nxqx.test/client/billing?checkout=cancelled");
  check("the link expires in about 23 hours, inside Stripe's 24-hour limit", Number(sess.get("expires_at")) - 1_800_000_000 === 86_400 - 600);
  check("the idempotency keys are stable and tied to the client and the attempt", customerReq.headers["Idempotency-Key"] === `nxq-customer-${CLIENT}` && sessionReq.headers["Idempotency-Key"] === `nxq-checkout-${ATTEMPT}`);
  check("the secret key is only in the Authorization header, never in a body, URL or the result", stripe.log.requests.every((q) => q.headers.Authorization === `Bearer ${KEY}` && !q.body.includes(KEY) && !q.url.includes(KEY)) && noKey(r) && noKey(db.state));
  check("the result is a Stripe-hosted page plus ids, and the session is recorded", r.ok && new URL(r.url).hostname === "checkout.stripe.com" && r.sessionId === "cs_test_PretendSession1" && r.mode === "test" && r.amountCents === 5000 && db.state.created.length === 1 && db.state.created[0].sessionId === r.sessionId && db.state.failed.length === 0);
})();

// ---- a client that already has a linked customer
check("a client with a linked customer reuses it: one Stripe call, no new customer, no new link", await (async () => { const db = pretendDb({ existingCustomer: "cus_AlreadyLinked1" }); const s = pretendStripe(); const r = await run(db, s); const sess = new URLSearchParams(s.log.requests[0]?.body || ""); return r.ok && s.log.requests.length === 1 && s.log.customers === 0 && sess.get("customer") === "cus_AlreadyLinked1" && db.state.recorded.length === 0; })());

// ---- the database says no
check("every refusal from the database stops the flow with no Stripe call", await (async () => {
  for (const reason of ["owner_required", "client_not_found", "client_not_billable", "no_plan_price", "already_subscribed"]) {
    const db = pretendDb({ refuse: reason }); const s = pretendStripe(); const r = await run(db, s);
    if (r.ok || r.reason !== reason || r.retrySafe !== false || s.log.requests.length !== 0 || db.state.created.length !== 0) return false;
  }
  return true;
})());
check("a database failure while reserving is reported as retry-safe and calls nothing", await (async () => { const s = pretendStripe(); const r = await run(pretendDb({ reserveThrows: true }), s); return r.ok === false && r.reason === "reserve_failed" && r.retrySafe === true && s.log.requests.length === 0; })());
check("the caller cannot choose the amount: the function only accepts a client id and a requester", await (async () => { const db = pretendDb({ amountCents: 5000 }); const s = pretendStripe(); await createClientCheckoutLink({ clientId: CLIENT, requestedBy: OWNER, amountCents: 1, amount: 1 }, db.deps(s), config()); return new URLSearchParams(s.log.requests[1].body).get("line_items[0][price_data][unit_amount]") === "5000"; })());
check("bad client or requester ids are refused before anything happens", await (async () => { for (const input of [{ clientId: "nope", requestedBy: OWNER }, { clientId: CLIENT, requestedBy: "" }, { clientId: undefined, requestedBy: OWNER }]) { const db = pretendDb(); const r = await run(db, pretendStripe(), config(), input); if (r.ok || db.state.reserveCalls !== 0) return false; } return true; })());

// ---- amount rules in the builder (second line of defence)
const goodSession = { attemptId: ATTEMPT, clientId: CLIENT, customerId: "cus_PretendOne123", planName: "Business", amountCents: 5000, successUrl: "https://app.example-nxqx.test/a", cancelUrl: "https://app.example-nxqx.test/b" };
check("the session builder refuses amounts under $10, over the ceiling, fractional or not a number", [0, -100, 999, MAX_AMOUNT_CENTS + 1, 50.5, NaN, "5000"].every((amountCents) => { try { buildCheckoutSessionRequest(KEY, { ...goodSession, amountCents }); return false; } catch { return true; } })
  && (() => { try { buildCheckoutSessionRequest(KEY, { ...goodSession, amountCents: MIN_AMOUNT_CENTS }); buildCheckoutSessionRequest(KEY, { ...goodSession, amountCents: MAX_AMOUNT_CENTS }); return true; } catch { return false; } })());
check("the session builder refuses a bad customer, bad ids and non-https return addresses", [{ customerId: "evil&x=1" }, { customerId: "cus_" }, { attemptId: "x" }, { clientId: "x" }, { successUrl: "http://app.example-nxqx.test/a" }, { cancelUrl: "javascript:alert(1)" }, { expiresAtSeconds: 1.5 }]
  .every((bad) => { try { buildCheckoutSessionRequest(KEY, { ...goodSession, ...bad }); return false; } catch { return true; } }));

// ---- text that goes into Stripe cannot break out of its field
check("a hostile business name is cleaned and cannot add extra form fields", (() => {
  const evil = "Shop\n\r&amp;line_items[0][price_data][unit_amount]=1&mode=payment\u0000";
  const req = buildCustomerRequest(KEY, { clientId: CLIENT, businessName: evil, contactEmail: "not an email" });
  const form = new URLSearchParams(req.body); const keys = [...form.keys()];
  return keys.sort().join(",") === "metadata[nxq_client_id],name" && !/[\u0000-\u001f]/.test(form.get("name")) && form.get("name").length <= 120 && cleanText("a".repeat(500), 80).length === 80;
})());
check("an empty business name or bad client id is refused by the customer builder", [{ businessName: "   " }, { clientId: "x" }].every((bad) => { try { buildCustomerRequest(KEY, { clientId: CLIENT, businessName: "Ok", ...bad }); return false; } catch { return true; } }));

// ---- Stripe gives answers we must not trust
const base = () => ({ id: "cs_test_AbCd1234", mode: "subscription", livemode: false, customer: "cus_PretendOne123", client_reference_id: CLIENT, url: "https://checkout.stripe.com/c/pay/cs_test_AbCd1234", expires_at: 1_800_080_000 });
const expectation = { mode: "test", customerId: "cus_PretendOne123", clientId: CLIENT };
const read = (patch) => readSessionResponse(200, JSON.stringify({ ...base(), ...patch }), expectation);
check("a well-formed Stripe session is accepted", read({}).ok === true);
check("a page that is not Stripe's hosted checkout is thrown away (other host, lookalike, http, userinfo, missing, junk)", [
  { url: "https://evil.test/pay" }, { url: "https://checkout.stripe.com.evil.test/pay" }, { url: "http://checkout.stripe.com/pay" }, { url: "https://user:pw@checkout.stripe.com/pay" }, { url: "" }, { url: undefined }, { url: "javascript:alert(1)" }, { url: "https://notcheckout.stripe.com/pay" },
].every((patch) => read(patch).ok === false));
check("a session in the wrong mode, for the wrong customer, client or kind of checkout is refused", [{ livemode: true }, { id: "cs_live_AbCd1234" }, { mode: "payment" }, { customer: "cus_SomeoneElse1" }, { client_reference_id: "44444444-4444-4444-8444-444444444444" }, { id: "nope" }].every((patch) => read(patch).ok === false));
check("an answer that is not JSON, or not an object, is 'unknown' (retry-safe), never a success", ["", "<html>", "null", "[]", "42"].every((text) => { const r = readSessionResponse(200, text, expectation); return r.ok === false && r.kind === "unknown"; }));
check("a customer answer in the wrong mode or with a bad id is refused", readCustomerResponse(200, JSON.stringify({ id: "cus_PretendOne123", livemode: true }), "test").ok === false && readCustomerResponse(200, JSON.stringify({ id: "x", livemode: false }), "test").ok === false && readCustomerResponse(200, JSON.stringify({ id: "cus_PretendOne123", livemode: false }), "test").ok === true);

// ---- Stripe says no, or is unreachable
check("Stripe definitely refuses (400, 401, 402, 403, 404, 422): the attempt is marked failed once and the client can try again later", await (async () => {
  for (const status of [400, 401, 402, 403, 404, 422]) {
    const db = pretendDb({ existingCustomer: "cus_AlreadyLinked1" }); const s = pretendStripe({ answer: () => ({ status, text: JSON.stringify({ error: { type: "invalid_request_error", code: "parameter_invalid_integer", message: `bad ${KEY}` } }) }) });
    const r = await run(db, s);
    if (r.ok || r.retrySafe !== false || db.state.failed.length !== 1 || db.state.failed[0].attemptId !== ATTEMPT || !noKey(r) || !noKey(db.state) || !r.reason.startsWith(`stripe_status_${status}`)) return false;
  }
  return true;
})());
check("Stripe's answer is unknown (408, 409, 429, 500, 502, 503): the attempt stays open and the call is retry-safe", await (async () => {
  for (const status of [408, 409, 429, 500, 502, 503]) {
    const db = pretendDb({ existingCustomer: "cus_AlreadyLinked1" }); const s = pretendStripe({ answer: () => ({ status, text: "{}" }) });
    const r = await run(db, s);
    if (r.ok || r.retrySafe !== true || db.state.failed.length !== 0 || db.state.created.length !== 0) return false;
  }
  return true;
})());
check("a network failure is retry-safe, leaves the attempt open, and the key does not leak", await (async () => { const db = pretendDb({ existingCustomer: "cus_AlreadyLinked1" }); const s = pretendStripe({ throwOn: () => true }); const r = await run(db, s); return r.ok === false && r.reason === "stripe_unreachable" && r.retrySafe === true && db.state.failed.length === 0 && noKey(r); })());
check("a session that points at a fake page is never handed out", await (async () => { const db = pretendDb({ existingCustomer: "cus_AlreadyLinked1" }); const s = pretendStripe({ answer: () => ({ status: 200, text: JSON.stringify({ ...base(), customer: "cus_AlreadyLinked1", url: "https://evil.test/pay" }) }) }); const r = await run(db, s); return r.ok === false && !JSON.stringify(r).includes("evil.test") && db.state.created.length === 0; })());

// ---- retries never duplicate anything
check("a network failure on the session, then a retry: ONE customer and ONE session exist, and the retry works", await (async () => {
  const db = pretendDb(); let failOnce = true;
  const s = pretendStripe({ throwOn: (q) => { if (q.url.endsWith("/checkout/sessions") && failOnce) { failOnce = false; return true; } return false; } });
  const first = await run(db, s); const second = await run(db, s);
  const sessionKeys = s.log.requests.filter((q) => q.url.endsWith("/checkout/sessions")).map((q) => q.headers["Idempotency-Key"]);
  return first.ok === false && first.retrySafe === true && second.ok === true && s.log.customers === 1 && s.log.sessions === 1 && sessionKeys.length === 2 && sessionKeys[0] === sessionKeys[1] && db.state.recorded.length === 1;
})());
check("asking twice after success hands back the SAME session (Stripe repeats its answer for the same key)", await (async () => { const db = pretendDb(); const s = pretendStripe(); const a = await run(db, s); const b = await run(db, s); return a.ok && b.ok && a.sessionId === b.sessionId && a.url === b.url && s.log.customers === 1 && s.log.sessions === 1; })());
check("the customer is created but cannot be linked: no link is handed out, the attempt stays open, a retry reuses the same Stripe customer", await (async () => {
  const s = pretendStripe(); const dbBad = pretendDb({ recordCustomerFails: true }); const r = await run(dbBad, s);
  const dbGood = pretendDb(); const again = await run(dbGood, s);
  return r.ok === false && r.reason === "customer_link_failed" && r.retrySafe === true && dbBad.state.failed.length === 0 && s.log.requests.filter((q) => q.url.endsWith("/checkout/sessions")).length === 1 && again.ok === true && s.log.customers === 1;
})());
check("if the session cannot be recorded, the link is NOT handed out (fail closed)", await (async () => { const db = pretendDb({ markCreatedFails: true }); const s = pretendStripe(); const r = await run(db, s); return r.ok === false && r.reason === "session_not_recorded" && !JSON.stringify(r).includes("checkout.stripe.com"); })());
check("a failing 'mark failed' call never turns a refusal into a crash", await (async () => { const db = pretendDb({ existingCustomer: "cus_AlreadyLinked1" }); const s = pretendStripe({ answer: () => ({ status: 402, text: "{}" }) }); const deps = db.deps(s); deps.markFailed = async () => { throw new Error("db down"); }; const r = await createClientCheckoutLink({ clientId: CLIENT, requestedBy: OWNER }, deps, config()); return r.ok === false && r.retrySafe === false; })());
check("no result of any kind, on any path, ever contains the secret key", await (async () => {
  const worlds = [{}, { existingCustomer: "cus_AlreadyLinked1" }, { refuse: "no_plan_price" }, { recordCustomerFails: true }, { markCreatedFails: true }];
  for (const w of worlds) for (const st of [{}, { throwOn: () => true }, { answer: () => ({ status: 500, text: KEY }) }, { answer: () => ({ status: 402, text: JSON.stringify({ error: { message: KEY, code: KEY } }) }) }]) {
    const db = pretendDb(w); const r = await run(db, pretendStripe(st)); if (!noKey(r) || !noKey(db.state)) return false;
  }
  return true;
})());

// ---- the webhook side: "checkout finished"
const done = (patch = {}) => ({ id: "cs_test_AbCd1234", mode: "subscription", payment_status: "paid", customer: "cus_PretendOne123", subscription: "sub_PretendSub1", client_reference_id: CLIENT, metadata: { nxq_client_id: CLIENT, nxq_attempt_id: ATTEMPT }, ...patch });
check("a finished NXQX subscription checkout is read correctly", (() => { const r = readCheckoutCompleted(done()); return r.ok && r.value.sessionId === "cs_test_AbCd1234" && r.value.customerId === "cus_PretendOne123" && r.value.subscriptionId === "sub_PretendSub1" && r.value.clientId === CLIENT && r.value.attemptId === ATTEMPT; })());
check("a $0 trial or full-coupon checkout ('no_payment_required') counts as finished", readCheckoutCompleted(done({ payment_status: "no_payment_required" })).ok === true);
check("everything else is ignored: unpaid, one-off payment, no subscription, bad ids, someone else's checkout", [
  { payment_status: "unpaid" }, { mode: "payment" }, { subscription: null }, { subscription: "x" }, { customer: "x" }, { id: "x" }, { client_reference_id: "nope" }, { metadata: {} }, { metadata: undefined }, { metadata: { nxq_client_id: "44444444-4444-4444-8444-444444444444" } },
].every((patch) => readCheckoutCompleted(done(patch)).ok === false));
check("an attempt id that is not a real id is dropped rather than trusted", (() => { const r = readCheckoutCompleted(done({ metadata: { nxq_client_id: CLIENT, nxq_attempt_id: "'; drop table x;--" } })); return r.ok && r.value.attemptId === null; })());

// ---- source hygiene and 'still a draft'
const files = ["stripe.ts", "core.ts", "checkout-completed.ts"].map((f) => [f, fs.readFileSync(`${dir}/${f}`, "utf8")]);
check("the pure modules never log, read the environment, or call fetch themselves", files.every(([, src]) => !/console\./.test(src) && !/Deno\.env/.test(src) && !/process\.env/.test(src) && !/\bfetch\(/.test(src)));
check("the only Stripe addresses in the code are the customer, checkout session and hosted checkout page", (() => { const urls = files.flatMap(([, src]) => [...src.matchAll(/https?:\/\/[^"'`\s)]+/g)].map((m) => m[0])).filter((u) => !/example|^https?:\/\/\$/.test(u)); return urls.every((u) => u.startsWith("https://api.stripe.com/v1/") || u === "https://api.stripe.com/v1/${path}"); })());
const index = fs.readFileSync(`${dir}/index.ts`, "utf8");
check("the handler is OFF unless both switches are 'true', needs a signed-in owner, and has no log lines", /if \(!on\("NXQ_BILLING_ENABLED"\) \|\| !on\("NXQ_STRIPE_CHECKOUT_ENABLED"\)\) return respond\([^;]*503\)/.test(index) && /owner_users/.test(index) && /Owner access required/.test(index) && !/console\./.test(index)
  && index.indexOf('on("NXQ_STRIPE_CHECKOUT_ENABLED")') < index.indexOf("auth.getUser"));
check("the handler hides Stripe and database error text from the caller", /catch \{/.test(index) && /Checkout link could not be created\./.test(index) && !/error\.message/.test(index));
check("the draft function is NOT in supabase/functions, NOT in the manifest and NOT in config.toml", !fs.existsSync("supabase/functions/create-client-checkout-link") && !fs.readFileSync("scripts/edge-function-manifest.mjs", "utf8").includes("create-client-checkout-link") && !fs.readFileSync("supabase/config.toml", "utf8").includes("create-client-checkout-link"));
check("the draft migration is NOT a real migration and the functions it calls exist only in the draft", fs.existsSync("docs/drafts/migrations/13_stripe_checkout_links.sql") && !fs.readdirSync("supabase/migrations").some((f) => /checkout_links/.test(f)) && /nxq_checkout_reserve/.test(fs.readFileSync("docs/drafts/migrations/13_stripe_checkout_links.sql", "utf8")));
const sql = fs.readFileSync("docs/drafts/migrations/13_stripe_checkout_links.sql", "utf8");
check("every database function the handler calls exists in the draft migration with service-role-only access", ["nxq_checkout_reserve", "nxq_checkout_record_customer", "nxq_checkout_mark_created", "nxq_checkout_mark_failed", "nxq_checkout_mark_completed"].every((fn) => index.includes(fn) || fn === "nxq_checkout_mark_completed")
  && ["nxq_checkout_reserve", "nxq_checkout_record_customer", "nxq_checkout_mark_created", "nxq_checkout_mark_failed", "nxq_checkout_mark_completed"].every((fn) => new RegExp(`create or replace function public\\.${fn}\\(`).test(sql) && new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`).test(sql) && new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`).test(sql)));
check("the draft migration has no grants to anon or authenticated on the attempts table other than owner read", !/grant (insert|update|delete)[^;]*billing_checkout_attempts to (anon|authenticated)/i.test(sql) && /grant select on public\.billing_checkout_attempts to authenticated/.test(sql));

// ---- the parked webhook change applies to today's webhook
const patchPath = `${dir}/ingest-stripe-webhook.checkout-completed.patch`;
check("the parked webhook patch exists and applies cleanly to the current webhook (checked, not applied)", fs.existsSync(patchPath) && spawnSync("git", ["apply", "--check", patchPath], { encoding: "utf8" }).status === 0);
const patchText = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
check("the webhook patch only touches the webhook, handles checkout.session.completed, and checks the customer and client match before recording", /^diff --git a\/supabase\/functions\/ingest-stripe-webhook\/index\.ts/m.test(patchText) && (patchText.match(/^diff --git/gm) || []).length === 1
  && /checkout\.session\.completed/.test(patchText) && /nxq_checkout_mark_completed/.test(patchText) && /Checkout session does not match the linked client/.test(patchText));
check("the README explains the plug-in order and says nothing here has been adopted", fs.existsSync(`${dir}/README.md`) && /Adopting/.test(fs.readFileSync(`${dir}/README.md`, "utf8")) && /NOT deployed/.test(fs.readFileSync(`${dir}/README.md`, "utf8")));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll client-checkout-link checks passed (offline, pretend Stripe, no keys).");
process.exit(failures ? 1 : 0);
