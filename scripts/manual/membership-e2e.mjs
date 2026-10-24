// Scratch end-to-end check of the Members page in a real browser (in-memory database via scripts/manual/harness/membership.html; no network at all).
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const url = (q = "") => `${base}/scripts/manual/harness/membership.html${q}`;
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(q = "", width = 900) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(url(q), { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  return page;
}
const text = async (page) => (await page.textContent("body")) || "";
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

let page = await open("?gw=none");
ok("not connected: calm 'not open yet' message and no forms", (await page.getByTestId("membership-unavailable").count()) === 1 && (await page.locator("#mem-email").count()) === 0);

page = await open("?reset=1");
ok("empty start: invites a first tier and says to add a tier before members", /No tiers yet/.test(await text(page)) && (await page.getByTestId("membership-needs-tier").count()) === 1);
ok("the Add member button is off until a tier exists", await page.getByRole("button", { name: "Add member" }).isDisabled());
ok("page says nothing is charged and shows no locked-products idea", /Nothing here charges anyone/.test(await text(page)) && !/members-only|locked/i.test(await text(page)));
await page.getByRole("button", { name: "Add tier" }).click();
ok("a blank tier name is refused in plain words", /Give the tier a name/.test((await page.getByRole("alert").textContent()) || ""));
await page.fill("#tier-name", "Candle Club");
await page.fill("#tier-perks", "Early access");
await page.getByRole("button", { name: "Add tier" }).click();
await page.getByText("Tier added.").waitFor();
ok("a tier is added and the form clears", (await page.inputValue("#tier-name")) === "" && /Candle Club/.test(await text(page)));
await page.fill("#tier-name", "candle club");
await page.getByRole("button", { name: "Add tier" }).click();
await page.getByText("already have a tier with that name").waitFor();
ok("a duplicate tier name (any capitals) gets a plain refusal", true);

await page.fill("#mem-email", "not-an-email");
await page.getByRole("button", { name: "Add member" }).click();
ok("a bad email is refused before anything is sent", /valid email/.test((await page.getByRole("alert").textContent()) || "") && (await page.evaluate(() => (window.__members || []).length)) === 0);
await page.fill("#mem-email", "  Mia@Example.com ");
await page.selectOption("#mem-tier", { index: 1 });
await page.fill("#mem-name", "Mia Rivera");
await page.fill("#mem-renews", new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
await page.getByRole("button", { name: "Add member" }).click();
await page.getByText("Member added.").waitFor();
const sent = await page.evaluate(() => window.__members[0]);
ok("the email is lowercased and trimmed before sending", sent.email === "mia@example.com");
ok("the new member shows tier and a plain renewal label", /Mia Rivera/.test(await text(page)) && /Renews in 3 days|Renews in 2 days|Renews in 4 days/.test(await text(page)));
ok("'due soon' note appears for a renewal within 2 weeks", (await page.getByTestId("membership-due").count()) === 1);
await page.fill("#mem-email", "mia@example.com");
await page.selectOption("#mem-tier", { index: 1 });
await page.getByRole("button", { name: "Add member" }).click();
await page.getByText("already a member").waitFor();
ok("adding the same email twice gets a plain refusal", true);

page = await open("?seed=1&reset=1");
ok("seeded: 3 members, 2 active, 2 tiers in the summary", (await page.getByTestId("membership-member").count()) === 3 && /2\s*active members/.test(await text(page)) && /2\s*tiers/.test(await text(page)));
ok("the due-soon line names Mia (5 days) and not the 40-day or ended members", /Mia Rivera/.test((await page.getByTestId("membership-due").textContent()) || "") && !/old@example/.test((await page.getByTestId("membership-due").textContent()) || ""));
ok("a member without a name shows their email; an ended member shows 'Ended'", /sam@example\.com/.test(await text(page)) && /Ended/.test(await text(page)));
await page.selectOption("#mem-filter", "ended");
ok("the filter shows only ended members", (await page.getByTestId("membership-member").count()) === 1);
await page.selectOption("#mem-filter", "");
await page.fill("#mem-search", "SAM");
ok("search finds by email ignoring capitals", (await page.getByTestId("membership-member").count()) === 1);
await page.fill("#mem-search", "zzz");
ok("a search with no match says so", /No members match/.test(await text(page)));
await page.fill("#mem-search", "");

const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download list (CSV)" }).click()]);
const csvText = (await import("node:fs")).readFileSync(await download.path(), "utf8");
ok("the CSV downloads with today's date in its name and every member as a row", /^members-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()) && csvText.split("\r\n").length === 5 && /"Candle Club"/.test(csvText) && /"mia@example.com"/.test(csvText));
await page.getByTestId("membership-member").first().getByRole("button", { name: "Edit" }).click();
ok("edit fills the form and moves the cursor to the email box", (await page.inputValue("#mem-email")) === "mia@example.com" && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "mem-email");
await page.selectOption("#mem-status", "paused");
await page.getByRole("button", { name: "Save member" }).click();
await page.getByText("Member saved.").waitFor();
ok("saving an edit updates the row and clears the form", /Paused/.test(await text(page)) && (await page.inputValue("#mem-email")) === "");
await page.getByTestId("membership-member").nth(1).getByRole("button", { name: "Remove" }).click();
await page.getByText("Member removed.").waitFor();
ok("removing a member (after the confirm) takes them off the list", (await page.getByTestId("membership-member").count()) === 2);

await page.getByRole("button", { name: "Pause tier" }).first().click();
await page.getByText("Tier paused").waitFor();
ok("pausing a tier is possible and labelled", /paused/.test(await text(page)));
const options = await page.locator("#mem-tier option").allTextContents();
ok("a paused tier is not offered for new members", !options.some((t) => /Candle Club/.test(t)) );

page = await open("?seed=1&reset=1&gw=fail");
await page.fill("#mem-email", "new@example.com");
await page.selectOption("#mem-tier", { index: 1 });
await page.getByRole("button", { name: "Add member" }).click();
await page.getByRole("alert").waitFor();
const failText = (await page.getByRole("alert").textContent()) || "";
ok("a failing database shows a calm message and never raw database text", /could not save that/i.test(failText) && !/constraint|pkey|duplicate key/.test(failText));
ok("the typed text stays after a failure", (await page.inputValue("#mem-email")) === "new@example.com");

for (const width of [390, 360]) {
  page = await open("?seed=1&reset=1", width);
  ok(`no sideways scroll at ${width}px`, await noSideways(page));
}
if (process.env.AXE) {
  const fs = await import("node:fs");
  page = await open("?seed=1&reset=1");
  await page.evaluate(fs.readFileSync(process.env.AXE, "utf8"));
  await page.waitForTimeout(2500);
  const bad = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id));
  ok(`axe: no serious or critical issues${bad.length ? ` (${bad.join(", ")})` : ""}`, bad.length === 0);
}
ok("no page errors during the whole run", pageErrors.length === 0);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll membership browser checks passed.");
process.exit(failures ? 1 : 0);
