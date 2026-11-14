// Real-browser check of the AI Desk panel in SERVER mode (harness/ai-desk.html?server=1: in-memory fake of the AI Desk functions, no network).
// The test plays the pipeline through window.deskSim. SHOT=dir saves screenshots.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
const ctx = await browser.newContext({ viewport: { width: 1000, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(`${base}/scripts/manual/harness/ai-desk.html?server=1&pick=c1`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
const text = async () => (await page.locator(".owner-ai-desk").textContent()) || "";
const click = async (name) => { await page.getByRole("button", { name }).click(); await page.waitForTimeout(250); };

ok("nothing prepared yet: plain words, no copy button, a Check again button", /No task yet/.test(await text()) && (await page.getByRole("button", { name: "Copy AI task" }).count()) === 0 && (await page.getByRole("button", { name: "Check again" }).count()) === 1);

await page.evaluate(() => window.deskSim.prepare());
await click("Check again");
ok("once the pipeline prepared the task, Copy AI task appears", (await page.getByRole("button", { name: "Copy AI task" }).count()) === 1);
await click("Copy AI task");
const copied = await page.evaluate(() => navigator.clipboard.readText());
const request = JSON.parse(copied.slice(copied.indexOf("REQUEST_JSON_START") + 18, copied.indexOf("REQUEST_JSON_END")));
ok("the copied task is the SERVER's task (its fingerprint), not a browser guess", request.request_fingerprint === (await page.evaluate(() => window.deskSim.state.request.request_fingerprint)));

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

const bad = JSON.parse(JSON.stringify(good)); bad.strategy.positioning = "Premium hand-poured soy candles from Chico, California.";
await page.fill("#ai-desk-reply", JSON.stringify(bad));
ok("a bad reply can never be saved: problems shown, no Save button", /premium business claim/.test(await text()) && (await page.getByRole("button", { name: "Save to project" }).count()) === 0);

await page.evaluate((t) => navigator.clipboard.writeText(t), JSON.stringify(good));
await click("Paste and check the AI Desk reply");
ok("a good reply shows Save to project", /Good to go/.test(await text()) && (await page.getByRole("button", { name: "Save to project" }).count()) === 1);
ok("no 'not connected yet' message in server mode", !/not connected yet/.test(await text()));

await page.evaluate(() => { window.deskSim.failSave = "No AI Desk task is waiting for this client."; });
await click("Save to project");
ok("a refused save explains itself and the reply stays for another try", /Could not save: No AI Desk task is waiting/.test(await text()) && (await page.inputValue("#ai-desk-reply")).includes("request_fingerprint"));

await page.evaluate(() => { window.deskSim.failSave = ""; });
await click("Save to project");
const savedAnswer = await page.evaluate(() => window.deskSim.saved);
ok("a good save sends exactly the parsed answer for this client", savedAnswer.length === 1 && savedAnswer[0].request_fingerprint === request.request_fingerprint && (await page.evaluate(() => window.deskSim.calls)).includes("save:c1"));
ok("after saving: plain 'saved' message, reply box cleared, no more copy/paste area", /Your answer is saved/.test(await text()) && (await page.getByRole("button", { name: "Copy AI task" }).count()) === 0);

await page.evaluate(() => { window.deskSim.state = { status: "used", request: null, savedAt: null, usedAt: new Date().toISOString(), lastError: null }; });
await click("Check again");
ok("once the pipeline used it: 'Done' wording, nothing left to do", /Done: your answer was used/.test(await text()));

await page.evaluate(() => { window.deskSim.state = { status: "none", request: null, savedAt: null, usedAt: null, lastError: "AI build-plan contains unsupported marketing claims: quality claim." }; });
await page.evaluate(() => window.deskSim.prepare());
await click("Check again");
ok("a pipeline rejection shows its plain reason next to the fresh task to copy", /refused by the pipeline: AI build-plan contains unsupported marketing claims: quality claim/.test(await text()) && (await page.getByRole("button", { name: "Copy AI task" }).count()) === 1);

await page.fill("#ai-desk-reply", "left over text");
await page.selectOption("#ai-desk-client", "c2");
await page.waitForTimeout(250);
ok("switching clients asks the server about that client and clears the reply", (await page.evaluate(() => window.deskSim.calls)).includes("status:c2") && (await page.inputValue("#ai-desk-reply")) === "");
if (process.env.SHOT) { await page.selectOption("#ai-desk-client", "c1"); await page.waitForTimeout(250); await page.screenshot({ path: `${process.env.SHOT}/ai-desk-server.png`, fullPage: true }); }
ok("no page errors", pageErrors.length === 0);
await ctx.close();
await browser.close();
process.exit(failures ? 1 : 0);
