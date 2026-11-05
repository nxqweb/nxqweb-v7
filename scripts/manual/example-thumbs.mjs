// Regenerates the screenshots shown on /examples (public/examples/thumbs/<slug>.png) from the built example sites.
// Needs the dev server (or a production build served with serve-dist.mjs) running; BASE_URL defaults to http://127.0.0.1:5199. Output is 640x400, so each file stays small.
import { createRequire } from "node:module";
import fs from "node:fs";
import { exampleSites } from "../../src/lib/exampleSites.ts";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
fs.mkdirSync("public/examples/thumbs", { recursive: true });
for (const site of exampleSites) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5 });
  const page = await ctx.newPage();
  await page.goto(`${base}/examples/${site.slug}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `public/examples/thumbs/${site.slug}.png`, clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log("saved", site.slug);
  await ctx.close();
}
await browser.close();
