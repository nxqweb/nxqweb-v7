// Scratch end-to-end check of referral links (signup note, code kept, applied once after sign-in) in a real browser (mocked backend).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {}, user_metadata: { business_name: "Light of the world candles and soap", intake_family_answers: { services: "Candles and soap" } }, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const client = { id: "1d6f34f7", business_name: "Light of the world candles and soap", status: "approved", billing_status: "active", billing_provider: "manual", monthly_price: 150, notes: "", auth_user_id: user.id, product_family_slug: "commerce", product_tier_key: "intelligence" };
const product = { id: "p1", name: "Vanilla Bean Candle", slug: "vanilla", status: "draft", base_price: 18, image_url: null, short_description: "Hand-poured soy candle", variants: [{ id: "v1", title: "8 oz", price: 18, sku: "VAN-8", on_hand: 10, available_quantity: 10 }], image_urls: [] };
const storefront = { id: "sf1", store_name: "Light of the world candles and soap", store_slug: "light-of-the-world-abc", status: "active", payment_mode: "live", settings: { venmo_url: "https://venmo.com/u/example" } };
const rpc = {
  ensure_my_commerce_storefront: "sf1",
  get_my_commerce_catalog: { summary: { products: 1, active_products: 0, draft_products: 1, categories: 1, low_stock: 0, variants: 1 }, storefront, products: [product], categories: [{ id: "c1", name: "Candles", slug: "candles" }], inventory: [] },
  get_my_commerce_intake: { status: "draft", store_name: "Light of the world candles and soap", business_model: "physical_products", inventory_method: "track_inventory", website_transition_mode: "not_selected", fulfillment_methods: [] },
  get_my_stripe_ready_storefront_settings: { store: { name: "Light of the world candles and soap", slug: "light-of-the-world-abc", currency: "USD" }, status: "active", public_url: "/store/light-of-the-world-abc", stripe_payment_link: "", paypal_url: "", venmo_url: "https://venmo.com/u/example", payment_note: "", products: [{ ...product, status: "active" }] },
  get_my_commerce_orders: { summary: { orders: 2, new_orders: 1, open_orders: 2, completed_orders: 0 }, orders: [
    { id: "o1", order_number: "NXQ-AB12CD34", customer_name: "Jordan Example With A Longer Name", customer_email: "jordan.example.long.address@example.com", currency: "USD", subtotal: 18, total: 18, payment_status: "pending", fulfillment_status: "new", tracking_number: null, fulfillment_note: null, is_test: false, placed_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z", items: [{ id: "i1", name: "Vanilla Bean Candle", variant_title: "8 oz", quantity: 1, unit_price: 18, line_total: 18 }], events: [] },
    { id: "o2", order_number: "NXQ-EF56GH78", customer_name: "Sam Test", customer_email: "sam@example.com", currency: "USD", subtotal: 12, total: 12, payment_status: "paid", fulfillment_status: "processing", tracking_number: null, fulfillment_note: null, is_test: false, placed_at: "2026-10-16T13:00:00Z", updated_at: "2026-10-16T13:00:00Z", items: [], events: [] } ] },
  get_my_commerce_product_images: { image_urls: [] },
  get_public_store_accounts_status: { accounts_enabled: false },
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
rpc.current_client_message_page = [];
let failCount = 0; const sent = []; const claims = []; let claimError = null;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`); if (!cond) failCount++; };
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); } catch {} }, [session]);
let sendFails = false;
  await page.route("**/rest/v1/rpc/**", async (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; if (fn === "nxq_claim_referral") { claims.push(JSON.parse(route.request().postData() || "{}").target_referral_code); if (claimError) return route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: claimError }) }); } await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(fn in rpc ? rpc[fn] : {}) }); });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object"); const table = url.split("/rest/v1/")[1].split("?")[0]; const row = table === "clients" ? client : table === "projects" ? { id: "pr1", client_id: client.id, website_status: "not_started" } : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wantsObject ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.route("**/storage/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));

await page.addInitScript(() => { try { localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} });
// 1. the shared link is read at signup
await page.goto(base + "/portal/signup?ref=nxq1a2b3c4d5", { waitUntil: "networkidle" });
ok("the signup page tells the visitor the code is saved", (await page.getByTestId("referral-note").innerText()).includes("NXQ1A2B3C4D5"));
ok("the code is kept in this browser", (await page.evaluate(() => localStorage.getItem("nxq-pending-referral-v1"))) === "NXQ1A2B3C4D5");
await page.goto(base + "/portal/signup?ref=%3Cscript%3E", { waitUntil: "networkidle" });
ok("a bad code shows no note", (await page.getByTestId("referral-note").count()) === 0);
// 2. signed in, program not open yet: kept, then applied once it is
await page.evaluate(() => localStorage.setItem("nxq-pending-referral-v1", "NXQ1A2B3C4D5"));
claimError = "The referral program is not open yet.";
await page.goto(base + "/client", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok("it tries once and keeps the code while the program is closed", claims.length === 1 && claims[0] === "NXQ1A2B3C4D5" && (await page.evaluate(() => localStorage.getItem("nxq-pending-referral-v1"))) === "NXQ1A2B3C4D5");
claimError = null;
await page.goto(base + "/client", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok("once the program is open the code is applied and cleared", claims.length === 2 && (await page.evaluate(() => localStorage.getItem("nxq-pending-referral-v1"))) === null);
await page.goto(base + "/client", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok("it is never applied a second time", claims.length === 2, String(claims.length));
// 3. a code that can never work is dropped
await page.evaluate(() => { localStorage.removeItem("nxq-referral-done-v1-00000000-0000-0000-0000-000000000001"); localStorage.setItem("nxq-pending-referral-v1", "NXQ9Z9Z9Z9Z9"); });
claimError = "Referral code not found.";
await page.goto(base + "/client", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok("an unknown code is tried once and dropped", claims.length === 3 && (await page.evaluate(() => localStorage.getItem("nxq-pending-referral-v1"))) === null);
ok("no page errors happened", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failCount ? `\n${failCount} FAILED` : "\nAll browser checks passed");
process.exit(failCount ? 1 : 0);
