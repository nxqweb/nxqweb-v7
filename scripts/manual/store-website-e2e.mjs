// Real-browser check of the owner's "Website content" on her PUBLIC store page (mocked Supabase, nothing real is contacted): announcement bar, message, verse, story, hours and pickup,
// contact links, collapsible policies and social links, in light and dark at phone width, plus a shop with NO content (nothing extra appears). Needs the dev server. AXE=path adds axe.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

let content = null;
const filled = {
  announcement: { enabled: true, text: "Free local pickup this week!" },
  homepage_message: { enabled: true, heading: "Welcome to the glow", body: "Small-batch candles and soap, poured with care." },
  verse: { enabled: true, text: "Let your light shine before others.", reference: "Matthew 5:16", message: "Blessings to you!" },
  story: { heading: "Our story", body: "It started at a kitchen table.\nNow we pour for neighbors." },
  contact: { phone: "(555) 123-4567", email: "shop@example.com", business_hours: "Sat 9am to 3pm", pickup_details: "Porch pickup, text first" },
  policies: { shipping: "Ships in 3 business days.", returns: "No returns on candles; contact us if something arrives damaged.", custom_orders: "Ask first: custom jars take about 2 weeks." },
  social: { instagram: "https://www.instagram.com/glow", facebook: "https://facebook.com/glow", tiktok: "javascript:alert(1)", youtube: "https://evil.example.com/x" },
  custom_page: { enabled: false },
};
const profile = { about: "Old about text", contact_email: "old@example.com", contact_phone: "555 000 0000", social_url: "https://instagram.com/old" };
let profileOn = false;
const rpc = {
  get_public_stripe_ready_commerce_storefront: () => ({ store: { name: "Glow Candle Co", slug: "glow", currency: "USD", venmo_url: "https://venmo.com/u/glow" }, products: [] }),
  get_public_store_order_mode: () => ({ order_mode: "online", contact_email: "owner@example.com", contact_phone: "" }),
  get_public_store_profile: () => (profileOn ? profile : {}),
  get_public_store_accounts_status: () => ({ accounts_enabled: false }),
  get_public_commerce_request_form: () => { throw new Error("Customer requests are not enabled for this storefront"); },
  get_public_commerce_website_content: () => content,
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const errors = [];
async function open(scheme = "light", width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    try { const body = fn in rpc ? rpc[fn]() : {}; await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) }); }
    catch (e) { await route.fulfill({ status: 400, contentType: "application/json", headers: cors, body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route("**/rest/v1/**", (route) => route.request().url().includes("/rpc/") ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
  await page.goto(`${base}/store/glow`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { page, ctx };
}
async function axeCheck(page, label) {
  if (!axeSource) return;
  await page.waitForTimeout(900); await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => `${x.id}:${x.nodes.length}`));
  ok(`axe: ${label} has no serious or critical issues`, v.length === 0, v.join(","));
}

// ===== a shop with NO website content: nothing extra appears
content = null;
let { page, ctx } = await open();
ok("with no website content the store shows none of the new sections", (await page.getByTestId("store-announcement").count()) === 0 && (await page.getByTestId("store-message").count()) === 0 && (await page.getByTestId("store-verse").count()) === 0 && (await page.getByTestId("store-website-info").count()) === 0 && /opening soon/i.test(await page.locator("body").innerText()));
await ctx.close();

// ===== a shop with everything filled in (the older About block also has text, to prove it does not repeat)
content = filled; profileOn = true;
for (const scheme of ["light", "dark"]) {
  ({ page, ctx } = await open(scheme));
  const body = await page.locator("body").innerText();
  ok(`${scheme}: announcement bar is first, then the shop name`, (await page.getByTestId("store-announcement").innerText()).includes("Free local pickup") && (await page.locator("main section").first().evaluate((el) => el.firstElementChild?.getAttribute("data-testid"))) === "store-announcement");
  ok(`${scheme}: message and verse are shown`, /Welcome to the glow/.test(body) && /Let your light shine before others/.test(body) && /Matthew 5:16/.test(body) && /Blessings to you/.test(body));
  const info = page.getByTestId("store-website-info");
  ok(`${scheme}: story, hours and pickup are shown`, /It started at a kitchen table/.test(await info.innerText()) && /Sat 9am to 3pm/.test(await info.innerText()) && /Porch pickup, text first/.test(await info.innerText()));
  ok(`${scheme}: email and phone are links`, (await info.getByRole("link", { name: "shop@example.com" }).getAttribute("href")) === "mailto:shop@example.com" && (await info.getByRole("link", { name: "(555) 123-4567" }).getAttribute("href")) === "tel:5551234567");
  ok(`${scheme}: three policies are collapsed sections that open`, (await info.locator("details").count()) === 3 && !(await info.locator("details").first().evaluate((el) => el.open)));
  await info.locator("summary", { hasText: "Shipping" }).click();
  ok(`${scheme}: opening Shipping shows its text`, /Ships in 3 business days/.test(await info.innerText()));
  const social = await info.getByRole("list", { name: "Find us online" }).getByRole("link").evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute("href"), e.getAttribute("rel"), e.getAttribute("target")]));
  ok(`${scheme}: only the real Instagram and Facebook links are shown (fake TikTok and YouTube links are dropped), opened safely`, social.length === 2 && social.every((s) => s[2] === "noopener noreferrer" && s[3] === "_blank") && social.some((s) => s[0] === "Instagram") && social.some((s) => s[0] === "Facebook"));
  ok(`${scheme}: the older About block does not repeat the story or contact (it is hidden here)`, (await page.getByTestId("store-about").count()) === 0 && !/Old about text/.test(await page.locator("body").innerText()));
  ok(`${scheme}: no sideways scroll at 390px`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await axeCheck(page, `${scheme} store with content`);
  await ctx.close();
}
// ===== only part filled in: the older About block still shows what the new content does not cover
content = { ...filled, story: { heading: "", body: "" }, contact: { phone: "", email: "", business_hours: "", pickup_details: "" }, social: {}, announcement: { enabled: false, text: "x" }, homepage_message: { enabled: false }, verse: { enabled: false }, policies: { shipping: "Ships fast.", returns: "", custom_orders: "" } };
({ page, ctx } = await open());
ok("with only a policy filled in, the older About block still shows its own text and contact", (await page.getByTestId("store-website-info").count()) === 1 && (await page.getByTestId("store-about").count()) === 1 && /Old about text/.test(await page.getByTestId("store-about").innerText()) && (await page.getByTestId("store-announcement").count()) === 0);
await ctx.close();

ok("no page errors happened", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
if (failures) { console.log(`\n${failures} browser check(s) failed`); process.exit(1); }
console.log("\nAll store-website browser checks passed.");
