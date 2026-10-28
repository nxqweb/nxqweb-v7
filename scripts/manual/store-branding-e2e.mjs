// Real-browser check of a shop with its own look (Light of the World): logo, serif heading, brand colors, and a normal shop keeps the default. Mocked Supabase. SHOT=dir saves screenshots. AXE=path adds axe.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const product = (id, name, price) => ({ id, name, slug: id, status: "active", base_price: price, image_url: null, short_description: "Hand-poured with all-natural wax", variants: [{ id: id + "v", title: "Default", price, available_quantity: 5, inventory_policy: "deny" }], image_urls: [] });
const rpc = (name) => ({
  get_public_stripe_ready_commerce_storefront: () => ({ store: { name, slug: "x", currency: "USD", venmo_url: "https://venmo.com/u/x" }, products: [product("rose", "Rose Petal Candle", 24), product("pumpkin", "Pumpkin Patch Bowl", 32)] }),
  get_public_store_order_mode: () => ({ order_mode: "online" }), get_public_store_profile: () => ({}), get_public_store_accounts_status: () => ({ accounts_enabled: false }),
  get_public_commerce_request_form: () => ({ enabled: true }), get_public_commerce_website_content: () => null, get_public_store_status: () => ({ accepting: true }),
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
async function open(slug, name, scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage(); const handlers = rpc(name);
  await page.route("**/rest/v1/rpc/**", (route) => { const fn = route.request().url().split("/rpc/")[1].split("?")[0]; route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(fn in handlers ? handlers[fn]() : {}) }); });
  await page.route("**/rest/v1/**", (route) => route.request().url().includes("/rpc/") ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
  await page.goto(`${base}/store/${slug}`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
  return { page, ctx };
}
async function axeCheck(page, label) {
  if (!axeSource) return; await page.waitForTimeout(900); await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => `${x.id}:${x.nodes.length}`));
  ok(`axe: ${label} has no serious or critical issues`, v.length === 0, v.join(","));
}
let { page, ctx } = await open("light-of-the-world-abc", "Light of the World Candles and Soap");
ok("branded shop: logo shows and loads", await page.locator("img.store-logo").evaluate((el) => el.complete && el.naturalWidth > 0));
ok("branded shop: navy text and rose accent are applied", (await page.locator("main.store-theme").evaluate((el) => getComputedStyle(el).getPropertyValue("--store-ink").trim())) === "#1d2f4f" && (await page.locator("main.store-theme").evaluate((el) => getComputedStyle(el).getPropertyValue("--store-accent").trim())) === "#a8284f");
ok("branded shop: heading is a serif font", /Georgia|Times/.test(await page.locator("h1").evaluate((el) => getComputedStyle(el).fontFamily)));
ok("branded shop: no sideways scroll at 390px", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/branded.png`, fullPage: false });
await axeCheck(page, "branded shop");
await ctx.close();
({ page, ctx } = await open("light-of-the-world-abc", "Light of the World Candles and Soap", "dark"));
await axeCheck(page, "branded shop (dark scheme)");
await ctx.close();
({ page, ctx } = await open("some-other-shop", "Some Other Shop"));
ok("a normal shop keeps the default look: no logo, no branded marker", (await page.locator("img.store-logo").count()) === 0 && (await page.locator("main[data-branded]").count()) === 0 && (await page.locator("main.store-theme").evaluate((el) => getComputedStyle(el).getPropertyValue("--store-accent").trim())) === "#8a5a3c");
await ctx.close(); await browser.close();
if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
