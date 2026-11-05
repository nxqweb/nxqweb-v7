// Scratch end-to-end check of the Reviews page in a real browser (in-memory gateway via scripts/manual/harness/reviews.html; no network at all).
// Optional: set ZXING_DIR=<folder with zxing-cpp, numpy and pillow installed by pip --target> to also DECODE the QR code shown on screen.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
const url = (q = "") => `${base}/scripts/manual/harness/reviews.html${q}`;
let failures = 0;
const ok = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(q = "", width = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(url(q), { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return page;
}

// 1. not connected
let page = await open("?gw=none");
ok("not connected: says it is not open yet and shows no form", (await page.getByTestId("reviews-unavailable").count()) === 1 && (await page.getByTestId("reviews-form").count()) === 0);

// 2. empty start, bad links, then a good one
page = await open("");
ok("starts with the form and no card", (await page.getByTestId("reviews-form").count()) === 1 && (await page.getByTestId("review-card").count()) === 0);
ok("save is disabled until something is typed", await page.getByRole("button", { name: /Save and make my card/ }).isDisabled());
await page.getByLabel("Review link").fill("http://example.com/review");
await page.getByRole("button", { name: /Save and make my card/ }).click();
ok("an http link is refused with a plain message", /secure version/.test((await page.getByRole("alert").textContent()) || "") && (await page.evaluate(() => (window.__saves || []).length)) === 0);
await page.getByLabel("Review link").fill("https://user:pass@example.com/x");
await page.getByRole("button", { name: /Save and make my card/ }).click();
ok("a link with a username is refused and nothing is saved", (await page.getByRole("alert").count()) === 1 && (await page.evaluate(() => (window.__saves || []).length)) === 0);
await page.getByLabel("Business name on the card (optional)").fill("Bad <b>name</b>");
await page.getByLabel("Review link").fill("https://g.page/r/CabcDEF/review");
await page.getByRole("button", { name: /Save and make my card/ }).click();
ok("a business name with markup is refused", /cannot contain/.test((await page.getByRole("alert").textContent()) || ""));
await page.getByLabel("Business name on the card (optional)").fill("Light of the World Candles");
await page.getByRole("button", { name: /Save and make my card/ }).click();
await page.getByTestId("review-card").waitFor();
ok("a good link saves and the card appears with the business name", /Light of the World Candles/.test((await page.getByTestId("review-card").textContent()) || "") && (await page.getByRole("status").filter({ hasText: "Saved" }).count()) === 1);
ok("exactly one save was sent with the tidy values", JSON.stringify(await page.evaluate(() => window.__saves)) === JSON.stringify([{ reviewUrl: "https://g.page/r/CabcDEF/review", businessName: "Light of the World Candles" }]));
ok("the QR code has a label for screen readers", /QR code that opens your Google review page/.test((await page.getByTestId("review-qr").getAttribute("aria-label")) || ""));
const link = page.getByRole("link", { name: /Test my link/ });
ok("the test-my-link button opens the client's own link safely in a new tab", (await link.getAttribute("href")) === "https://g.page/r/CabcDEF/review" && (await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) || ""));

// 3. the QR code on screen really scans
if (process.env.ZXING_DIR) {
  const shot = `${process.env.ZXING_DIR}/review-qr.png`;
  await page.getByTestId("review-qr").screenshot({ path: shot });
  const py = `import sys\nsys.path.insert(0, ${JSON.stringify(process.env.ZXING_DIR + "/pyqr")})\nimport zxingcpp\nfrom PIL import Image\nr = zxingcpp.read_barcodes(Image.open(${JSON.stringify(shot)}))\nprint(r[0].text if r else "NOTHING")`;
  const decoded = execFileSync("python3", ["-I", "-c", py]).toString().trim();
  ok("the QR code drawn in the browser decodes back to the exact review link", decoded === "https://g.page/r/CabcDEF/review");
  fs.rmSync(shot, { force: true });
} else console.log("SKIP  QR decode (set ZXING_DIR to run it)");

// 4. messages and copy
ok("the text message and email contain the link", /https:\/\/g\.page\/r\/CabcDEF\/review/.test(await page.locator("#review-sms").inputValue()) && /https:\/\/g\.page\/r\/CabcDEF\/review/.test(await page.locator("#review-email").inputValue()));
await page.getByRole("button", { name: /Copy text message/ }).click();
ok("copy puts the text on the clipboard and confirms", (await page.evaluate(() => navigator.clipboard.readText())).includes("g.page/r/CabcDEF/review") && (await page.getByRole("button", { name: /Text copied/ }).count()) === 1);
ok("the fairness notes are shown", /Ask every customer/.test((await page.getByTestId("review-rules").textContent()) || "") && /Never offer/.test((await page.getByTestId("review-rules").textContent()) || ""));

// 5. print view shows only the card
await page.emulateMedia({ media: "print" });
const hidden = await page.evaluate(() => [...document.querySelectorAll(".no-print")].every((el) => getComputedStyle(el).display === "none"));
const cardVisible = await page.getByTestId("review-qr").isVisible();
ok("print view hides the page controls and keeps the card and code", hidden && cardVisible);
await page.emulateMedia({ media: "screen" });

// 6. removing needs a confirm; failures stay calm
page.once("dialog", (d) => d.dismiss());
await page.getByLabel("Review link").fill("");
await page.getByRole("button", { name: /Save changes/ }).click();
ok("removing the link asks first, and cancelling changes nothing", (await page.getByTestId("review-card").count()) === 1);
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: /Save changes/ }).click();
await page.getByTestId("review-card").waitFor({ state: "detached" });
ok("confirming removes the link and the card", (await page.getByTestId("review-card").count()) === 0);
page = await open("?seed=1&gw=fail");
await page.getByLabel("Review link").fill("https://www.yelp.com/biz/x");
await page.getByRole("button", { name: /Save changes/ }).click();
const msg = (await page.getByRole("alert").textContent()) || "";
ok("a failing save shows plain words, never raw database text, and keeps the card", /could not save/i.test(msg) && !/duplicate|constraint|pkey/i.test(msg) && (await page.getByTestId("review-card").count()) === 1);

// 7. phone width: no sideways scrolling
page = await open("?seed=1", 360);
ok("no sideways scrolling at 360px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok("no page errors happened", pageErrors.length === 0);
await browser.close();
console.log(failures ? `\n${failures} browser check(s) failed` : "\nAll browser checks passed");
process.exit(failures ? 1 : 0);
