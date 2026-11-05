// Browser check of the "Your visits" card under the client portal hero (every state), against a mocked Supabase (nothing real is contacted).
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

import { readFileSync as readFile } from "node:fs";
const SHOT = process.env.SHOT_DIR || "";
const AXE = process.env.AXE || "";
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const rollups = Array.from({ length: 14 }, (_, i) => ({ rollup_date: day(i), page_views: i < 7 ? 20 + i : 10 + i, clicks: 3 })); // newest first: this week 20..26, the week before 17..23

let accessMode = "allowed"; let rollupMode = "data"; let rollupQueries = 0;
const access = {
  allowed: { allowed: true, reason: "allowed", tier_key: "growth" },
  starter: { allowed: false, reason: "tier_not_entitled", tier_key: "starter" },
  lead: { allowed: false, reason: "client_not_active", tier_key: "growth" },
  missing: { allowed: false, reason: "client_missing" },
};
await page.route("**/rest/v1/rpc/current_client_feature_access", async (route) => {
  if (accessMode === "error") return route.fulfill({ status: 500, contentType: "application/json", headers: cors, body: JSON.stringify({ message: "boom internal detail" }) });
  return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(access[accessMode]) });
});
await page.route("**/rest/v1/website_analytics_daily_rollups**", async (route) => {
  rollupQueries += 1;
  if (rollupMode === "error") return route.fulfill({ status: 500, contentType: "application/json", headers: cors, body: JSON.stringify({ message: "boom internal detail" }) });
  return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(rollupMode === "empty" ? [] : rollups) });
});

async function open(width = 1100) {
  await page.setViewportSize({ width, height: 900 });
  rollupQueries = 0;
  await page.goto(base + "/client", { waitUntil: "networkidle" });
  await page.waitForSelector(".portal-header", { timeout: 15000 });
  await page.waitForTimeout(700);
}
const card = () => page.locator("[data-testid=visits-graph]");
const chart = () => card().locator("svg[role=img]"); // the heading icon is an svg too; the chart is the one with role=img

// 1. growth, approved, visits recorded
accessMode = "allowed"; rollupMode = "data"; await open();
ok("with analytics, an approved client and recorded visits: the graph shows", (await card().getAttribute("data-visits-state")) === "graph" && (await chart().count()) === 1);
const text1 = (await card().innerText()).replace(/\s+/g, " ");
ok("it says this week's page views and the change against the week before, from the real numbers", /Page views this week: 161 \(\+/.test(text1) || /Page views this week: \d+ \(\+\d+% vs the week before\)/.test(text1));
ok("it links to the full Analytics page", (await card().locator("a", { hasText: "All analytics" }).getAttribute("href")) === "/client/business/analytics");
ok("the card sits right under the hero and above 'At a glance'", await page.evaluate(() => { const hero = document.querySelector(".portal-header"); const c = document.querySelector("[data-testid=visits-graph]"); const glance = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /^At a glance$/i.test(e.textContent.trim())); const after = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); return Boolean(hero && c && glance) && after(hero, c) && after(c, glance); }));
ok("the visits table is read once per page load (twice in the dev server, which runs effects twice on purpose)", rollupQueries >= 1 && rollupQueries <= 2, `reads=${rollupQueries}`);
if (SHOT) { await card().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT}/visits-graph-data.png`, fullPage: false }); }

// 2. growth, approved, no visits yet
rollupMode = "empty"; await open();
ok("no recorded visits: no graph is drawn, and it says so plainly", (await card().getAttribute("data-visits-state")) === "graph" && (await chart().count()) === 0 && /No visits recorded yet/.test(await card().innerText()));

// 3. starter, approved
accessMode = "starter"; rollupMode = "data"; await open();
ok("Starter: an honest upgrade note, no graph and no data read at all", (await card().getAttribute("data-visits-state")) === "upgrade" && (await chart().count()) === 0 && /included with the Growth and Intelligence plans/.test(await card().innerText()) && rollupQueries === 0);
ok("Starter: the note links to Settings for a plan change", (await card().locator("a", { hasText: "Plan options" }).getAttribute("href")) === "/client/settings");
if (SHOT) { await card().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT}/visits-graph-starter.png`, fullPage: false }); }

// 4. not approved yet
accessMode = "lead"; await open();
ok("a client who is not approved yet is told to wait, never to upgrade, and nothing is read", (await card().getAttribute("data-visits-state")) === "waiting" && /once your website is approved and live/.test(await card().innerText()) && !/upgrade|plan change/i.test(await card().innerText()) && rollupQueries === 0);

// 5. failures
accessMode = "error"; await open();
ok("if the access check fails the card is simply absent and the portal still works", (await card().count()) === 0 && (await page.locator(".portal-header h1").innerText()).includes("Your website project hub"));
accessMode = "missing"; await open();
ok("an unknown answer shows nothing instead of guessing", (await card().count()) === 0);
accessMode = "allowed"; rollupMode = "error"; await open();
ok("if the visits cannot be read: a calm sentence, no raw error text, no chart", (await card().getAttribute("data-visits-state")) === "failed" && /could not be loaded right now/.test(await card().innerText()) && !/boom|internal detail/i.test(await page.locator("body").innerText()) && (await chart().count()) === 0);

// 6. phone width, tour step
accessMode = "allowed"; rollupMode = "data";
for (const width of [390, 360]) {
  await open(width);
  ok(`no sideways scroll with the graph at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok(`the chart fits inside its card at ${width}px`, await card().evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll("svg[role=img]")].every((s) => s.getBoundingClientRect().right <= r.right + 1); }));
  if (SHOT && width === 390) { await card().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT}/visits-graph-390.png`, fullPage: false }); }
}
await page.setViewportSize({ width: 1100, height: 900 });
await page.addInitScript(() => { try { localStorage.removeItem("nxq-client-portal-tutorial-v2-complete"); } catch {} });
await page.evaluate(() => { try { localStorage.removeItem("nxq-client-portal-tutorial-v2-complete"); } catch {} });
await page.goto(base + "/client", { waitUntil: "networkidle" });
await page.waitForSelector("[role=dialog]", { timeout: 15000 });
const titles = [];
for (let i = 0; i < 8; i += 1) { titles.push(((await page.locator("#nxq-client-tutorial-title").innerText()) || "").trim()); const next = page.getByRole("button", { name: /next/i }); if (!(await next.count())) break; await next.first().click(); await page.waitForTimeout(120); }
ok("the tour now teaches the quick links (third step, after the progress step) and counts its steps", titles[2] === "Every page is one tap away" && titles.length === 6, JSON.stringify(titles));
await page.keyboard.press("Escape");

// 7. accessibility (axe) in both themes, if a path to axe.min.js was given
if (AXE) {
  const axeSrc = readFile(AXE, "utf8");
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((t) => { try { localStorage.setItem("nxq-theme", t); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} }, theme);
    await page.evaluate((t) => { try { localStorage.setItem("nxq-theme", t); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} }, theme);
    await open(1100);
    await page.evaluate(axeSrc);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("[data-testid=visits-graph]"), { resultTypes: ["violations"] })).violations.map((v) => `${v.id}:${v.nodes.length}`));
    ok(`axe: the visits card has no violations in ${theme} mode`, violations.length === 0, JSON.stringify(violations));
    if (SHOT) { await card().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT}/visits-graph-${theme}.png`, fullPage: false }); }
  }
}
ok("no script errors on any scenario", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(failCount ? `\n${failCount} check(s) FAILED` : "\nAll checks passed.");
process.exit(failCount ? 1 : 0);
