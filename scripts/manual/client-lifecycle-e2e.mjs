// Real-browser check of Pause / Cancel / free first month (migration 285; mocked Supabase, nothing real is contacted): an open store versus a paused store (products stay visible,
// no cart, no add buttons, no custom-request card, a plain notice) and the owner page at phone width (lists, buttons, a refusal shown as text). Needs the dev server. AXE=path adds axe.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

const product = { id: "p1", name: "Vanilla Bean Candle", slug: "vanilla", status: "active", base_price: 18, image_url: null, short_description: "Hand-poured soy candle", variants: [{ id: "v1", title: "8 oz", price: 18, sku: "VAN-8", on_hand: 10, available_quantity: 10, inventory_policy: "deny" }], image_urls: [] };
let accepting = true;
let overview = {
  needs_take_down: [{ client_id: "c-old", business_name: "Old Cuts Barber", cancelled_at: "2026-10-20T00:00:00Z" }],
  paused: [{ client_id: "c-hol", business_name: "Holiday Candles", paused_reason: "On holiday until Nov 5" }],
  first_month: [{ client_id: "c-new", business_name: "New Glow Co", first_month_days_left: 4 }, { client_id: "c-late", business_name: "Late Bloom", first_month_days_left: -2 }],
};
const calls = [];
let refuse = "";
const rpc = {
  get_public_stripe_ready_commerce_storefront: () => ({ store: { name: "Glow Candle Co", slug: "glow", currency: "USD", venmo_url: "https://venmo.com/u/glow" }, products: [product] }),
  get_public_store_order_mode: () => ({ order_mode: "online" }),
  get_public_store_profile: () => ({}),
  get_public_store_accounts_status: () => ({ accounts_enabled: false }),
  get_public_commerce_request_form: () => ({ enabled: true, store_name: "Glow Candle Co" }),
  get_public_commerce_website_content: () => null,
  get_public_store_status: () => ({ accepting }),
  owner_client_lifecycle_overview: () => overview,
};
const user = { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {} };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const errors = [];
async function open(path, { signedIn = false, width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  if (signedIn) await ctx.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); } catch { /* ignore */ } }, [session]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const args = route.request().postDataJSON?.() || {};
    if (fn.startsWith("owner_") && fn !== "owner_client_lifecycle_overview") calls.push([fn, args]);
    if (fn.startsWith("owner_") && fn !== "owner_client_lifecycle_overview" && refuse) return route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: refuse }) });
    try { const body = fn in rpc ? rpc[fn]() : fn.startsWith("owner_") ? { success: true, message: "Done: " + fn } : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) }); }
    catch (e) { await route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route("**/rest/v1/**", (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/")) return route.fallback();
    if (url.includes("/owner_users")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify([{ id: "o1", auth_user_id: user.id }]) });
    if (url.includes("/clients")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify([{ id: "c-a", business_name: "Alpha Candles" }, { id: "c-b", business_name: "Beta Barber" }]) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" });
  });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: signedIn ? JSON.stringify(user) : "{}" }));
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { page, ctx };
}
async function axeCheck(page, label) {
  if (!axeSource) return;
  await page.waitForTimeout(900); await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => `${x.id}:${x.nodes.length}`));
  ok(`axe: ${label} has no serious or critical issues`, v.length === 0, v.join(","));
}

// ===== an open store: cart, add button and custom-request card are there, no notice
accepting = true;
let { page, ctx } = await open("/store/glow");
ok("open store: add button and custom-request card are shown, no paused notice", (await page.getByRole("button", { name: /add/i }).count()) > 0 && (await page.getByTestId("custom-request-card").count()) === 1 && (await page.getByTestId("store-paused").count()) === 0);
await ctx.close();

// ===== a paused store
accepting = false;
({ page, ctx } = await open("/store/glow"));
const body = await page.locator("body").innerText();
ok("paused store: plain notice, products still visible", (await page.getByTestId("store-paused").innerText()).includes("not taking new orders") && /Vanilla Bean Candle/.test(body));
ok("paused store: no add buttons, no cart, no cart link, no custom-request card", (await page.getByRole("button", { name: /^add/i }).count()) === 0 && (await page.locator("#store-cart").count()) === 0 && (await page.getByTestId("store-cart-bar").count()) === 0 && (await page.getByTestId("custom-request-card").count()) === 0);
ok("paused store: no sideways scroll at 390px", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await axeCheck(page, "paused store");
await ctx.close();

// ===== the owner page
({ page, ctx } = await open("/owner/client-lifecycle", { signedIn: true }));
const text = await page.locator("body").innerText();
ok("owner page: take-down, paused and first-month lists are shown", /Old Cuts Barber/.test(text) && /Holiday Candles/.test(text) && /On holiday until Nov 5/.test(text) && /4 days left of the free month/.test(text) && /Free month ended 2 days ago: time to invoice/.test(text));
ok("owner page: no sideways scroll at 390px", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await axeCheck(page, "owner lifecycle page");
await page.getByRole("button", { name: "I took it down" }).click(); await page.waitForTimeout(300);
await page.getByRole("button", { name: "I started invoicing" }).first().click(); await page.waitForTimeout(300);
await page.getByRole("button", { name: "Resume" }).click(); await page.waitForTimeout(300);
ok("owner page: the three list buttons call the right functions with the right client", calls.some(([f, a]) => f === "owner_mark_site_taken_down" && a.target_client_id === "c-old") && calls.some(([f, a]) => f === "owner_note_first_invoice" && a.target_client_id === "c-new") && calls.some(([f, a]) => f === "owner_resume_client" && a.target_client_id === "c-hol"));
ok("owner page: a success message is shown", /Done: owner_/.test(await page.getByRole("status").first().innerText()));
const pause = page.getByRole("button", { name: "Pause", exact: true });
ok("owner page: Pause and Cancel stay disabled until a client and a note of 8+ characters are chosen", await pause.isDisabled());
await page.getByLabel("Client").selectOption("c-a");
await page.getByLabel(/Reason or note/).fill("short");
ok("owner page: a short note keeps them disabled", await pause.isDisabled());
await page.getByLabel(/Reason or note/).fill("Maker is travelling");
ok("owner page: a chosen client and good note enable them", await pause.isEnabled() && await page.getByRole("button", { name: "Cancel client" }).isEnabled());
calls.length = 0;
await pause.click(); await page.waitForTimeout(300);
ok("owner page: Pause sends the client and the reason", calls.some(([f, a]) => f === "owner_pause_client" && a.target_client_id === "c-a" && a.reason_value === "Maker is travelling"));
await page.getByLabel(/Reason or note/).fill("Asked to cancel by email");
await page.getByRole("button", { name: "Cancel client" }).click(); await page.waitForTimeout(300);
ok("owner page: Cancel sends the note (after a confirm)", calls.some(([f, a]) => f === "owner_cancel_client" && a.note_value === "Asked to cancel by email"));
refuse = "Owner access required.";
await page.getByLabel(/Reason or note/).fill("Another reason here");
await pause.click(); await page.waitForTimeout(400);
ok("owner page: a refusal is shown as readable text", /Owner access required\./.test(await page.getByRole("alert").first().innerText()));
await ctx.close();

ok("no uncaught page errors", errors.length === 0, errors.join(" | "));
await browser.close();
if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
