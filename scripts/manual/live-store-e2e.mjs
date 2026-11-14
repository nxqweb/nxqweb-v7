// Scratch end-to-end check of the owner's "Live storefront" and "Orders" pages in a real browser against a mocked Supabase (every network call is intercepted).
// Proves the 2026-10-17 scan fixes: toggling a product or saving the ordering choice must NOT replace a payment link the owner is still typing, must not flash "Loading...",
// and an order's typed tracking number must survive a Refresh.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {}, user_metadata: { business_name: "Light of the world candles and soap" }, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const client = { id: "1d6f34f7", business_name: "Light of the world candles and soap", status: "approved", billing_status: "active", billing_provider: "manual", monthly_price: 150, notes: "", auth_user_id: user.id, product_family_slug: "commerce", product_tier_key: "intelligence" };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(path, rpc) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept()); // the app asks "Make ... visible?" before changing a product
  await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} }, [session]);
  await page.route("**/rest/v1/rpc/**", async (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; const body = route.request().postData(); const out = typeof rpc[fn] === "function" ? rpc[fn](body ? JSON.parse(body) : {}) : (fn in rpc ? rpc[fn] : {}); await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(out) }); });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object"); const table = url.split("/rest/v1/")[1].split("?")[0]; const row = table === "clients" ? client : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wantsObject ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return page;
}

// ===== Live storefront
const products = [{ id: "p1", name: "Vanilla Bean Candle", status: "draft", base_price: 18 }, { id: "p2", name: "Lavender Soap", status: "active", base_price: 8 }];
const settings = () => ({ store_name: "Light of the world", store_slug: "light-abc", status: "active", stripe_payment_link: "", paypal_url: "", venmo_url: "https://venmo.com/u/old", payment_note: "", public_url: "/store/light-abc", products });
let live = await open("/client/commerce/live", {
  get_my_stripe_ready_storefront_settings: () => settings(),
  get_my_store_order_mode: { order_mode: "online", supported_modes: ["online", "email"] },
  get_my_store_profile: { about: "", contact_email: "", contact_phone: "", hours: "" },
  get_public_store_accounts_status: { accounts_enabled: false },
  set_my_commerce_product_live: (args) => { const p = products.find((x) => x.id === args.product_uuid) || products[0]; p.status = args.make_active ? "active" : "draft"; return { ok: true }; },
});
ok("the Live storefront page loads with the store name filled in", (await live.getByLabel("Store name").inputValue()) === "Light of the world");
await live.getByPlaceholder("https://buy.stripe.com/...", { exact: false }).fill("https://buy.stripe.com/test_typed_but_not_saved");
await live.getByLabel("Store name").fill("Typed new name");
await live.getByRole("button", { name: /Make visible/ }).first().click();
await live.getByText(/is now visible on the storefront/).waitFor();
ok("making a product visible keeps the typed Stripe link", (await live.getByPlaceholder("https://buy.stripe.com/...", { exact: false }).inputValue()) === "https://buy.stripe.com/test_typed_but_not_saved");
ok("making a product visible keeps the typed store name", (await live.getByLabel("Store name").inputValue()) === "Typed new name");
ok("the page never collapsed to 'Loading...' (the form is still on screen)", (await live.getByText("Loading...").count()) === 0 && (await live.getByLabel("Store name").count()) === 1);
ok("the product list did refresh from the server", /Hide product/.test(await live.textContent("body")) && (await live.getByRole("button", { name: /Hide product/ }).count()) === 2);
ok("the page stayed scrolled down (a full reload to 'Loading...' would have jumped back to the top)", (await live.evaluate(() => window.scrollY)) > 0);

// ===== Orders: typed tracking survives Refresh
const orderRow = (id, n) => ({ id, order_number: `NXQ-TEST000${n}`, customer_name: `Customer ${n}`, customer_email: `c${n}@example.com`, currency: "USD", subtotal: 10, shipping_total: 0, tax_total: 0, total: 10, grand_total: 10, status: "pending", payment_status: "unpaid", fulfillment_status: "unfulfilled", tracking_number: "", fulfillment_note: "", placed_at: new Date().toISOString(), is_test: false, items: [], events: [] });
const orders = await open("/client/commerce/orders", { get_my_commerce_orders: () => ({ summary: { orders: 2, new_orders: 2, open_orders: 2, completed_orders: 0 }, orders: [orderRow("o1", 1), orderRow("o2", 2)] }) });
await orders.getByRole("button", { name: "Open order details" }).first().click();
const trackingBoxes = orders.getByPlaceholder("Optional tracking number");
const count = await trackingBoxes.count();
if (count > 0) {
  await trackingBoxes.first().fill("1Z-TYPED-TRACKING");
  await orders.getByRole("button", { name: /Refresh/ }).first().click();
  await orders.waitForTimeout(500);
  ok("a tracking number typed on an order survives pressing Refresh", (await orders.getByPlaceholder("Optional tracking number").first().inputValue()) === "1Z-TYPED-TRACKING");
} else {
  ok("the order cards render tracking boxes (could not find them: open the order details first)", false);
}
ok("no page errors during the whole run", pageErrors.length === 0);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll live-store and orders browser checks passed.");
process.exit(failures ? 1 : 0);
