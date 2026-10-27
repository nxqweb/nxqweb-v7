// End-to-end check of /examples and the five example sites in a real browser. Run it against a PRODUCTION build served with scripts/manual/serve-dist.mjs (the dev server answers
// folder URLs with the app's home page, but Netlify serves the real static pages): BASE_URL=http://127.0.0.1:5300 node scripts/manual/examples-e2e.mjs   (AXE=<path to axe.min.js> adds a scan; SHOT=dir saves screenshots)
import { createRequire } from "node:module";
import fs from "node:fs";
import { exampleSites } from "../../src/lib/exampleSites.ts";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5300";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const problems = [];
async function open(url, width = 1100) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${url}: ${e.message}`));
  page.on("console", (m) => { if (/Content Security Policy|Refused to|violates the following/i.test(m.text())) problems.push(`${url}: ${m.text().slice(0, 160)}`); });
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  return { page, ctx };
}
const axeScan = async (page) => { if (!process.env.AXE) return []; await page.evaluate(fs.readFileSync(process.env.AXE, "utf8")); return page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)); };

let { page, ctx } = await open("/examples");
ok("the examples page lists five cards, each with a description and a link to its own folder", (await page.getByTestId("example-card").count()) === 5 && (await page.locator('[data-testid="example-card"] a[href^="/examples/"]').count()) === 5);
ok("the page says the examples are fictional and not client work", /fictional businesses/i.test(await page.textContent("body")) && /not client work/i.test(await page.textContent("body")));
ok("every screenshot loads", (await page.evaluate(async () => { await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); return [...document.images].filter((i) => i.naturalWidth > 0).length; })) >= 5);
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/examples-page.png`, fullPage: true });
let bad = await axeScan(page); ok(`axe on /examples: no serious or critical issues${bad.length ? ` (${bad.join(", ")})` : ""}`, bad.length === 0);
await page.locator('[data-testid="example-card"] a[href="/examples/harbor-pine-cafe/"]').click();
await page.waitForURL(/\/examples\/harbor-pine-cafe\/$/);
ok("clicking a card opens that example's own page", /Harbor & Pine Cafe/.test(await page.title()));
await ctx.close();

for (const site of exampleSites) {
  ({ page, ctx } = await open(`/examples/${site.slug}/`));
  const text = await page.textContent("body");
  ok(`${site.slug}: shows the banner, the business name, six services and a contact area, in its own colour theme`, /Example site\./.test(text) && text.includes(site.name) && (await page.locator(".service-card").count()) === 6 && (await page.locator("#contact").count()) === 1 && (await page.evaluate(() => document.documentElement.dataset.theme)) === site.theme);
  ok(`${site.slug}: the page title is the business and it is hidden from search engines`, (await page.title()).includes(site.name.split(" ")[0]) && (await page.locator('meta[name="robots"]').first().getAttribute("content")) === "noindex, nofollow");
  ok(`${site.slug}: no sideways scroll at 1100px`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  bad = await axeScan(page); ok(`${site.slug}: axe has no serious or critical issues${bad.length ? ` (${bad.join(", ")})` : ""}`, bad.length === 0);
  await ctx.close();
}
({ page, ctx } = await open("/examples/northline-plumbing/", 360));
ok("an example page has no sideways scroll at 360px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/example-mobile.png`, fullPage: false });
await ctx.close();
({ page, ctx } = await open("/examples", 360));
ok("the examples page has no sideways scroll at 360px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await ctx.close();
ok("no page errors and no blocked scripts, styles or images under the production security headers", problems.length === 0, problems.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll examples browser checks passed.");
process.exit(failures ? 1 : 0);
