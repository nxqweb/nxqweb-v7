// Real-browser check of the DRAFT website Q&A widget (docs/drafts/site/assistant.js) via harness/assistant.html. No network, no login, fake answer function.
// Needs the dev server (see scripts/manual/README.md). SHOT=dir saves screenshots. AXE=path/to/axe.min.js adds the accessibility scan.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(width = 1000, query = "") {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${base}/scripts/manual/harness/assistant.html${query}`, { waitUntil: "networkidle" });
  return { page, ctx };
}
const ask = async (page, text) => { await page.fill("#nxq-ask-input", text); await page.keyboard.press("Enter"); };
const botText = async (page) => (await page.locator(".nxq-ask-msg.bot").allTextContents()).join(" | ");

let { page, ctx } = await open();
ok("only a small button shows until the visitor asks for it", (await page.locator(".nxq-ask-launch").isVisible()) && !(await page.locator("#nxq-ask-panel").isVisible()));
ok("the button says what it is and tells assistive tech it controls the panel", (await page.locator(".nxq-ask-launch").getAttribute("aria-controls")) === "nxq-ask-panel" && (await page.locator(".nxq-ask-launch").getAttribute("aria-expanded")) === "false");
await page.locator(".nxq-ask-launch").click();
await page.waitForSelector(".nxq-ask-msg.bot");
ok("opening shows the business's own greeting (fetched once, when first opened)", /Hello! Ask about hours/.test(await botText(page)) && page.url().includes("assistant.html"));
ok("opening moves focus into the question box and marks the button expanded", (await page.evaluate(() => document.activeElement?.id)) === "nxq-ask-input" && (await page.locator(".nxq-ask-launch").getAttribute("aria-expanded")) === "true");
ok("the panel is a labelled dialog with a live conversation log", (await page.locator("#nxq-ask-panel").getAttribute("role")) === "dialog" && (await page.locator(".nxq-ask-log").getAttribute("aria-live")) === "polite" && (await page.locator("label[for=nxq-ask-input]").count()) === 1);

await ask(page, "What are your hours?");
await page.waitForFunction(() => /Monday to Friday/.test(document.body.textContent || ""));
ok("a matched question shows the business's answer", /We are open Monday to Friday, 8am to 5pm\./.test(await botText(page)));
const asked = await page.evaluate(() => window.__asked);
ok("the request carries only the form key, the action, the question and the empty bot-trap field, and sends no cookies", asked.at(-1).body.form_key === "FORM-test" && asked.at(-1).body.action === "ask" && asked.at(-1).body.question === "What are your hours?" && asked.at(-1).body.company_website === "" && asked.at(-1).init.credentials === "omit" && asked.at(-1).init.method === "POST");
ok("the box is cleared and focus stays in it, ready for the next question", (await page.inputValue("#nxq-ask-input")) === "" && (await page.evaluate(() => document.activeElement?.id)) === "nxq-ask-input");

await ask(page, "Do you do gutters?");
await page.waitForSelector(".nxq-ask-contact");
ok("an unmatched question says it is not sure and offers the contact form", /not sure about that/.test(await botText(page)) && (await page.locator(".nxq-ask-contact").last().getAttribute("href")) === "#contact");

await ask(page, "show html please");
await page.waitForFunction(() => /bold/.test(document.body.textContent || ""));
ok("an answer is shown as plain text: markup in it never runs and never becomes elements", (await page.evaluate(() => window.__pwned)) === undefined && (await page.locator(".nxq-ask-log img, .nxq-ask-log b").count()) === 0 && /<img src=x/.test(await botText(page)));

await ask(page, "limit test");
await page.waitForFunction(() => /a lot of questions/.test(document.body.textContent || ""));
ok("a rate-limit reply is friendly and offers the contact form", (await page.locator(".nxq-ask-contact").count()) >= 2);
await ask(page, "network down");
await page.waitForFunction(() => /not available right now/.test(document.body.textContent || ""));
ok("a network failure is a friendly message, not an error screen", /not available right now/.test(await botText(page)));
await ask(page, "broken reply");
await page.waitForFunction(() => document.querySelectorAll(".nxq-ask-msg.bot").length >= 7);
ok("a reply that is not JSON is also handled", /not available right now/.test(await botText(page)));

// double submit while a slow answer is pending: exactly one request (the button is disabled AND the form itself refuses a second submit)
const before = (await page.evaluate(() => window.__asked)).length;
await page.fill("#nxq-ask-input", "slow hours");
await page.keyboard.press("Enter");
await page.waitForTimeout(100);
ok("while waiting, the Ask button is disabled", await page.locator(".nxq-ask-form button[type=submit]").isDisabled());
await page.evaluate(() => { const form = document.querySelector(".nxq-ask-form"); document.querySelector("#nxq-ask-input").value = "second slow hours"; form.requestSubmit(); form.requestSubmit(); });
await page.waitForTimeout(150);
ok("even a forced second submit while waiting sends nothing", (await page.evaluate(() => window.__asked)).length === before + 1);
await page.waitForFunction(() => !document.querySelector('.nxq-ask-msg[aria-busy="true"]'));

// a bot filling the hidden field: the value is passed to the server, which treats it as spam
await page.evaluate(() => { document.querySelector('input[name="company_website"]').value = "http://spam.example"; });
await ask(page, "what about parking");
await page.waitForFunction(() => window.__asked.at(-1).body.question === "what about parking");
ok("a filled-in bot-trap field is sent to the server (which ignores such a request)", (await page.evaluate(() => window.__asked.at(-1).body.company_website)) === "http://spam.example");
await page.evaluate(() => { document.querySelector('input[name="company_website"]').value = ""; });
await page.waitForFunction(() => !document.querySelector('.nxq-ask-msg[aria-busy="true"]'));

ok("the contact link closes the panel and reaches the contact section", await (async () => { await page.locator(".nxq-ask-contact").first().click(); await page.waitForTimeout(150); return !(await page.locator("#nxq-ask-panel").isVisible()) && page.url().endsWith("#contact"); })());

await page.locator(".nxq-ask-launch").click();
await page.keyboard.press("Escape");
ok("Escape closes the panel and returns focus to the button", !(await page.locator("#nxq-ask-panel").isVisible()) && (await page.evaluate(() => document.activeElement?.className)).includes("nxq-ask-launch"));
await page.locator(".nxq-ask-launch").click();
ok("reopening keeps the conversation and does not greet again", (await page.locator(".nxq-ask-msg.bot").filter({ hasText: "Hello! Ask about hours" }).count()) === 1);
ok("the page itself is untouched: no sideways scroll", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/assistant-desktop.png` });
await ctx.close();

// greeting falls back when the config call fails
({ page, ctx } = await open(1000, "?config=fail"));
await page.locator(".nxq-ask-launch").click();
await page.waitForSelector(".nxq-ask-msg.bot");
ok("if the greeting cannot be fetched, the built-in greeting is used", /Hi there/.test(await botText(page)));
await ctx.close();

// phone sizes, both colour modes, accessibility scan
for (const mode of ["dark", "light"]) {
  for (const width of [390, 360]) {
    ({ page, ctx } = await open(width, `?mode=${mode}`));
    await page.locator(".nxq-ask-launch").click();
    await page.waitForSelector(".nxq-ask-msg.bot");
    await ask(page, "What are your hours?");
    await page.waitForFunction(() => /Monday to Friday/.test(document.body.textContent || ""));
    const box = await page.locator("#nxq-ask-panel").boundingBox();
    ok(`${mode} ${width}px: the panel fits the screen and nothing scrolls sideways`, box.x >= 0 && box.x + box.width <= width && (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    ok(`${mode} ${width}px: the buttons are at least 44px tall`, (await page.locator(".nxq-ask-launch, .nxq-ask-close, .nxq-ask-form button, .nxq-ask-form input[type=text]").evaluateAll((nodes) => nodes.filter((n) => n.offsetParent !== null).every((n) => n.getBoundingClientRect().height >= 44))));
    if (axeSource && width === 390) {
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(async () => (await window.axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
      ok(`${mode}: no accessibility violations (WCAG A/AA)`, result.length === 0, result.join("; "));
    }
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/assistant-${mode}-${width}.png` });
    await ctx.close();
  }
}
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
process.exit(failures ? 1 : 0);
