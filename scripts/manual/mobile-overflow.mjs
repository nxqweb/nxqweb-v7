// Scratch mobile check (not part of the repo): mock a signed-in client and look for horizontal overflow at phone width.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const outDir = process.argv[2];
const widths = [390, 360];
const paths = ["/client", "/client/commerce", "/client/commerce/tutorial", "/client/commerce/setup", "/client/commerce/products", "/client/commerce/images", "/client/commerce/live", "/client/commerce/orders", "/client/commerce/readiness", "/client/commerce/inventory", "/client/commerce/catalog", "/client/settings"];
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
const results = [];
for (const width of widths) for (const path of paths) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); } catch {} }, [session]);
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("**/rest/v1/rpc/**", async (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(fn in rpc ? rpc[fn] : {}) }); });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object"); const table = url.split("/rest/v1/")[1].split("?")[0]; const row = table === "clients" ? client : table === "projects" ? { id: "pr1", client_id: client.id, website_status: "not_started" } : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wantsObject ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.route("**/storage/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - vw;
    const wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 2 && getComputedStyle(el).position !== "fixed"; }).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} right=${Math.round(el.getBoundingClientRect().right)}`);
    const small = [...document.querySelectorAll("button, a.wide-btn, a.icon-btn, input, select")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32; }).length;
    return { vw, over, wide, small, h1: (document.querySelector("h1")?.textContent || "").slice(0, 40), redirected: location.pathname };
  });
  results.push({ width, path, ...info });
  if (width === 390) await page.screenshot({ path: `${outDir}/m-${path.replace(/\//g, "_")}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
for (const r of results) console.log(`${r.width} ${r.path.padEnd(28)} ${r.over > 1 ? "OVERFLOW +" + r.over : "ok"} small=${r.small} h1="${r.h1}" ${r.path !== r.redirected ? "REDIRECT->" + r.redirected : ""} ${r.wide.length ? "wide: " + r.wide.join("; ") : ""}`);
