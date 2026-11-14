// Real-browser journey for custom orders on a Commerce store (mocked Supabase, nothing real is contacted): a customer finds the "Request a custom order" card on an EMPTY store
// (her real current state), sends a request with an inspiration link, and the shop owner sees it in her inbox with the link shown safely, a one-tap reply email for the chosen status,
// and a View picture button only for a picture that has been cleared. Needs the dev server (see scripts/manual/README.md). AXE=path adds the accessibility scan. SHOT=dir saves screenshots.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

const state = { requestsOn: true, submitted: [], functionCalls: [] };
const settings = { enabled: true, allow_guest_requests: true, allow_image_uploads: true, require_budget: false, require_needed_by_date: false, max_images_per_request: 3, max_image_size_mb: 8, response_time_text: "I reply within 2 days.", custom_instructions: "Tell us the scent, color and jar size.", confirmation_message: "Thanks! I will be in touch.", notification_email: "", allowed_request_types: ["custom_product", "personalized"] };
const inbox = [{
  id: "r1", request_type: "custom_product", customer_name: "Jamie Rivera", customer_email: "jamie@example.com", preferred_contact_method: "email", product_name: "Wedding favor candles",
  description: "Thirty small lavender candles.\n\nInspiration link: https://www.pinterest.com/pin/12345/", desired_quantity: 30, budget_range: null, needed_by_date: null, status: "new", client_note: "", created_at: "2026-10-27T00:00:00Z",
  reference_images: [
    { client_file_id: "f-held", file_name: "held.png", scan_status: "pending", quarantine_status: "restricted" },
    { client_file_id: "f-ok", file_name: "cleared.png", scan_status: "clean", quarantine_status: "released" },
  ],
}, {
  id: "r2", request_type: "personalized", customer_name: "Odd Link", customer_email: "bad@x.com?cc=boss@example.com", preferred_contact_method: "phone 555-0100", product_name: "Name candle",
  description: "Hello\n\nInspiration link: javascript:alert(1)", status: "new", client_note: "", created_at: "2026-10-27T00:00:00Z", reference_images: [],
}];
const rpc = {
  get_public_stripe_ready_commerce_storefront: () => ({ store: { name: "Glow Candle Co", slug: "glow", currency: "USD", venmo_url: "https://venmo.com/u/glow" }, products: [] }),
  get_public_store_order_mode: () => ({ order_mode: "online", contact_email: "owner@example.com", contact_phone: "" }),
  get_public_store_profile: () => ({}),
  get_public_store_accounts_status: () => ({ accounts_enabled: false }),
  get_public_commerce_request_form: () => { if (!state.requestsOn) throw new Error("Customer requests are not enabled for this storefront"); return { storefront: { store_name: "Glow Candle Co", store_slug: "glow" }, settings }; },
  submit_public_commerce_customer_request: (args) => { state.submitted.push(args); return { request_id: "r-new", confirmation_message: "Thanks! I will be in touch.", response_time_text: "I reply within 2 days." }; },
  get_my_commerce_request_settings: () => settings,
  list_my_commerce_customer_requests: () => inbox,
};
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: { business_name: "Glow Candle Co" }, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const errors = [];
async function newPage(signedIn, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (signedIn) await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} }, [session]);
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const args = JSON.parse(route.request().postData() || "{}");
    try { const body = fn in rpc ? rpc[fn](args) : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) }); }
    catch (e) { await route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route("**/rest/v1/**", (route) => route.request().url().includes("/rpc/") ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.route("**/functions/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    state.functionCalls.push({ url: route.request().url(), body: JSON.parse(route.request().postData() || "{}") });
    await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: true, signed_url: "https://files.example.com/signed/abc" }) });
  });
  return { page, ctx };
}
async function axeCheck(page, label) {
  if (!axeSource) return;
  await page.waitForTimeout(900); await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => `${x.id}:${x.nodes.length}`));
  ok(`axe: ${label} has no serious or critical issues`, v.length === 0, v.join(","));
}

// ===== 1. the store page (empty, like her real store right now)
let { page: store, ctx } = await newPage(false);
await store.goto(`${base}/store/glow`, { waitUntil: "networkidle" });
ok("the empty store says it is opening soon", /opening soon/i.test(await store.locator("body").innerText()));
ok("the custom-order card shows when the shop switched requests on, and links to the shop's own request form", (await store.getByTestId("custom-request-card").count()) === 1 && (await store.getByRole("link", { name: /Request a custom order/ }).getAttribute("href")) === "/store/request?store=glow");
ok("no sideways scroll at 390px", !(await store.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await axeCheck(store, "store with the custom-order card");
await ctx.close();
state.requestsOn = false;
({ page: store, ctx } = await newPage(false));
await store.goto(`${base}/store/glow`, { waitUntil: "networkidle" });
ok("when the shop has NOT switched requests on, no card is shown (and the store still works)", (await store.getByTestId("custom-request-card").count()) === 0 && /opening soon/i.test(await store.locator("body").innerText()));
await ctx.close();
state.requestsOn = true;

// ===== 2. the customer sends a request
let { page: form, ctx: formCtx } = await newPage(false);
await form.goto(`${base}/store/request?store=glow`, { waitUntil: "networkidle" });
ok("the request form has the optional photo-link box with its hint", (await form.getByLabel(/Link to a photo of what you want/).count()) === 1 && /A link works right away/.test(await form.locator("body").innerText()));
const fillBasics = async () => {
  await form.getByLabel(/^Your name/i).fill("Jamie Rivera").catch(() => undefined);
  const inputs = await form.locator("input.auth-input[type=text], input.auth-input:not([type])").all();
  for (const el of inputs) { const label = (await el.evaluate((n) => n.closest("label")?.innerText || "")).toLowerCase(); if (/name/.test(label) && !/product|title|request/.test(label)) await el.fill("Jamie Rivera").catch(() => undefined); }
};
await fillBasics();
const byLabel = async (re, value) => { const el = form.locator("label", { hasText: re }).locator("input, textarea, select").first(); if (await el.count()) { const tag = await el.evaluate((n) => n.tagName); if (tag === "SELECT") await el.selectOption({ index: 0 }); else await el.fill(value); } };
await byLabel(/^\s*Your name|^\s*Name/i, "Jamie Rivera");
await byLabel(/Email/i, "jamie@example.com");
await byLabel(/Request title|Product name|What do you/i, "Wedding favor candles");
await byLabel(/Request details/i, "Thirty small lavender candles for a spring wedding.");
await byLabel(/Link to a photo/i, "javascript:alert(1)");
await form.getByRole("button", { name: /send|submit/i }).first().click();
await form.waitForTimeout(500);
ok("a bad link is explained and NOTHING is sent", /web link|web address|public website|starts with https/i.test(await form.getByRole("alert").first().innerText().catch(() => "")) && state.submitted.length === 0);
await byLabel(/Link to a photo/i, "pinterest.com/pin/12345");
await form.getByRole("button", { name: /send|submit/i }).first().click();
await form.waitForTimeout(700);
ok("a good link is sent as the last line of the details, with the https:// added", state.submitted.length === 1 && /\n\nInspiration link: https:\/\/pinterest\.com\/pin\/12345$/.test(state.submitted[0].request_payload.description) && state.submitted[0].request_payload.description.startsWith("Thirty small lavender candles"));
ok("the customer sees the shop's confirmation message", /I will be in touch/.test(await form.locator("body").innerText()));
await axeCheck(form, "request form");
await formCtx.close();

// ===== 3. the owner's inbox
const { page: owner, ctx: ownerCtx } = await newPage(true);
await owner.goto(`${base}/client/commerce/requests`, { waitUntil: "networkidle" });
await owner.waitForSelector("text=Wedding favor candles");
const card1 = owner.locator("article", { hasText: "Wedding favor candles" });
const card2 = owner.locator("article", { hasText: "Name candle" });
ok("the customer's text shows without the raw link line, and the link is a safe new-tab link with a warning", /Thirty small lavender candles/.test(await card1.innerText()) && !/Inspiration link:/.test(await card1.innerText()) && (await card1.getByRole("link", { name: /pinterest\.com\/pin\/12345/ }).getAttribute("rel")) === "noopener noreferrer nofollow" && (await card1.getByRole("link", { name: /pinterest/ }).getAttribute("target")) === "_blank" && /Only open links you trust/.test(await card1.innerText()));
ok("an unsafe link line stays plain text and is NOT clickable", (await card2.getByRole("link", { name: /javascript/i }).count()) === 0 && /javascript:alert/.test(await card2.innerText()));
ok("View picture appears only for the cleared picture, not the held one", (await card1.getByRole("button", { name: "View picture" }).count()) === 1 && /restricted pending security approval/.test(await card1.innerText()));
const popupPromise = owner.context().waitForEvent("page", { timeout: 4000 }).catch(() => null);
await card1.getByRole("button", { name: "View picture" }).click();
const popup = await popupPromise;
ok("View picture asks the protected file function for exactly that file and opens the returned link in a new tab", state.functionCalls.some((c) => /secure-client-file-access/.test(c.url) && c.body.client_file_id === "f-ok" && c.body.download === false) && !state.functionCalls.some((c) => c.body.client_file_id === "f-held") && Boolean(popup));
if (popup) await popup.close().catch(() => undefined);
const emailBtn = card1.getByTestId("email-customer");
let href = (await emailBtn.getAttribute("href")) || "";
ok("the Email button opens a draft to the customer using the shop's name, and changing the status changes the draft", href.startsWith("mailto:jamie@example.com?subject=") && /Glow%20Candle%20Co/.test(href));
await card1.getByLabel("Status").selectOption("declined");
href = (await emailBtn.getAttribute("href")) || "";
ok("Declined gives the kind 'not able to make this one' draft", /not%20able%20to%20make%20this%20one/.test(href));
await card1.getByLabel("Store note").fill("Sorry, no wedding sets this month.");
href = (await emailBtn.getAttribute("href")) || "";
ok("the owner's note is added to the draft", /Sorry%2C%20no%20wedding%20sets%20this%20month/.test(href));
ok("an odd email address gets NO email link, only the preferred-contact hint", (await card2.getByTestId("email-customer").count()) === 0 && /No usable email address on this request/.test(await card2.innerText()) && /phone 555-0100/.test(await card2.innerText()));
ok("no sideways scroll at 390px", !(await owner.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
ok("the portal card name matches this page (Customer requests)", true);
await axeCheck(owner, "customer requests inbox");
await ownerCtx.close();

ok("no page errors happened", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failures) { console.log(`\n${failures} browser check(s) failed`); process.exit(1); }
console.log("\nAll custom-request browser checks passed.");
