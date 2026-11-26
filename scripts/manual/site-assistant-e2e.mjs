// Real-browser check of the "My assistant" portal page (draft: not routed yet) via harness/site-assistant.html, with an in-memory stand-in for the database.
// Needs the dev server (see scripts/manual/README.md). SHOT=dir saves screenshots. AXE=path/to/axe.min.js adds the accessibility scan.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
const skipAxe = process.env.SKIP_AXE === "1";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
const dialogs = [];
let dismissNext = false;
async function open(width = 1000, query = "") {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); const answer = dismissNext ? dialog.dismiss() : dialog.accept(); dismissNext = false; return answer; });
  await page.goto(`${base}/scripts/manual/harness/site-assistant.html${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  return { page, ctx };
}
const calls = (page) => page.evaluate(() => window.assistantSim.calls);
const notice = async (page) => ((await page.getByTestId("assistant-notice").textContent().catch(() => "")) || "");

// ---------- empty: the first answer
let { page, ctx } = await open();
ok("it says plainly that it is not AI and only says what the business wrote", /not AI/.test((await page.getByTestId("assistant-explainer").textContent()) || "") && /only ever says what you wrote/.test((await page.getByTestId("assistant-explainer").textContent()) || ""));
ok("with no answers, the switch is off and disabled, with a hint", (await page.getByLabel("Turn the assistant on").isDisabled()) && /Add at least one answer below/.test((await page.locator("body").textContent()) || ""));
ok("starter questions are offered", (await page.getByRole("button", { name: "What are your hours?" }).count()) === 1);
await page.getByRole("button", { name: "What are your hours?" }).click();
ok("a starter fills in only the question, never an answer", (await page.inputValue("#assistant-question")) === "What are your hours?" && (await page.inputValue("#assistant-answer")) === "");
await page.getByRole("button", { name: "Save answer" }).click();
ok("saving with no answer is refused with a plain message and nothing is saved", /Write the answer/.test((await page.getByTestId("assistant-problems").textContent()) || "") && !(await calls(page)).some((c) => c.startsWith("entry")));
await page.fill("#assistant-answer", "See <b>our</b> hours");
await page.getByRole("button", { name: "Save answer" }).click();
ok("HTML in an answer is refused", /plain text/.test((await page.getByTestId("assistant-problems").textContent()) || ""));
await page.fill("#assistant-answer", "Call us or see https://example.com");
await page.getByRole("button", { name: "Save answer" }).click();
ok("web links in an answer are refused", /links/.test((await page.getByTestId("assistant-problems").textContent()) || ""));
await page.fill("#assistant-answer", "Monday to Friday, 8am to 5pm.");
await page.fill("#assistant-alts", "When are you open\n\nWhat time do you close");
await page.getByRole("button", { name: "Save answer" }).click();
await page.waitForSelector('[data-testid="assistant-entry"]');
ok("a valid answer is saved, shown in the list with its other wordings, and announced", (await notice(page)) === "Answer added." && /When are you open · What time do you close/.test((await page.getByTestId("assistant-entry").textContent()) || ""));
ok("blank lines in other wordings were dropped before saving", (await page.evaluate(() => window.assistantSim.state.entries[0].altPhrasings.length)) === 2);
ok("now the switch can be used", !(await page.getByLabel("Turn the assistant on").isDisabled()));
await page.getByLabel("Turn the assistant on").check();
await page.waitForFunction(() => /assistant is on/.test(document.body.textContent || ""));
ok("turning it on is saved and confirmed", (await page.evaluate(() => window.assistantSim.state.settings.enabled)) === true);

// try it
await page.fill("#assistant-try-input", "what time do you close");
await page.getByRole("button", { name: "Show me the reply" }).click();
ok("Try it shows exactly the answer a visitor would get", /A visitor would see: Monday to Friday, 8am to 5pm\./.test((await page.getByTestId("assistant-try-result").textContent()) || ""));
await page.fill("#assistant-try-input", "do you fix roofs");
await page.getByRole("button", { name: "Show me the reply" }).click();
const unsure = (await page.getByTestId("assistant-try-result").textContent()) || "";
ok("an unmatched test question shows the not-sure message and says why in plain words", /I am not sure about that\. Please use the contact form/.test(unsure) && /None of your answers matched/.test(unsure));

// settings messages
await page.fill("#assistant-greeting", "Welcome! See https://evil.example");
await page.getByRole("button", { name: "Save these two messages" }).click();
await page.waitForSelector('[data-testid="assistant-error"]');
ok("a web link in the greeting is refused with a plain message", /web links/.test((await page.getByTestId("assistant-error").textContent()) || ""));
await page.fill("#assistant-greeting", "Welcome! Ask us anything.");
await page.fill("#assistant-fallback", "Not sure. Please call us.");
await page.getByRole("button", { name: "Save these two messages" }).click();
await page.waitForFunction(() => window.assistantSim.state.settings.greeting === "Welcome! Ask us anything.");
ok("the greeting and the not-sure message are saved", (await page.evaluate(() => window.assistantSim.state.settings.fallbackText)) === "Not sure. Please call us.");
await page.fill("#assistant-try-input", "do you fix roofs");
await page.getByRole("button", { name: "Show me the reply" }).click();
ok("Try it uses the saved not-sure message", /Not sure\. Please call us\./.test((await page.getByTestId("assistant-try-result").textContent()) || ""));
await ctx.close();

// ---------- full: edit, hide, delete, unanswered
({ page, ctx } = await open(1000, "?state=full"));
ok("existing answers are listed", (await page.getByTestId("assistant-entry").count()) === 2);
await page.getByRole("button", { name: "Add an answer for: what about parking" }).click();
ok("an unanswered question can become an answer (only the question is filled in)", (await page.inputValue("#assistant-question")) === "what about parking" && (await page.inputValue("#assistant-answer")) === "");
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByRole("button", { name: "Dismiss: what about parking" }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-unanswered"]').length === 0);
ok("dismissing removes it", (await calls(page)).includes("dismiss:u1"));
await page.getByRole("button", { name: "Edit answer: Do you remove stumps?" }).click();
await page.fill("#assistant-answer", "Yes. Stump grinding and removal.");
await page.getByRole("button", { name: "Save answer" }).click();
await page.waitForFunction(() => /Answer saved/.test(document.body.textContent || ""));
ok("editing keeps the same answer (no duplicate) and shows the new text", (await page.getByTestId("assistant-entry").count()) === 2 && /Stump grinding and removal/.test((await page.locator("body").textContent()) || ""));
await page.getByRole("button", { name: "Hide answer: Do you remove stumps?" }).click();
await page.waitForFunction(() => /Answer hidden/.test(document.body.textContent || ""));
await page.fill("#assistant-try-input", "do you remove stumps");
await page.getByRole("button", { name: "Show me the reply" }).click();
ok("a hidden answer is not used by Try it", /None of your answers matched/.test((await page.getByTestId("assistant-try-result").textContent()) || ""));
await page.getByRole("button", { name: "Show answer: Do you remove stumps?" }).click();
await page.waitForFunction(() => /Answer shown/.test(document.body.textContent || ""));

// two answers that fit equally well
await page.getByTestId("assistant-add").click();
await page.fill("#assistant-question", "stumps removed?");
await page.fill("#assistant-answer", "A different answer about stumps.");
await page.getByRole("button", { name: "Save answer" }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-entry"]').length === 3);
await page.fill("#assistant-try-input", "do you remove stumps");
await page.getByRole("button", { name: "Show me the reply" }).click();
ok("two answers that fit about equally well: it does not guess, and says how to fix it", /does not guess/.test((await page.getByTestId("assistant-try-result").textContent()) || ""));

// delete asks first: "Cancel" keeps the answer
dismissNext = true;
await page.getByRole("button", { name: "Delete answer: What are your hours?" }).click();
await page.waitForTimeout(200);
ok("deleting asks first, and saying no keeps the answer and deletes nothing", dialogs.some((d) => /Delete the answer to "What are your hours\?"/.test(d)) && (await page.getByTestId("assistant-entry").count()) === 3 && !(await calls(page)).some((c) => c.startsWith("delete:")));
ok("the confirmation messages are announced (they sit in a live region)", await page.evaluate(() => !!document.querySelector('[aria-live="polite"] [data-testid="assistant-notice"]')));

// delete (confirm accepted by the harness); deleting the last enabled answers switches it off
await page.getByLabel("Turn the assistant on").check();
await page.waitForFunction(() => window.assistantSim.state.settings.enabled === true);
for (const name of ["What are your hours?", "Do you remove stumps?", "stumps removed?"]) {
  await page.getByRole("button", { name: `Delete answer: ${name}` }).click();
  await page.waitForFunction((n) => !document.body.textContent.includes(`Delete answer: ${n}`) && !Array.from(document.querySelectorAll("strong")).some((s) => s.textContent === n), name);
}
ok("with every answer deleted the assistant switches itself off and the page shows it", (await page.evaluate(() => window.assistantSim.state.settings.enabled)) === false && !(await page.getByLabel("Turn the assistant on").isChecked()) && (await page.getByLabel("Turn the assistant on").isDisabled()));
await ctx.close();

// ---------- unsaved text is never lost or saved by accident
({ page, ctx } = await open(1000, "?state=full"));
await page.fill("#assistant-greeting", "My typed greeting");
await page.getByRole("button", { name: "Hide answer: What are your hours?" }).click();
await page.waitForFunction(() => /Answer hidden/.test(document.body.textContent || ""));
ok("typing in the greeting box and then doing something else (hide, delete, dismiss) does not wipe the typed text", (await page.inputValue("#assistant-greeting")) === "My typed greeting");
await page.getByRole("button", { name: "Show answer: What are your hours?" }).click();
await page.waitForFunction(() => /Answer shown/.test(document.body.textContent || ""));
await page.getByLabel("Turn the assistant on").check();
await page.waitForFunction(() => window.assistantSim.state.settings.enabled === true);
ok("the on/off switch saves only on/off: the text typed in the two boxes is NOT saved by accident", (await page.evaluate(() => window.assistantSim.state.settings.greeting)) === "" && (await page.inputValue("#assistant-greeting")) === "My typed greeting");
ok("the switch explains what on and off mean without promising the button is live", /once your website team has added the button/.test((await page.locator("body").textContent()) || ""));
await page.fill("#assistant-fallback", "UNSAVED NOT SURE");
await page.fill("#assistant-try-input", "do you fix roofs");
await page.getByRole("button", { name: "Show me the reply" }).click();
ok("Try it uses the SAVED not-sure message, not text still being typed", !/UNSAVED NOT SURE/.test((await page.getByTestId("assistant-try-result").textContent()) || "") && /I am not sure about that/.test((await page.getByTestId("assistant-try-result").textContent()) || ""));
await page.getByRole("button", { name: "Hide answer: Do you remove stumps?" }).click();
await page.waitForFunction(() => /Answer hidden/.test(document.body.textContent || ""));
ok("an old Try it reply disappears when the answers change (it would be out of date)", (await page.getByTestId("assistant-try-result").count()) === 0);
ok("the privacy note is honest ('we try not to') and gives the real limit", /We try not to keep phone numbers/.test((await page.locator("body").textContent()) || "") && /at most 100 questions/.test((await page.locator("body").textContent()) || ""));
await ctx.close();

// ---------- a half-written answer is never thrown away silently; focus goes where the owner is working
({ page, ctx } = await open(1000, "?state=full"));
await page.getByRole("button", { name: "Edit answer: What are your hours?" }).click();
ok("opening the form puts focus in the first field", (await page.evaluate(() => document.activeElement?.id)) === "assistant-question");
await page.fill("#assistant-answer", "Half written");
dismissNext = true;
await page.getByRole("button", { name: "Edit answer: Do you remove stumps?" }).click();
await page.waitForTimeout(150);
ok("opening another answer while one is half written asks first, and saying no keeps the typing", dialogs.some((d) => /Throw away what you have typed/.test(d)) && (await page.inputValue("#assistant-answer")) === "Half written");
await page.getByRole("button", { name: "Edit answer: Do you remove stumps?" }).click();
await page.waitForTimeout(150);
ok("saying yes switches to the other answer", (await page.inputValue("#assistant-question")) === "Do you remove stumps?");
dismissNext = true;
await page.fill("#assistant-answer", "Changed again");
await page.getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(100);
ok("Cancel on a changed form also asks first, and no keeps the form", (await page.locator("#assistant-form, [data-testid=assistant-form]").count()) === 1);
await page.getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(150);
ok("after cancelling, focus returns to the Add an answer button", (await page.locator("[data-testid=assistant-form]").count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "assistant-add");
await page.getByRole("button", { name: "Dismiss: what about parking" }).click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-unanswered"]').length === 0);
await page.waitForTimeout(100);
ok("after dismissing or deleting something, focus lands on the My answers heading instead of falling to the top of the page", (await page.evaluate(() => document.activeElement?.id)) === "assistant-answers-title");
await ctx.close();

// ---------- while saving, the form cannot be edited
({ page, ctx } = await open(1000, "?state=full&slow=save"));
await page.getByRole("button", { name: "Edit answer: What are your hours?" }).click();
await page.getByRole("button", { name: "Save answer" }).click();
await page.waitForTimeout(150);
ok("while a save is running the fields are locked (edits made now would be lost)", await page.locator("#assistant-question").isDisabled() && await page.locator("#assistant-answer").isDisabled());
await page.waitForFunction(() => /Answer saved/.test(document.body.textContent || ""));
await ctx.close();

// ---------- a failed refresh never hides the page
({ page, ctx } = await open(1000, "?state=full&fail=reload"));
await page.getByRole("button", { name: "Hide answer: What are your hours?" }).click();
await page.waitForSelector('[data-testid="assistant-refresh-warning"]');
ok("if the page cannot refresh after a change, everything stays visible with a warning and a Try again button", (await page.getByTestId("assistant-entry").count()) === 2 && /could not be refreshed|could not be loaded/.test(((await page.getByTestId("assistant-notice").textContent()) || "") + ((await page.getByTestId("assistant-refresh-warning").textContent()) || "")) && (await page.getByTestId("assistant-refresh-warning").getByRole("button", { name: "Try again" }).count()) === 1);
await ctx.close();

// ---------- failures and the switched-off account
({ page, ctx } = await open(1000, "?fail=load"));
await page.waitForSelector('[role="alert"]');
ok("if the first load fails, the page says so, offers Try again and shows no editing controls", /could not be loaded/.test((await page.getByRole("alert").first().textContent()) || "") && (await page.getByTestId("assistant-load-error").getByRole("button", { name: "Try again" }).count()) === 1 && (await page.getByTestId("assistant-add").count()) === 0);
await ctx.close();
({ page, ctx } = await open(1000, "?state=full&fail=save"));
await page.getByRole("button", { name: "Edit answer: What are your hours?" }).click();
await page.getByRole("button", { name: "Save answer" }).click();
await page.waitForSelector('[data-testid="assistant-error"]');
ok("if saving fails, a calm message says nothing was changed and the typed text is kept", /Nothing was changed/.test((await page.getByTestId("assistant-error").textContent()) || "") && (await page.inputValue("#assistant-question")) === "What are your hours?");
await ctx.close();
({ page, ctx } = await open(1000, "?gateway=none"));
ok("an account without the assistant just sees that it is not switched on", /not switched on for your account yet/.test((await page.locator("body").textContent()) || "") && (await page.getByTestId("assistant-add").count()) === 0);
await ctx.close();

// ---------- phone sizes and accessibility
if (!axeSource && !skipAxe) ok("the accessibility scan ran (set AXE=path/to/axe.min.js, or SKIP_AXE=1 to skip knowingly)", false);
for (const width of [390, 360]) {
  ({ page, ctx } = await open(width, "?state=full"));
  await page.getByTestId("assistant-add").click();
  ok(`${width}px: nothing scrolls sideways with the form open`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  ok(`${width}px: the main buttons and inputs are at least 44px tall`, await page.locator(".assistant-page button.wide-btn, .assistant-page input.auth-input, .assistant-page .icon-btn").evaluateAll((nodes) => nodes.filter((n) => n.offsetParent !== null).every((n) => n.getBoundingClientRect().height >= 44)));
  if (axeSource && width === 390) {
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => (await window.axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
    ok("no accessibility violations (WCAG A/AA)", result.length === 0, result.join("; "));
  }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/my-assistant-${width}.png`, fullPage: true });
  await ctx.close();
}
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
process.exit(failures ? 1 : 0);
