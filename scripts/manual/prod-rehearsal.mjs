// Deploy-day rehearsal: opens many pages of a PRODUCTION build served with Netlify's real security headers (see serve-dist.mjs) against a MOCKED Supabase, and
// reports anything the browser BLOCKS (Content-Security-Policy violations, refused scripts/styles/images/connections), plus uncaught page errors and pages that
// render nothing. The dev server does not apply these headers, so this finds the class of bug that works in testing and fails on the real site.
// Usage: node scripts/manual/serve-dist.mjs <build folder> 5300 &   then   BASE_URL=http://127.0.0.1:5300 node scripts/manual/prod-rehearsal.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5300";
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "client@example.com", app_metadata: {}, user_metadata: { business_name: "Rehearsal Shop" }, created_at: "2026-10-15T00:00:00Z" };
const session = { access_token: "mock.jwt.token", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const publicRoutes = ["/", "/plans", "/about", "/contact", "/privacy", "/terms", "/portal", "/portal/login", "/portal/signup?family=business&tier=growth", "/portal/signup?family=business&tier=starter&ref=NXQ1A2B3C4D5", "/portal/check-email", "/portal/forgot-password", "/store/rehearsal-shop"];
const clientRoutes = ["/client", "/client/commerce", "/client/commerce/live", "/client/commerce/products", "/client/commerce/orders", "/client/commerce/catalog", "/client/commerce/tutorial", "/client/commerce/preview", "/client/commerce/readiness", "/client/rewards", "/client/reviews", "/client/settings", "/client/files", "/client/billing", "/client/health", "/client/history", "/client/domain", "/client/journey", "/client/notifications", "/client/security-privacy", "/client/business", "/client/business/leads", "/client/business/changes"];
const only = process.env.ONLY; // optional: only routes containing this text
if (only) for (const list of [publicRoutes, clientRoutes]) { const keep = list.filter((r) => r.includes(only)); list.length = 0; list.push(...keep); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
let problems = 0; let pages = 0;
for (const [group, routes, signedIn] of [["public", publicRoutes, false], ["signed-in client", clientRoutes, true]]) {
  for (const route of routes) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    const found = [];
    page.on("pageerror", (e) => found.push(`page error: ${e.message.slice(0, 140)}`));
    page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to|violates the following|blocked by CSP/i.test(t)) found.push(`blocked: ${t.slice(0, 200)}`); });
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} -> ${String(e.blockedURI).slice(0, 80)}`); }); });
    if (signedIn) await page.addInitScript(([s]) => { try { localStorage.setItem("sb-mock-auth-token", JSON.stringify(s)); localStorage.setItem("nxq-client-portal-tutorial-v2-complete", "true"); } catch { /* ignore */ } }, [session]);
    await page.route("**/auth/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(r.request().url().includes("/user") ? user : {}) }));
    await page.route("**/rest/v1/**", async (r) => { if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors }); await r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: r.request().url().includes("/rpc/") ? "null" : "[]" }); });
    await page.goto(base + route, { waitUntil: "networkidle" }).catch((e) => found.push(`did not load: ${e.message.slice(0, 80)}`));
    await page.waitForTimeout(500);
    const csp = await page.evaluate(() => window.__csp || []);
    csp.forEach((c) => found.push(`CSP violation: ${c}`));
    const rendered = await page.evaluate(() => (document.body.innerText || "").trim().length);
    if (rendered < 20 && !/portal\/login/.test(page.url())) found.push("page rendered almost nothing");
    pages += 1;
    if (found.length) { problems += 1; console.log(`FAIL  [${group}] ${route}\n      ${[...new Set(found)].join("\n      ")}`); } else console.log(`PASS  [${group}] ${route}`);
    await ctx.close();
  }
}
await browser.close();
console.log(problems ? `\n${problems} of ${pages} page(s) had problems` : `\nAll ${pages} pages loaded cleanly under the production security headers`);
process.exit(problems ? 1 : 0);
