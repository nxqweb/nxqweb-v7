// Scratch end-to-end check of the public Privacy, Terms, About and Contact pages in a real browser, with axe and a phone-width overflow check.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axePath = process.env.AXE || "/tmp/claude-0/-home-user-nxqweb-v7/0595e867-962a-5f01-88e5-a6470ed70833/scratchpad/axe/node_modules/axe-core/axe.min.js";
let failCount = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`); if (!cond) failCount++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500 });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 100)); });
  await page.route("**/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]", headers: { "access-control-allow-origin": "*" } }));
  for (const [path, h1, draft] of [["/privacy", "Privacy Policy", true], ["/terms", "Terms of Service", true], ["/about", "About NXQX-Web", false], ["/contact", "Contact", false]]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    ok(`${width} ${path} shows its own page, not the home page`, (await page.locator("h1").first().innerText()).trim() === h1);
    ok(`${width} ${path} tab title is set`, (await page.title()).startsWith(h1));
    ok(`${width} ${path} draft notice ${draft ? "shown" : "absent"}`, (await page.getByTestId("legal-draft-notice").count()) === (draft ? 1 : 0));
    await page.evaluate((await import("node:fs")).readFileSync(axePath, "utf8")); // evaluate (not an inline script tag) so a production Content-Security-Policy cannot block the scanner
    const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => x.id + ":" + x.nodes.length));
    ok(`${width} ${path} has no accessibility violations`, v.length === 0, v.join(","));
    ok(`${width} ${path} has no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  }
  await page.goto(base + "/contact", { waitUntil: "networkidle" });
  ok(`${width} the contact page has a mail link`, ((await page.getByTestId("contact-email").getAttribute("href")) || "").startsWith("mailto:"));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const links = await page.locator("footer nav[aria-label='Company and legal'] a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  ok(`${width} the home footer links to all four pages`, links.sort().join() === "/about,/contact,/privacy,/terms", links.join());
  await page.locator("footer nav a[href='/privacy']").click();
  await page.waitForLoadState("networkidle");
  ok(`${width} clicking Privacy in the footer opens the privacy page`, new URL(page.url()).pathname === "/privacy");
  await page.goto(base + "/plans", { waitUntil: "networkidle" });
  ok(`${width} the plans footer has the links too`, (await page.locator("footer nav[aria-label='Company and legal'] a").count()) === 4);
  ok(`${width} no page errors happened`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
console.log(failCount ? `\n${failCount} FAILED` : "\nAll browser checks passed");
process.exit(failCount ? 1 : 0);
