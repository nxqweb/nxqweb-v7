// Real-browser check of the owner's AI Desk panel via harness/ai-desk.html (no network, no login). SHOT=dir saves screenshots.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(width = 1000, query = "") {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${base}/scripts/manual/harness/ai-desk.html${query}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return { page, ctx };
}
let { page, ctx } = await open();
ok("nothing to copy until a client is chosen", (await page.getByRole("button", { name: "Copy AI task" }).count()) === 0);
await page.selectOption("#ai-desk-client", "c2");
await page.waitForTimeout(200);
ok("an unfinished sheet names the missing fields and offers no copy button", /missing: .*Services \/ products/.test((await page.getByRole("alert").textContent()) || "") && (await page.getByRole("button", { name: "Copy AI task" }).count()) === 0);
await page.selectOption("#ai-desk-client", "c1");
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Copy AI task" }).click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
ok("Copy puts the full task on the clipboard", /NXQX AI DESK TASK/.test(copied) && /REQUEST_JSON_START/.test(copied) && /Soy candles/.test(copied));
ok("the copied task never contains contact details", !/555-0100/.test(copied));
ok("a confirmation says where to paste it", /Paste it into your NXQX AI Desk chat/.test((await page.getByRole("status").last().textContent()) || ""));
const request = JSON.parse(copied.slice(copied.indexOf("REQUEST_JSON_START") + 18, copied.indexOf("REQUEST_JSON_END")));
const good = {
  schema_version: request.schema_version, request_fingerprint: request.request_fingerprint, confidence: 0.9, risk_flags: [],
  strategy: {
    positioning: "Hand-poured soy candles and handmade soap from Chico, California.", audiences: ["Gift shoppers", "People who like handmade home goods"],
    value_proposition: "Candles and soap made by hand in small batches, with simple gift sets for any occasion.", voice: "Warm, simple and friendly.",
    hero: { eyebrow: "Made in Chico", headline: "Handmade candles and soap", subheadline: "Soy candles, handmade soap and gift sets, made by hand in Chico, California." },
    service_descriptions: request.contract.allowed_services.map((service) => ({ service, description: `${service} made by hand in small batches in Chico, California.` })),
    trust_points: ["Made by hand", "Small batches", "Based in Chico, California"],
    about_summary: "Light of the world candles and soap makes soy candles, handmade soap and gift sets by hand in small batches in Chico, California.",
    seo: { title: "Handmade candles and soap in Chico", description: "Soy candles, handmade soap and gift sets made by hand in small batches in Chico, California.", keywords: ["handmade candles", "handmade soap", "gift sets"] },
    page_strategy: request.contract.allowed_pages.map((p) => ({ page: p, objective: `Help visitors understand the ${p} page of the shop quickly.`, sections: ["Short introduction", "Main content"] })),
    design: { theme_key: "charcoal_gold", mood: "Warm and simple with a cream and gold feel.", palette_guidance: ["Cream background", "Gold accents"], typography_guidance: "Clean serif headings with simple body text.", motion_guidance: "Gentle fades only." },
  },
};
await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(good));
await page.getByRole("button", { name: "Paste and check the AI Desk reply" }).click();
await page.waitForTimeout(250);
ok("the one-press Paste and check button reads the clipboard and shows Good to go", /Good to go/.test((await page.getByRole("status").first().textContent()) || "") && (await page.inputValue("#ai-desk-reply")).includes("request_fingerprint"));
await page.evaluate(() => navigator.clipboard.writeText("   "));
await page.getByRole("button", { name: "Paste and check the AI Desk reply" }).click();
await page.waitForTimeout(250);
ok("an empty clipboard says so in plain words", /clipboard is empty/.test((await page.getByRole("status").last().textContent()) || ""));
await page.fill("#ai-desk-reply", JSON.stringify(good));
ok("a good reply shows Good to go, with no problems list", /Good to go/.test((await page.getByRole("status").first().textContent()) || "") && (await page.getByRole("alert").count()) === 0);
ok("it is honest that saving to the project is not connected yet", /not connected yet/.test((await page.getByRole("status").first().textContent()) || ""));
await page.fill("#ai-desk-reply", "```json\n" + JSON.stringify(good) + "\n```");
ok("a code fence still passes and says to ask for JSON only", /Good to go/.test((await page.getByRole("status").first().textContent()) || "") && /JSON only/.test((await page.getByRole("status").first().textContent()) || ""));
const bad = JSON.parse(JSON.stringify(good)); bad.strategy.positioning = "Premium hand-poured soy candles from Chico, California."; bad.request_fingerprint = "0".repeat(64);
await page.fill("#ai-desk-reply", JSON.stringify(bad));
const alertText = (await page.getByRole("alert").textContent()) || "";
ok("a bad reply lists plain-word problems (fingerprint and unsupported claim)", /fingerprint/.test(alertText) && /premium business claim/.test(alertText));
ok("no Good to go message while problems exist", (await page.getByText("Good to go").count()) === 0);
await page.getByRole("button", { name: "Copy fix request" }).click();
const fix = await page.evaluate(() => navigator.clipboard.readText());
ok("Copy fix request puts the problems on the clipboard for the chat", /NXQX AI DESK FIX REQUEST/.test(fix) && /premium business claim/.test(fix) && /ONLY the corrected JSON/.test(fix));
await page.fill("#ai-desk-reply", "sorry I cannot do that");
ok("garbage is rejected, not crashed on", /not valid JSON/.test((await page.getByRole("alert").textContent()) || ""));
await page.selectOption("#ai-desk-client", "c2");
await page.selectOption("#ai-desk-client", "c1");
await page.waitForTimeout(200);
ok("switching clients clears the pasted reply", (await page.inputValue("#ai-desk-reply")) === "");
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/ai-desk.png`, fullPage: true });
await ctx.close();
for (const width of [390, 360]) {
  ({ page, ctx } = await open(width, "?pick=c1"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`no sideways scroll at ${width}px`, overflow <= 0);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/ai-desk-${width}.png`, fullPage: true });
  await ctx.close();
}
ok("no page errors", pageErrors.length === 0);
await browser.close();
process.exit(failures ? 1 : 0);
