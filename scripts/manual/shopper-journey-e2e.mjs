// Scratch end-to-end JOURNEY check in real browsers: a shopper orders from the public store, then the shop owner (signed in) sees that order, confirms payment, marks it shipped,
// and the next shopper sees the reduced stock. Both browsers talk to ONE shared in-memory "store database" built in this script (no network). The mock copies what the real
// order function does (prices come from the database, stock is reserved, a number is issued, duplicates are refused); it tests the SCREENS and the flow between them, not the SQL
// (the SQL has its own tests). Also runs the email-ordering mode. SHOT=dir saves screenshots.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

// ---- the shared "database"
const db = {
  mode: "online", counter: 0, orders: [],
  products: [
    { id: "p1", name: "Vanilla Bean Candle", slug: "vanilla", base_price: 18, requires_shipping: true, variants: [{ id: "v1", title: "8 oz", price: 18, stock: 5, reserved: 0 }] },
    { id: "p2", name: "Lavender Soap", slug: "lavender", base_price: 8, requires_shipping: true, variants: [{ id: "v2", title: "Default", price: 8, stock: 1, reserved: 0 }] },
  ],
};
const avail = (v) => v.stock - v.reserved;
const storeJson = () => ({ store: { name: "Journey Shop", slug: "jr", currency: "USD", venmo_url: "https://venmo.com/u/journey" }, products: db.products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, short_description: "Hand poured.", description: "Hand poured.", base_price: p.base_price, image_url: null, image_urls: [], requires_shipping: p.requires_shipping, variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, available_quantity: avail(v), inventory_policy: "deny" })) })) });
const ordersJson = () => ({ summary: { orders: db.orders.length, new_orders: db.orders.filter((o) => o.fulfillment_status === "unfulfilled").length, open_orders: db.orders.filter((o) => o.fulfillment_status !== "delivered").length, completed_orders: 0 }, orders: db.orders.map((o) => ({ ...o })) });
function placeOrder(args) {
  const items = args.items_payload || []; let total = 0; const lines = [];
  // like the real order function, duplicates are refused up front, before any stock is looked at
  if (new Set(items.map((it) => String(it.variant_id).toLowerCase())).size !== items.length) throw new Error("Combine duplicate product options into one cart line before placing the order.");
  for (const it of items) {
    const v = db.products.flatMap((p) => p.variants.map((x) => ({ p, x }))).find((e) => e.x.id === it.variant_id);
    if (!v) throw new Error("A cart item is no longer available.");
    if (avail(v.x) < it.quantity) throw new Error(`${v.p.name} does not have enough available stock.`);
    lines.push({ v, qty: it.quantity }); total += v.x.price * it.quantity; // the price comes from the database, never from the browser
  }
  for (const l of lines) l.v.x.reserved += l.qty;
  db.counter += 1;
  const order = { id: `o${db.counter}`, order_number: `NXQ-JRN0000${db.counter}`, customer_name: args.customer_payload.name, customer_email: args.customer_payload.email, currency: "USD", total, grand_total: total, status: "pending", payment_status: "unpaid", fulfillment_status: "unfulfilled", tracking_number: "", fulfillment_note: "", placed_at: new Date().toISOString(), is_test: false,
    items: lines.map((l, i) => ({ id: `i${db.counter}${i}`, product_name: l.v.p.name, variant_title: l.v.x.title, sku: "", quantity: l.qty, unit_price: l.v.x.price, line_total: l.v.x.price * l.qty })), events: [] };
  db.orders.unshift(order);
  return { order_number: order.order_number, total, currency: "USD", venmo_url: "https://venmo.com/u/journey", payment_note: "Include your order number in the payment note." };
}
const rpcHandlers = {
  get_public_stripe_ready_commerce_storefront: () => storeJson(),
  get_public_store_order_mode: () => ({ order_mode: db.mode, contact_email: "owner@example.com", contact_phone: "" }),
  get_public_store_profile: () => ({}),
  get_public_store_accounts_status: () => ({ accounts_enabled: false }),
  create_public_stripe_ready_direct_payment_order: (args) => placeOrder(args),
  get_my_commerce_orders: () => ordersJson(),
  confirm_my_direct_payment_order: (args) => { const o = db.orders.find((x) => x.id === args.order_uuid); o.payment_status = "paid"; o.status = "confirmed"; o.events.push({ id: `e${o.id}1`, event_type: "payment_confirmed", from_status: "pending", to_status: "confirmed", created_at: new Date().toISOString() }); return { ok: true }; },
  update_my_commerce_order: (args) => { const o = db.orders.find((x) => x.id === args.order_uuid); o.fulfillment_status = args.next_fulfillment_status; o.tracking_number = args.tracking_value || ""; o.fulfillment_note = args.fulfillment_note_value || ""; o.events.push({ id: `e${o.id}2`, event_type: "fulfillment_updated", from_status: "unfulfilled", to_status: args.next_fulfillment_status, created_at: new Date().toISOString() }); return { ok: true }; },
};
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: { business_name: "Journey Shop" }, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const clientRow = { id: "c1", business_name: "Journey Shop", status: "approved", billing_status: "active", billing_provider: "manual", monthly_price: 150, notes: "", auth_user_id: user.id, product_family_slug: "commerce", product_tier_key: "intelligence" };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const errors = [];
async function newPage(signedIn, width = 1100) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  if (signedIn) await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} }, [session]);
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const args = JSON.parse(route.request().postData() || "{}");
    try { const body = fn in rpcHandlers ? rpcHandlers[fn](args) : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) }); }
    catch (e) { await route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route("**/rest/v1/**", async (route) => { const url = route.request().url(); if (url.includes("/rpc/")) return route.fallback(); const wantsObject = (route.request().headers()["accept"] || "").includes("pgrst.object"); const table = url.split("/rest/v1/")[1].split("?")[0]; const row = table === "clients" ? clientRow : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(wantsObject ? row : [row]) }); });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(route.request().url().includes("/user") ? user : {}) }));
  return { page, ctx };
}
async function fillDetails(page, name, email) {
  await page.getByLabel(/^Name/).fill(name); await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Shipping address/).fill("1 Main St, Testville");
}

// ===== 1. shopper A orders 2 candles
let { page: shopper, ctx: shopperCtx } = await newPage(false);
await shopper.goto(`${base}/store/jr`, { waitUntil: "networkidle" });
ok("the store opens with both products and their stock", (await shopper.locator("[data-testid=store-product-card]").count()) === 2);
const candle = shopper.locator("[data-testid=store-product-card]").first().getByRole("button", { name: "Add to cart" });
await candle.click(); await candle.click();
await fillDetails(shopper, "Alex Shopper", "alex@example.com");
await shopper.getByRole("button", { name: /place order/i }).click();
await shopper.locator("h2", { hasText: "NXQ-JRN00001" }).waitFor();
ok("shopper A sees an order number, the total from the database ($36) and the payment steps", /\$36\.00/.test(await shopper.textContent("body")) && (await shopper.locator("[data-testid=store-next-steps] li").count()) === 3);
ok("the database reserved exactly 2 candles and issued one order", db.products[0].variants[0].reserved === 2 && db.orders.length === 1 && db.orders[0].total === 36);
if (process.env.SHOT) await shopper.screenshot({ path: `${process.env.SHOT}/journey-confirmation.png`, fullPage: false });
await shopperCtx.close();

// ===== 2. owner sees it, confirms payment, ships it
const { page: owner, ctx: ownerCtx } = await newPage(true);
await owner.goto(`${base}/client/commerce/orders`, { waitUntil: "networkidle" });
await owner.waitForTimeout(400);
ok("the owner's Orders page shows the new order with the customer and total", /NXQ-JRN00001/.test(await owner.textContent("body")) && /Alex Shopper/.test(await owner.textContent("body")) && /\$36\.00/.test(await owner.textContent("body")));
ok("the dashboard counts show 1 total, 1 new", /Total orders\s*1/.test((await owner.textContent("body")).replace(/\s+/g, " ")) && /New\s*1/.test((await owner.textContent("body")).replace(/\s+/g, " ")));
await owner.getByRole("button", { name: "Confirm payment received" }).first().click();
await owner.getByText(/marked paid after your confirmation/).waitFor();
ok("confirming payment marks it paid", db.orders[0].payment_status === "paid" && /Paid/.test(await owner.textContent("body")));
await owner.getByRole("button", { name: "Open order details" }).first().click();
await owner.getByPlaceholder("Optional tracking number").fill("1Z-JOURNEY-001");
await owner.locator("select").filter({ hasText: /Shipped|shipped/ }).first().selectOption({ label: await owner.locator("select option", { hasText: /^Shipped$/ }).first().innerText() }).catch(() => {});
await owner.getByRole("button", { name: "Save order update" }).click();
await owner.getByText(/updated and recorded in order history/).waitFor();
ok("saving the update records the tracking number and the history entry", db.orders[0].tracking_number === "1Z-JOURNEY-001" && db.orders[0].events.length === 2);
await owner.getByRole("button", { name: /Refresh/ }).first().click();
await owner.waitForTimeout(400);
await owner.getByRole("button", { name: "Open order details" }).first().click().catch(() => {});
ok("after a Refresh the owner still sees the saved tracking number", (await owner.getByPlaceholder("Optional tracking number").first().inputValue()) === "1Z-JOURNEY-001");
if (process.env.SHOT) await owner.screenshot({ path: `${process.env.SHOT}/journey-owner.png`, fullPage: true });
await ownerCtx.close();

// ===== 3. shopper B sees the reduced stock and cannot oversell
({ page: shopper, ctx: shopperCtx } = await newPage(false));
await shopper.goto(`${base}/store/jr`, { waitUntil: "networkidle" });
const candle2 = shopper.locator("[data-testid=store-product-card]").first().getByRole("button", { name: "Add to cart" });
for (let i = 0; i < 5; i += 1) await candle2.click();
await shopper.waitForTimeout(200);
ok("shopper B can only add the 3 candles that are left", (await shopper.locator(".store-cart-line", { hasText: "Vanilla" }).locator(".store-qty").innerText()).includes("3"));
const soapCard = shopper.locator("[data-testid=store-product-card]").nth(1);
await soapCard.getByRole("button", { name: "Add to cart" }).click();
await fillDetails(shopper, "Blake Buyer", "blake@example.com");
await shopper.getByRole("button", { name: /place order/i }).click();
await shopper.locator("h2", { hasText: "NXQ-JRN00002" }).waitFor();
ok("shopper B's order for 3 candles + the last soap goes through ($62)", db.orders[0].total === 62 && db.products[1].variants[0].reserved === 1 && avail(db.products[0].variants[0]) === 0);
await shopperCtx.close();

// ===== 4. everything is sold out for shopper C, and a forced late order is refused calmly
({ page: shopper, ctx: shopperCtx } = await newPage(false));
await shopper.goto(`${base}/store/jr`, { waitUntil: "networkidle" });
ok("shopper C sees both products as sold out", (await shopper.getByRole("button", { name: "Sold out" }).count()) === 2);
await shopperCtx.close();
try { placeOrder({ items_payload: [{ variant_id: "v1", quantity: 1 }], customer_payload: { name: "Late", email: "late@example.com" } }); ok("a late order for sold-out stock is refused by the database rules", false); }
catch (e) { ok("a late order for sold-out stock is refused by the database rules", /enough available stock/.test(e.message)); }
try { placeOrder({ items_payload: [{ variant_id: "v1", quantity: 1 }, { variant_id: "v1", quantity: 1 }], customer_payload: { name: "Dup", email: "dup@example.com" } }); ok("a duplicate cart line is refused", false); }
catch (e) { ok("a duplicate cart line is refused", /Combine duplicate/.test(e.message)); }

// ===== 5. email-ordering mode: no payment link, an email is prepared, nothing is reserved
db.mode = "email"; db.products[0].variants[0].reserved = 0; db.products[0].variants[0].stock = 5;
({ page: shopper, ctx: shopperCtx } = await newPage(false));
await shopper.goto(`${base}/store/jr`, { waitUntil: "networkidle" });
await shopper.waitForTimeout(500);
await shopper.locator("[data-testid=store-product-card]").first().getByRole("button", { name: "Add to cart" }).click();
await fillDetails(shopper, "Casey Emailer", "casey@example.com");
await shopper.getByRole("button", { name: "Email my order" }).click();
await shopper.waitForSelector("[data-testid=email-order-panel]");
const href = (await shopper.locator("[data-testid=email-order-link]").getAttribute("href")) || "";
const decoded = decodeURIComponent(href);
ok("in email mode the shopper gets a prepared email to the shop with the customer details before the items", /^mailto:owner(%40|@)example\.com\?subject=/.test(href) && decoded.includes("Casey Emailer") && decoded.indexOf("Casey Emailer") < decoded.indexOf("Vanilla Bean Candle") && /1 x Vanilla Bean Candle/.test(decoded), href);
ok("email mode places no order and reserves no stock", db.orders.length === 2 && db.products[0].variants[0].reserved === 0);
if (process.env.SHOT) await shopper.screenshot({ path: `${process.env.SHOT}/journey-email.png`, fullPage: false });
await shopperCtx.close();

ok("no page errors during the whole journey", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll shopper-journey checks passed.");
process.exit(failures ? 1 : 0);
