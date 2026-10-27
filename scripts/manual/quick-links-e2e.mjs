// Browser check of the Quick links cards at the bottom of the client portal home and the Commerce pages, against a mocked Supabase (nothing real is contacted).
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
rpc.current_client_message_page = []; rpc.current_client_file_page = []; rpc.current_client_domain_page = [];
let failCount = 0; const sent = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`); if (!cond) failCount++; };
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); } catch {} }, [session]);
let sendFails = false;
await page.addInitScript(() => { try { localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} });
  await page.route("**/rest/v1/rpc/**", async (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; if (fn === "send_client_portal_message") { sent.push(JSON.parse(route.request().postData() || "{}").message_text); if (sendFails) return route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: "boom internal detail" }) }); } await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(fn in rpc ? rpc[fn] : {}) }); });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object"); const table = url.split("/rest/v1/")[1].split("?")[0]; const row = table === "clients" ? client : table === "projects" ? { id: "pr1", client_id: client.id, website_status: "not_started" } : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wantsObject ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.route("**/storage/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));

const SHOT = process.env.SHOT_DIR || "";
const routes = ["/client", "/client/business", "/client/business/leads", "/client/business/changes", "/client/business/analytics", "/client/business/reports", "/client/business/funnel", "/client/business/seo", "/client/business/locations", "/client/health", "/client/domain", "/client/files", "/client/billing", "/client/journey", "/client/history", "/client/reviews", "/client/rewards", "/client/notifications", "/client/security-privacy", "/client/settings", "/client/commerce", "/client/commerce/tutorial", "/client/commerce/products", "/client/commerce/images", "/client/commerce/live", "/client/commerce/orders", "/client/commerce/setup", "/client/commerce/inventory", "/client/commerce/categories", "/client/commerce/catalog", "/client/commerce/preview", "/client/commerce/content", "/client/commerce/requests", "/client/commerce/usage", "/client/commerce/readiness"];

for (const [label, path, testid, expected] of [["portal home", "/client", "quick-links-portal", 23], ["Commerce dashboard", "/client/commerce", "quick-links-commerce", 15], ["Commerce orders", "/client/commerce/orders", "quick-links-commerce", 15]]) {
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForSelector(`[data-testid=${testid}]`, { timeout: 15000 });
    const box = page.locator(`[data-testid=${testid}]`);
    ok(`${label} @${width}: ${expected} cards`, (await box.locator("a.quick-link").count()) === expected);
    ok(`${label} @${width}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok(`${label} @${width}: every card has a name and a plain hint`, await box.locator("a.quick-link").evaluateAll((els) => els.every((e) => e.querySelector("strong")?.textContent.trim() && e.querySelector("small")?.textContent.trim())));
    ok(`${label} @${width}: cards are big enough to tap (>= 44px tall)`, await box.locator("a.quick-link").evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44)));
    ok(`${label} @${width}: the grid sits under the page, not in a second screen-tall box`, await page.evaluate(() => { const f = document.querySelector(".quick-links-footer"); const main = document.querySelectorAll("main").length; return Boolean(f) && main === 1 && f.getBoundingClientRect().height < 2400; }));
    if (path !== "/client/commerce/orders") ok(`${label} @${width}: the current page is marked`, path === "/client" ? true : (await box.locator(`a[aria-current=page]`).count()) === 1);
    if (SHOT) { await box.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT}/${label.replace(/ /g, "-")}-${width}.png`, fullPage: true }); }
  }
}
await page.setViewportSize({ width: 1100, height: 900 });
await page.goto(base + "/client/commerce/live", { waitUntil: "networkidle" });
ok("every Commerce page gets the grid, not just the dashboard (Live store checked)", (await page.locator("[data-testid=quick-links-commerce]").count()) === 1);
await page.goto(base + "/client/business", { waitUntil: "networkidle" });
await page.waitForSelector("text=Business workspace", { timeout: 15000 });
ok("the Business workspace has no quick-link grid (its own buttons are the menu)", (await page.locator(".quick-links-footer").count()) === 0);
await page.goto(base + "/plans", { waitUntil: "networkidle" });
ok("public pages never show it", (await page.locator(".quick-links-footer").count()) === 0);

// Every card must point at a real page: opening each one must stay on that address (unknown /client/... addresses bounce back to /client).
const seen = new Set();
for (const href of routes) {
  await page.goto(base + href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  const stayed = new URL(page.url()).pathname === href;
  if (!stayed) ok(`card address ${href} is a real page`, false, `ended on ${new URL(page.url()).pathname}`); else seen.add(href);
}
ok(`all ${routes.length} card addresses are real pages`, seen.size === routes.length);
ok("no script errors on any page", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(failCount ? `\n${failCount} check(s) FAILED` : "\nAll checks passed.");
process.exit(failCount ? 1 : 0);
