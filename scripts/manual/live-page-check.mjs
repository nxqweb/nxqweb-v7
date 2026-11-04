// READ-ONLY look at one live public page in a real browser, at phone width: what a visitor sees, what failed to load, and a screenshot. It only loads the page (GET requests);
// it never types, clicks, logs in or posts anything. Not part of CI. Use it after a deploy, or whenever a page should be checked without a human with a phone.
//   node scripts/manual/live-page-check.mjs <https://page address> [--out shot.png] [--width 390] [--height 844]
// It prints the page title, the visible text (first 700 characters), every request that failed or answered 4xx/5xx (with the host only), and console errors.
// From the cloud sandbox: the page's host AND any host the page itself calls (the Supabase project the site reads from) must be in the environment's allowed domains, otherwise
// the page loads but its data does not, and the text can be a fallback such as "not open yet". The failed-requests list shows exactly which host was blocked.
import { createRequire } from "node:module";
import fs from "node:fs";

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
if (!url) { console.log("Usage: node scripts/manual/live-page-check.mjs <https://page address> [--out shot.png] [--width 390] [--height 844]"); process.exit(2); }
const out = opt("--out", "");
const width = Number(opt("--width", "390")) || 390;
const height = Number(opt("--height", "844")) || 844;

function loadPlaywright() {
  for (const from of [process.env.PW_FROM, "/node-tools/node_modules/", `${process.cwd()}/`].filter(Boolean)) {
    try { return createRequire(from)("playwright"); } catch { /* try the next place */ }
  }
  throw new Error("Playwright was not found. Set PW_FROM to a folder that has it (see scripts/manual/README.md).");
}
const { chromium } = loadPlaywright();

const hostOf = (value) => { try { return new URL(value).host; } catch { return "(unknown)"; } };
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
try {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems = new Set();
  const consoleErrors = new Set();
  page.on("requestfailed", (request) => problems.add(`${request.failure()?.errorText ?? "failed"}  ${hostOf(request.url())}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.add(`HTTP ${response.status()}  ${hostOf(response.url())}${new URL(response.url()).pathname.slice(0, 40)}`); });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.add(message.text().slice(0, 160)); });
  let navigation = "ok";
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => { navigation = `did not finish loading: ${e.message.slice(0, 100)}`; return null; });
  await page.waitForTimeout(2500);
  if (out) { await page.screenshot({ path: out, fullPage: true }); }
  console.log(`URL:      ${url}`);
  console.log(`STATUS:   ${response ? response.status() : "no response"} (${navigation})`);
  console.log(`TITLE:    ${await page.title()}`);
  console.log(`TEXT:     ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700)}`);
  console.log(`SIDEWAYS: ${await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)} (true means the page scrolls sideways at ${width}px)`);
  console.log(`FAILED REQUESTS (${problems.size}): ${problems.size ? "\n  " + [...problems].slice(0, 12).join("\n  ") : "none"}`);
  console.log(`CONSOLE ERRORS (${consoleErrors.size}): ${consoleErrors.size ? "\n  " + [...consoleErrors].slice(0, 6).join("\n  ") : "none"}`);
  if (out) console.log(`SCREENSHOT: ${out} (${fs.existsSync(out) ? "saved" : "not saved"})`);
} finally {
  await browser.close();
}
