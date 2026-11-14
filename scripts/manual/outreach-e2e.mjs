// Scratch end-to-end check of the owner's outreach card page in a real browser (harness, no network). SHOT=dir saves screenshots (screen and print layout).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(width = 1000, reset = true) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${base}/scripts/manual/harness/outreach.html${reset ? "?reset=1" : ""}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return { page, ctx };
}
let { page, ctx } = await open();
ok("empty start: the sheet is not shown yet and print is off", (await page.getByTestId("outreach-sheet").count()) === 0 && (await page.getByRole("button", { name: /Print the sheet/ }).isDisabled()));
await page.fill("#oc-name", "Sam Rivera");
await page.fill("#oc-site", "http://example.com");
ok("an http address is refused in plain words and no sheet appears", /https only/.test((await page.getByTestId("outreach-error").textContent()) || "") && (await page.getByTestId("outreach-sheet").count()) === 0);
await page.fill("#oc-site", "example.com");
await page.fill("#oc-phone", "(555) 010-2000");
ok("a valid card shows six cards with the name, offer, phone and plans address", (await page.getByTestId("outreach-card").count()) === 6 && /Sam Rivera/.test(await page.getByTestId("outreach-card").first().textContent()) && /First month free/.test(await page.getByTestId("outreach-card").first().textContent()) && /\(555\) 010-2000/.test(await page.getByTestId("outreach-card").first().textContent()) && /example\.com\/plans/.test(await page.getByTestId("outreach-card").first().textContent()));
ok("each card has a QR code drawn as SVG, labelled for the plans address", (await page.locator('[data-testid="outreach-card"] svg[role="img"]').count()) === 6 && /example\.com/.test((await page.locator('[data-testid="outreach-card"] svg').first().getAttribute("aria-label")) || ""));
ok("only the first card is exposed to screen readers", (await page.locator('[data-testid="outreach-card"][aria-hidden="true"]').count()) === 5);
await page.fill("#oc-name", "Evil <img src=x onerror=alert(1)>");
ok("markup in the name is refused, never rendered", (await page.locator("img[src='x']").count()) === 0 && /not allowed/.test((await page.getByTestId("outreach-error").textContent()) || ""));
await page.fill("#oc-name", "Sam Rivera");
await page.goto(`${base}/scripts/manual/harness/outreach.html`, { waitUntil: "networkidle" }); // no ?reset: the saved boxes must come back
ok("what was typed is remembered in this browser", (await page.inputValue("#oc-name")) === "Sam Rivera" && (await page.inputValue("#oc-site")) === "example.com");
await page.emulateMedia({ media: "print" });
ok("print layout: the form and header are hidden, the cards are shown", (await page.getByTestId("outreach-form").isHidden()) && (await page.getByTestId("outreach-card").first().isVisible()));
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/outreach-print.png`, fullPage: true });
await page.emulateMedia({ media: "screen" });
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/outreach-screen.png`, fullPage: false });
await ctx.close();
for (const width of [390, 360]) {
  ({ page, ctx } = await open(width, false));
  ok(`no sideways scroll at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ctx.close();
}
if (process.env.AXE) {
  const fs = await import("node:fs");
  ({ page, ctx } = await open(1000, false));
  await page.evaluate(fs.readFileSync(process.env.AXE, "utf8"));
  await page.waitForTimeout(2500);
  const bad = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id));
  ok(`axe: no serious or critical issues${bad.length ? ` (${bad.join(", ")})` : ""}`, bad.length === 0);
  await ctx.close();
}
ok("no page errors during the whole run", pageErrors.length === 0);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll outreach-card browser checks passed.");
process.exit(failures ? 1 : 0);
