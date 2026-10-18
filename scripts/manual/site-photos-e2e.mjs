// Real-browser check of the website photos panel via harness/site-photos.html (in-memory fakes of the photo functions and the uploader, no network).
// Covers: picking photos (wrong types refused with plain words), required descriptions, big photos shrunk in the browser before upload, upload failure
// handling, the list with safety-check wording, reorder / move / edit / remove, the 12-photo cap, refused markup, 390/360px and axe (AXE=<path to axe.min.js>).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:5199";
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
async function open(query = "", width = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${base}/scripts/manual/harness/site-photos.html${query}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  return { page, ctx };
}
// builds a real image in the browser and hands the bytes back, so the test files are genuine JPG/PNG data
async function makeImage(page, width, height, type, noisy) {
  const base64 = await page.evaluate(async ([w, h, t, n]) => {
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); const img = ctx.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) { const v = n ? Math.random() * 255 : 120; img.data[i] = v; img.data[i + 1] = n ? Math.random() * 255 : 160; img.data[i + 2] = n ? Math.random() * 255 : 90; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, t, 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [width, height, type, noisy]);
  return Buffer.from(base64, "base64");
}

let { page, ctx } = await open();
const big = await makeImage(page, 3000, 2000, "image/jpeg", true);
const small = await makeImage(page, 200, 150, "image/jpeg", false);
ok("the test's big picture really is big (over 1.5 MB)", big.length > 1_500_000, `${big.length}`);
ok("starts empty: the panel explains what the photos are for and that they are safety-checked", /Our work/.test((await page.getByTestId("site-photos").textContent()) || "") && /checked for\s+safety/.test((await page.getByTestId("site-photos").textContent()) || "") && (await page.getByTestId("site-photo-list").count()) === 0);

await page.setInputFiles("#site-photo-files", [
  { name: "big-tree.jpg", mimeType: "image/jpeg", buffer: big },
  { name: "stump.jpg", mimeType: "image/jpeg", buffer: small },
  { name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") },
  { name: "iphone.heic", mimeType: "image/heic", buffer: Buffer.from("heic") },
  { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
]);
const alerts = (await page.getByRole("alert").allTextContents()).join(" | ");
ok("a PDF, a HEIC and an empty file are refused in plain words, with the iPhone tip", /contract\.pdf: choose a JPG, PNG or WebP/.test(alerts) && /iphone\.heic/.test(alerts) && /Most Compatible/.test(alerts) && /empty\.png: this file is empty/.test(alerts));
ok("the two good pictures are queued with previews", (await page.locator(".site-photo-queue .site-photo-row").count()) === 2 && (await page.locator(".site-photo-thumb").count()) === 2);

await page.getByRole("button", { name: "Add these 2 photos" }).click();
await page.waitForTimeout(400);
ok("nothing is uploaded until each photo has a description (plain-words error per photo)", (await page.evaluate(() => window.photoSim.uploads.length)) === 0 && (await page.getByText("Describe this photo in a few words first.").count()) === 2);
await page.fill("#site-photo-files ~ .site-photo-queue .site-photo-row:nth-of-type(1) input[id^=alt-]", "A large oak after it was trimmed").catch(async () => page.locator('.site-photo-row input[id^="alt-"]').nth(0).fill("A large oak after it was trimmed"));
await page.locator('.site-photo-row input[id^="alt-"]').nth(1).fill("A ground-down stump");
await page.locator('.site-photo-row input[id^="cap-"]').nth(0).fill("Trimmed oak");
await page.getByRole("button", { name: "Add these 2 photos" }).click();
await page.waitForSelector("[data-testid=site-photo-item]", { timeout: 15000 });
await page.waitForTimeout(400);
const uploads = await page.evaluate(() => window.photoSim.uploads);
ok("the big photo was shrunk in the browser before upload (JPEG, much smaller)", uploads[0].type === "image/jpeg" && uploads[0].size < big.length / 2 && uploads[0].name === "big-tree.jpg", JSON.stringify(uploads[0]));
ok("the small photo was uploaded exactly as chosen", uploads[1].size === small.length && uploads[1].name === "stump.jpg");
ok("both photos are listed under 'my work' with the safety-check wording and a success message", (await page.getByTestId("site-photo-item").count()) === 2 && /2 photos added/.test((await page.getByRole("status").first().textContent()) || "") && /Being checked for safety/.test((await page.getByTestId("site-photo-list").textContent()) || ""));
ok("the queue is empty after a successful add", (await page.getByTestId("site-photo-queue").count()) === 0);
const first = (await page.evaluate(() => window.photoSim.photos))[0];
ok("the description and caption were saved with the right order", first.altText === "A large oak after it was trimmed" && first.caption === "Trimmed oak" && first.sortOrder === 1);

await page.evaluate(() => { const s = window.photoSim; s.scan(s.photos[0].fileId, "clean", true); s.scan(s.photos[1].fileId, "infected", false); });
await page.getByRole("button", { name: "Check photo status" }).click();
await page.waitForTimeout(250);
const listText = (await page.getByTestId("site-photo-list").textContent()) || "";
ok("after the scan: 'Ready' for the clean photo and a plain 'could not be used' for the flagged one", /Ready/.test(listText) && /Could not be used \(the safety check flagged it\)/.test(listText));

await page.getByRole("button", { name: /Move .*stump.* up/ }).click();
await page.waitForTimeout(250);
ok("moving a photo up swaps the order", (await page.locator("[data-testid=site-photo-item] strong").allTextContents()).join() === "stump.jpg,big-tree.jpg");
ok("the first photo cannot move up and the last cannot move down", await page.getByRole("button", { name: /Move .*stump.* up/ }).isDisabled() && await page.getByRole("button", { name: /Move .*big-tree.* down/ }).isDisabled());
await page.locator('[data-testid=site-photo-item] input[id^="desc-"]').first().fill("A stump ground below the lawn");
await page.locator('[data-testid=site-photo-item] input[id^="desc-"]').first().blur();
await page.waitForTimeout(250);
ok("editing a description saves it when the box loses focus", (await page.evaluate(() => window.photoSim.photos.find((p) => p.fileName === "stump.jpg").altText)) === "A stump ground below the lawn");
await page.locator('[data-testid=site-photo-item] input[id^="desc-"]').first().fill("<b>x</b> bold");
await page.locator('[data-testid=site-photo-item] input[id^="desc-"]').first().blur();
await page.waitForTimeout(250);
ok("markup in a description is refused in plain words and not saved", /cannot contain the characters/.test((await page.getByRole("status").last().textContent()) || "") && (await page.evaluate(() => window.photoSim.photos.find((p) => p.fileName === "stump.jpg").altText)) === "A stump ground below the lawn");
await page.getByRole("button", { name: "Move to other photos" }).first().click();
await page.waitForTimeout(250);
ok("a photo can be moved to 'other photos' and gets its own group", (await page.getByRole("heading", { name: /Other photos for my website team/ }).count()) === 1);
let confirmText = "";
page.once("dialog", async (d) => { confirmText = d.message(); await d.accept(); });
await page.getByRole("button", { name: "Remove", exact: true }).first().click();
await page.waitForTimeout(250);
ok("removing asks first and says the file itself stays", /file itself stays in your Files/.test(confirmText) && (await page.getByTestId("site-photo-item").count()) === 1);
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/site-photos.png`, fullPage: true });
if (axeSource) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`));
  ok("axe: no WCAG A/AA violations", violations.length === 0, JSON.stringify(violations));
}
await ctx.close();

// upload failure keeps the photo in the batch with its message
({ page, ctx } = await open());
await page.setInputFiles("#site-photo-files", [{ name: "fail-me.jpg", mimeType: "image/jpeg", buffer: small }, { name: "fine.jpg", mimeType: "image/jpeg", buffer: small }]);
await page.locator('.site-photo-row input[id^="alt-"]').nth(0).fill("Will fail");
await page.locator('.site-photo-row input[id^="alt-"]').nth(1).fill("Will work");
await page.getByRole("button", { name: "Add these 2 photos" }).click();
await page.waitForTimeout(600);
ok("one failed upload does not stop the others; it stays queued with its message", (await page.evaluate(() => window.photoSim.photos.length)) === 1 && (await page.locator(".site-photo-queue .site-photo-row").count()) === 1 && /could not be uploaded/.test((await page.getByTestId("site-photo-queue").textContent()) || ""));
await ctx.close();

// the 12 photo cap
({ page, ctx } = await open("?full=1"));
ok("with 12 photos in Our work the picker is disabled and says there is no room", await page.locator("#site-photo-files").isDisabled() && /room for 0 more/.test((await page.getByTestId("site-photos").textContent()) || ""));
await page.selectOption("#site-photo-role", "site");
ok("switching to 'other photos' opens room again (12 of 24 used)", await page.locator("#site-photo-files").isEnabled() && /room for 12 more/.test((await page.getByTestId("site-photos").textContent()) || ""));
await ctx.close();

for (const width of [390, 360]) {
  ({ page, ctx } = await open("?full=1", width));
  ok(`no sideways scroll at ${width}px`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  if (process.env.SHOT && width === 390) await page.screenshot({ path: `${process.env.SHOT}/site-photos-390.png`, fullPage: true });
  await ctx.close();
}
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
process.exit(failures ? 1 : 0);
