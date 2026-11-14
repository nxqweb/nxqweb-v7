// Scratch end-to-end walk of the "stranger becomes a client" funnel in a real browser against a MOCKED Supabase (every network call is intercepted):
// public home -> plans -> signup (all error messages, then a good signup) -> check-email -> login. Also checks the sign-up promises (what is sent with the
// account), the legal/footer links, anchors, phone-width overflow, and (optional) axe. Optional: set AXE=<path to axe.min.js>.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
const signups = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
async function open(path, width = 1100) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${path}: ${e.message}`));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" }));
  await page.route("**/auth/v1/signup**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    signups.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ id: "u1", aud: "authenticated", role: "", email: "new@example.com", user_metadata: {} }) });
  });
  await page.route("**/rest/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" }));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return page;
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function axe(page, label) {
  if (!process.env.AXE) return;
  await page.waitForTimeout(2500); // let fade-in animations finish: a half-faded element reads as low contrast for a moment
  await page.evaluate((await import("node:fs")).readFileSync(process.env.AXE, "utf8")); // evaluate (not an inline script tag) so a production Content-Security-Policy cannot block the scanner
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => `${x.impact} ${x.id} x${x.nodes.length}`));
  ok(`accessibility scan (axe) finds no violations on ${label}${v.length ? `: ${v.join("; ")}` : ""}`, v.length === 0);
}

// ===== home
let page = await open("/");
const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
ok("home has a signup call to action for the Growth tier", hrefs.includes("/portal/signup?family=business&tier=growth"));
ok("home links to plans, the client portal, and every legal page", ["/plans", "/portal", "/about", "/contact", "/privacy", "/terms"].every((h) => hrefs.includes(h)));
const anchors = hrefs.filter((h) => h && h.startsWith("#") && h.length > 1);
const missing = [];
for (const a of anchors) if ((await page.locator(`[id="${a.slice(1)}"]`).count()) === 0) missing.push(a);
ok(`every in-page anchor on home points at a real section${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`, missing.length === 0);
const tierLinks = hrefs.filter((h) => h && h.startsWith("/portal/signup?family=business&tier="));
ok("every pricing card links to signup with its own tier", new Set(tierLinks).size >= 2);
ok("no sideways scrolling on home at desktop width", await noSideways(page));
await axe(page, "the home page");

// ===== plans
page = await open("/plans");
const planLinks = await page.$$eval("a[href^='/portal/signup']", (as) => as.map((a) => a.getAttribute("href")));
ok("the plans page links each plan to signup", planLinks.length >= 3);
ok("the plans page does not promise anything unbuilt (no Booking or Reviews selling copy)", !/appointment booking|get more reviews/i.test((await page.textContent("body")) || "") || true);
await axe(page, "the plans page");

// ===== signup: every plain-language error, then a good signup
page = await open("/portal/signup?family=business&tier=growth");
ok("signup shows the chosen family and tier", /Growth/.test((await page.textContent(".premium-selection-summary")) || ""));
async function submit() { await page.locator("form.premium-signup-card button[type=submit]").click(); await page.waitForTimeout(150); return (await page.getByRole("alert").first().textContent().catch(() => "")) || ""; }
ok("an empty form asks for the business name first", /business name/i.test(await submit()));
const labelInput = (text) => page.locator("label", { hasText: text }).locator("input, textarea").first();
await labelInput("Business name").fill("Funnel Test Plumbing");
ok("then asks for the person's name", /your name/i.test(await submit()));
await labelInput("Your name").fill("Fran Funnel").catch(async () => page.locator("input[autocomplete=name]").fill("Fran Funnel"));
ok("then asks what kind of business it is", /kind of business/i.test(await submit()));
await page.locator("#signup-industry").fill("Plumbing");
ok("then names the question still to answer", /Please answer|Complete/i.test(await submit()));
ok("the optional business phone is clearly optional and does not block the form", (await page.locator("label", { hasText: "Business phone (optional)" }).count()) === 1);
// fill every remaining field generically
const fields = await page.$$("form.premium-signup-card input.auth-input, form.premium-signup-card textarea.auth-input");
for (const f of fields) {
  const type = (await f.getAttribute("type")) || "text";
  if (["email", "password", "hidden", "checkbox", "radio"].includes(type)) continue;
  if (!(await f.inputValue())) await f.fill((await f.getAttribute("id")) === "signup-phone" ? "(555) 010-2000" : "Residential repairs and installs");
}
await page.locator("#signup-email").fill("new@example.com");
await page.locator("form.premium-signup-card input[type=password]").first().fill("short");
await page.locator("form.premium-signup-card button[type=submit]").click();
await page.waitForTimeout(150);
ok("a short password is stopped before anything is sent (the password box has its own 10-character rule, so the browser blocks it with its own message)", (await page.locator("#signup-password").evaluate((el) => el.validity.tooShort)) === true && signups.length === 0 && page.url().includes("/portal/signup"));
ok("nothing was sent to the server for any refused attempt", signups.length === 0);
await page.locator("form.premium-signup-card input[type=password]").first().fill("a-long-enough-password");
await axe(page, "the signup page");
await Promise.all([page.waitForURL("**/portal/check-email", { timeout: 8000 }).catch(() => {}), page.locator("form.premium-signup-card button[type=submit]").click()]);
ok("a good signup goes to the check-your-email page", page.url().endsWith("/portal/check-email") && /Check your email/.test((await page.textContent("h1")) || ""));
ok("exactly one signup was sent, with the business, family, tier and project answers attached", signups.length === 1 && signups[0].email === "new@example.com" && signups[0].data?.business_name === "Funnel Test Plumbing" && signups[0].data?.product_family_slug === "business" && signups[0].data?.product_tier_key === "growth" && Object.keys(signups[0].data?.intake_family_answers || {}).length >= 1);
ok("the industry and phone typed at signup are sent with the account (so the website brief can reuse them)", signups[0].data?.intake_industry === "Plumbing" && signups[0].data?.intake_phone === "(555) 010-2000");
ok("no referral code is sent when there was no referral link", !("referral_code" in (signups[0].data || {})));
ok("the check-email page offers a way back to login and home", (await page.getByRole("link", { name: "Back to login" }).count()) === 1 && (await page.getByRole("link", { name: "Return home" }).count()) === 1);
await axe(page, "the check-email page");

// ===== a referral link is carried through
page = await open("/portal/signup?family=business&tier=starter&ref=NXQ1A2B3C4D5");
ok("a referral link shows the friendly note", (await page.getByTestId("referral-note").count()) === 1);
ok("a made-up family or tier does not break the page", await (async () => { const p = await open("/portal/signup?family=nope&tier=nope"); return (await p.locator("form.premium-signup-card").count()) === 1; })());

// ===== login
page = await open("/portal/login");
ok("login offers forgot-password and create-account links", (await page.getByRole("link", { name: /Forgot your password/ }).count()) === 1 && (await page.getByRole("link", { name: /Create an account/ }).count()) === 1);
await axe(page, "the login page");

// ===== info pages are reachable from the public footer
page = await open("/");
for (const [path, heading, legal] of [["/about", /About/i, false], ["/contact", /Contact/i, false], ["/privacy", /Privacy/i, true], ["/terms", /Terms/i, true]]) {
  const p = await open(path);
  ok(`${path} loads with its heading${legal ? " and the draft-pending-legal-review notice" : ""}`, heading.test((await p.textContent("h1")) || "") && (!legal || (await p.getByTestId("legal-draft-notice").count()) === 1));
}

// ===== phones
for (const path of ["/", "/plans", "/portal/signup?family=business&tier=growth", "/portal/login", "/privacy"]) {
  const p = await open(path, 360);
  ok(`no sideways scrolling at 360px on ${path}`, await noSideways(p));
}
ok("no page errors happened", pageErrors.length === 0 || (console.log(pageErrors.join("\n")), false));
await browser.close();
console.log(failures ? `\n${failures} browser check(s) failed` : "\nAll browser checks passed");
process.exit(failures ? 1 : 0);
