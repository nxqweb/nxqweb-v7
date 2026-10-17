// Scratch end-to-end check of the REAL /client/reviews route (not the harness) against a MOCKED Supabase: signed-out redirect, signed-in load, the exact
// database call names and argument names, saving, the card, the portal link. Optional: AXE=<path to axe.min.js>.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const errors = [];
async function open(path, signedIn) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  const calls = [];
  let stored = { has_settings: false, review_url: null, business_name: null };
  page.on("pageerror", (e) => errors.push(e.message));
  if (signedIn) await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch {} }, [session]);
  await page.route("**/auth/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(r.request().url().includes("/user") ? user : {}) }));
  await page.route("**/rest/v1/rpc/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
    calls.push({ fn, body });
    let out = null;
    if (fn === "get_my_review_settings") out = stored;
    if (fn === "save_my_review_settings") { stored = body.review_url_value ? { has_settings: true, review_url: body.review_url_value, business_name: body.business_name_value } : { has_settings: false, review_url: null, business_name: null }; out = stored; }
    await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(out) });
  });
  await page.route("**/rest/v1/**", (route) => (route.request().url().includes("/rpc/") ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" })));
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(500);
  return { page, calls };
}
let { page } = await open("/client/reviews", false);
ok("signed out: the route sends the visitor to the login page", page.url().includes("/portal/login"));
let calls;
({ page, calls } = await open("/client/reviews", true));
ok("signed in: the Reviews page loads with the form and no card yet", (await page.getByTestId("reviews-form").count()) === 1 && (await page.getByTestId("review-card").count()) === 0);
ok("it asked the database for the saved settings with the real function name", calls.some((c) => c.fn === "get_my_review_settings"));
await page.getByLabel("Review link").fill("https://g.page/r/CabcDEF/review");
await page.getByLabel("Business name on the card (optional)").fill("Light of the World Candles");
await page.getByRole("button", { name: /Save and make my card/ }).click();
await page.getByTestId("review-card").waitFor();
const save = calls.find((c) => c.fn === "save_my_review_settings");
ok("saving calls save_my_review_settings with the exact argument names the SQL defines", save && save.body.review_url_value === "https://g.page/r/CabcDEF/review" && save.body.business_name_value === "Light of the World Candles" && Object.keys(save.body).sort().join(",") === "business_name_value,review_url_value");
ok("the card shows the business name and a labelled QR code", /Light of the World Candles/.test((await page.getByTestId("review-card").textContent()) || "") && (await page.getByTestId("review-qr").getAttribute("aria-label")) !== null);
if (process.env.AXE) { await page.waitForTimeout(1500); await page.addScriptTag({ path: process.env.AXE }); const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => `${x.impact} ${x.id}`)); ok(`accessibility scan finds no violations${v.length ? `: ${v.join("; ")}` : ""}`, v.length === 0); }
({ page } = await open("/client", true));
ok("the client portal has a Get reviews link to the page", (await page.getByRole("link", { name: "Get reviews" }).count()) === 1 && (await page.getByRole("link", { name: "Get reviews" }).getAttribute("href")) === "/client/reviews");
ok("no page errors happened", errors.length === 0 || (console.log(errors.join("\n")), false));
await browser.close();
console.log(failures ? `\n${failures} browser check(s) failed` : "\nAll browser checks passed");
process.exit(failures ? 1 : 0);
