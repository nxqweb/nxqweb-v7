// Scratch accessibility scan (not part of the repo): axe-core on mocked store and client Commerce pages.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axePath = process.argv[2];
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const client = { id: "1d6f34f7", business_name: "Light of the world candles and soap", status: "approved", billing_status: "active", billing_provider: "manual", monthly_price: 150, notes: "", auth_user_id: user.id };
const svg = (c1, c2, label) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><rect width='600' height='600' fill='${c1}'/><text x='300' y='320' font-size='42' text-anchor='middle' fill='${c2}'>${label}</text></svg>`)}`;
const product = { id: "p1", name: "Vanilla Bean Candle", slug: "vanilla", status: "draft", base_price: 18, image_url: svg("#c8a27a", "#ffffff", "Vanilla"), short_description: "Hand-poured soy candle", variants: [{ id: "v1", title: "8 oz", price: 18, sku: "VAN-8", on_hand: 10, available_quantity: 10, inventory_policy: "deny" }], image_urls: [] };
const store = { store: { name: "Light of the World Candles & Soap", slug: "x", currency: "USD", venmo_url: "https://venmo.com/u/example" }, products: [product, { ...product, id: "p2", name: "Lavender Soap Bar", image_url: null, variants: [{ id: "v2", title: "Default", price: 9, available_quantity: 0, inventory_policy: "deny" }] }] };
const rpc = {
  get_public_stripe_ready_commerce_storefront: store,
  get_public_store_accounts_status: { accounts_enabled: true },
  get_public_store_profile: { about: "Small-batch candles and natural soap.", contact_email: "hello@example.com", contact_phone: "(555) 123-4567", social_url: "https://instagram.com/x" },
  ensure_my_commerce_storefront: "sf1",
  get_my_commerce_catalog: { summary: { products: 1, active_products: 0, draft_products: 1, categories: 1, low_stock: 0, variants: 1 }, storefront: { id: "sf1", store_name: "Light", store_slug: "x", status: "active" }, products: [product], categories: [{ id: "c1", name: "Candles", slug: "candles" }], inventory: [] },
  get_my_commerce_intake: { status: "draft", store_name: "Light of the world candles and soap", business_model: "physical_products", inventory_method: "track_inventory", website_transition_mode: "not_selected", fulfillment_methods: [] },
  get_my_stripe_ready_storefront_settings: { store_name: "Light of the world candles and soap", store_slug: "x", status: "active", public_url: "/store/x", stripe_payment_link: "", paypal_url: "", venmo_url: "https://venmo.com/u/example", payment_note: "", products: [{ ...product, status: "active" }] },
  get_my_store_profile: { has_storefront: true, about: "Small-batch candles", contact_email: "", contact_phone: "", social_url: "" },
  get_my_commerce_orders: { summary: { orders: 1, new_orders: 1, open_orders: 1, completed_orders: 0 }, orders: [{ id: "o1", order_number: "NXQ-AB12CD34", customer_name: "Jordan Example", customer_email: "jordan@example.com", currency: "USD", subtotal: 18, total: 18, payment_status: "pending", fulfillment_status: "new", tracking_number: null, fulfillment_note: null, is_test: false, placed_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z", items: [{ id: "i1", name: "Vanilla Bean Candle", variant_title: "8 oz", quantity: 1, unit_price: 18, line_total: 18 }], events: [] }] },
  get_my_commerce_product_images: { image_urls: [] },
};
const pages = JSON.parse(process.argv[3]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
for (const { path, signedIn, width, label } of pages) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 500 });
  const page = await ctx.newPage();
  if (signedIn) await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); } catch {} }, [session]);
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("**/rest/v1/rpc/**", async (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(fn in rpc ? rpc[fn] : {}) }); });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wants = (route.request().headers()["accept"] || "").includes("pgrst.object"); const t = url.split("/rest/v1/")[1].split("?")[0]; const row = t === "clients" ? client : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wants ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(500);
  await page.addScriptTag({ path: axePath });
  const res = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ["violations"] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n")[1]) })); });
  console.log(`\n== ${label || path} @${width}px: ${res.length} violation type(s)`);
  for (const v of res) console.log(`  [${v.impact}] ${v.id} x${v.nodes} - ${v.help}\n      ${v.sample.join("\n      ")}`);
  await ctx.close();
}
await browser.close();
