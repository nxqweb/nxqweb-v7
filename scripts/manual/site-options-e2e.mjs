// Real-browser check of the client-site template options (templates/business-v1): colour mode (dark / light / both with a switch), SEO on/off,
// smooth scrolling on/off, and the "Our work" photo gallery. It assembles the REAL template into a temp folder with a test config, serves it locally
// (no network) and drives it. Set AXE=<path to axe.min.js> to also run accessibility scans in each mode. SHOT=dir saves screenshots.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
const require = createRequire(process.env.PW_FROM || "/node-tools/node_modules/");
const { chromium } = require("playwright");
let failures = 0;
const ok = (name, cond, extra = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name} ${extra}`); } };

const templateDir = "templates/business-v1";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-site-"));
for (const file of ["index.html", "app.js", "styles.css", "a11y.css", "lead-form.js", "analytics.js", "privacy.html", "terms.html", "accessibility.html"]) fs.copyFileSync(`${templateDir}/${file}`, `${root}/${file}`);
fs.mkdirSync(`${root}/gallery`);
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5f645400000000049454e44ae426082", "hex");
for (const name of ["a.png", "b.png", "c.png"]) fs.writeFileSync(`${root}/gallery/${name}`, png);

const baseConfig = {
  schemaVersion: "nxq-business-v1",
  business: { name: "Oak Ridge Tree Service", type: "Tree service", phone: "(555) 010-2000", email: "hello@example.com", serviceArea: "Chico, California" },
  brand: { eyebrow: "Tree care in Chico", headline: "Tree work, done carefully.", subheadline: "Removal, pruning and stump grinding in Chico, California.", primaryCta: "Request an estimate", secondaryCta: "See services" },
  services: [{ title: "Tree removal", description: "Removal of trees that need to come down." }, { title: "Pruning", description: "Trimming and shaping trees." }, { title: "Stump grinding", description: "Grinding stumps below ground level." }],
  trust: { heading: "How it works", points: ["Request an estimate", "We follow up", "Work is scheduled"] },
  about: { heading: "About Oak Ridge", body: "A local tree service in Chico, California." },
  seo: { title: "Oak Ridge Tree Service | Chico", description: "Tree removal, pruning and stump grinding in Chico, California.", keywords: ["tree service"] },
  leads: { enabled: false, endpoint: "", formKey: "" },
  analytics: { enabled: false, endpoint: "", ingestKey: "", consentRequired: true, consentVersion: "v1", clicks: true, scrollDepth: true, mouseTracking: false },
};
const galleryItems = [
  { src: "./gallery/a.png", alt: "A tree after trimming", caption: "Trimmed oak" },
  { src: "./gallery/b.png", alt: "A removed stump", caption: "<img src=x onerror=alert(1)> Stump" },
  { src: "./gallery/c.png", alt: "A cleared yard" },
  { src: "https://evil.example/x.png", alt: "remote" },
  { src: "./gallery/../secret.png", alt: "traversal" },
  { src: "javascript:alert(1)", alt: "js" },
  { src: "./gallery/notimage.txt", alt: "text" },
];
let currentConfig = baseConfig;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  if (url === "/site.config.js") { res.setHeader("content-type", "text/javascript"); return res.end(`export const siteConfig = ${JSON.stringify(currentConfig)};`); }
  const file = path.join(root, url === "/" ? "index.html" : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const pageErrors = [];
async function open(config, { scheme = "dark", width = 1200, storage } = {}) {
  currentConfig = config;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  if (storage) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, storage);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  return { page, ctx };
}
const axeSource = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, "utf8") : "";
async function axe(page, label) {
  if (!axeSource) return;
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`));
  ok(`axe: no WCAG A/AA violations (${label})`, result.length === 0, JSON.stringify(result));
}
const lum = (css) => { const m = css.match(/\d+(\.\d+)?/g)?.map(Number) || [0, 0, 0]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };

// 1. defaults: dark, no extras
let { page, ctx } = await open(baseConfig);
ok("default: dark mode, no switch button, no gallery, no 'Our work' menu link", (await page.evaluate(() => document.documentElement.dataset.mode)) === "dark" && await page.locator("#mode-toggle").isHidden() && await page.locator("#work").isHidden() && await page.locator("#nav-work").isHidden());
ok("default (SEO on): Open Graph tags and LocalBusiness structured data come from the client's own facts only", await page.evaluate(() => {
  const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  return ld["@type"] === "LocalBusiness" && ld.name === "Oak Ridge Tree Service" && ld.telephone === "(555) 010-2000" && ld.areaServed === "Chico, California" && Object.keys(ld).sort().join() === "@context,@type,areaServed,description,email,name,telephone"
    && document.querySelector('meta[property="og:title"]').content === "Oak Ridge Tree Service | Chico" && !document.querySelector('meta[name="robots"]');
}));
ok("default: smooth scrolling on", (await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)) === "smooth");
await axe(page, "dark");
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/site-dark.png`, fullPage: true });
await ctx.close();

// 2. light
({ page, ctx } = await open({ ...baseConfig, design: { themeKey: "midnight_blue", colorMode: "light" } }, { scheme: "dark" }));
ok("light: the page is light even when the visitor's system is dark, and there is no switch", (await page.evaluate(() => document.documentElement.dataset.mode)) === "light" && lum(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)) > 0.85 && lum(await page.evaluate(() => getComputedStyle(document.querySelector("h1")).color)) < 0.3 && await page.locator("#mode-toggle").isHidden());
ok("light: the browser theme colour follows", (await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content)) === "#f5f6fa");
await axe(page, "light");
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/site-light.png`, fullPage: true });
await ctx.close();
for (const theme of ["charcoal_gold", "forest_emerald", "royal_violet"]) {
  ({ page, ctx } = await open({ ...baseConfig, design: { themeKey: theme, colorMode: "light" } }));
  await axe(page, `light + ${theme}`);
  await ctx.close();
  ({ page, ctx } = await open({ ...baseConfig, design: { themeKey: theme, colorMode: "dark" } }));
  await axe(page, `dark + ${theme}`);
  await ctx.close();
}

// 3. both
const bothConfig = { ...baseConfig, design: { themeKey: "midnight_blue", colorMode: "both" } };
({ page, ctx } = await open(bothConfig, { scheme: "light" }));
ok("both: a visitor whose system is light starts light, and the switch offers the other mode", (await page.evaluate(() => document.documentElement.dataset.mode)) === "light" && await page.locator("#mode-toggle").isVisible() && (await page.locator("#mode-toggle").textContent()) === "Dark mode" && (await page.locator("#mode-toggle").getAttribute("aria-label")) === "Switch to dark mode");
await page.locator("#mode-toggle").click();
ok("both: pressing the switch changes the mode and its label", (await page.evaluate(() => document.documentElement.dataset.mode)) === "dark" && (await page.locator("#mode-toggle").textContent()) === "Light mode");
await page.reload({ waitUntil: "networkidle" });
ok("both: the visitor's choice is remembered on their device", (await page.evaluate(() => document.documentElement.dataset.mode)) === "dark");
await ctx.close();
({ page, ctx } = await open(bothConfig, { scheme: "dark" }));
ok("both: a visitor whose system is dark starts dark", (await page.evaluate(() => document.documentElement.dataset.mode)) === "dark");
await ctx.close();
({ page, ctx } = await open(bothConfig, { scheme: "dark", storage: ["nxq-site-mode", "evil"] }));
ok("both: a tampered stored value is ignored", (await page.evaluate(() => document.documentElement.dataset.mode)) === "dark");
await ctx.close();
({ page, ctx } = await open({ ...baseConfig, design: { themeKey: "midnight_blue", colorMode: "neon" } }));
ok("an unknown colour mode falls back to dark", (await page.evaluate(() => document.documentElement.dataset.mode)) === "dark");
await ctx.close();

// 4. SEO off
({ page, ctx } = await open({ ...baseConfig, seo: { ...baseConfig.seo, enabled: false } }));
ok("SEO off: the page asks search engines not to list it and adds no structured data or Open Graph tags", await page.evaluate(() => document.querySelector('meta[name="robots"]')?.content === "noindex, nofollow" && !document.querySelector('script[type="application/ld+json"]') && !document.querySelector('meta[property^="og:"]')));
await ctx.close();

// 5. smooth scroll off
({ page, ctx } = await open({ ...baseConfig, site: { smoothScroll: false } }));
ok("smooth scrolling off: pages jump instead of glide", (await page.evaluate(() => document.documentElement.dataset.smooth)) === "off" && (await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)) === "auto");
await ctx.close();

// 6. gallery
const galleryConfig = { ...baseConfig, gallery: { label: "Our work", title: "Recent jobs", intro: "Photos from jobs we have done.", items: galleryItems } };
({ page, ctx } = await open(galleryConfig));
ok("gallery: only safe local images are shown (remote, traversal, javascript: and non-image files are dropped)", (await page.locator(".work-item").count()) === 3 && await page.evaluate(() => [...document.querySelectorAll(".work-item img")].every((i) => /^http:\/\/127\.0\.0\.1:\d+\/gallery\/[abc]\.png$/.test(i.src))));
ok("gallery: the section, the menu link and the heading appear with the configured words", await page.locator("#work").isVisible() && await page.locator("#nav-work").isVisible() && (await page.locator("#nav-work").textContent()) === "Our work" && (await page.locator("#work-heading").textContent()) === "Recent jobs");
ok("gallery: images have the client's descriptions and load lazily", await page.evaluate(() => [...document.querySelectorAll(".work-item img")].map((i) => i.alt).join("|") === "A tree after trimming|A removed stump|A cleared yard" && [...document.querySelectorAll(".work-item img")].every((i) => i.loading === "lazy")));
ok("gallery: a caption with markup is shown as plain text, never run", (await page.locator("img[src='x']").count()) === 0 && /<img src=x onerror=alert\(1\)> Stump/.test((await page.locator(".work-item").nth(1).textContent()) || ""));
await page.locator(".work-item").first().click();
ok("gallery: pressing a photo opens it large with its caption, and Escape closes it", await page.locator("#work-dialog").evaluate((d) => d.open) && /Trimmed oak/.test((await page.locator("#work-dialog-caption").textContent()) || "") && (await page.locator("#work-dialog-img").getAttribute("alt")) === "A tree after trimming");
await page.keyboard.press("Escape");
ok("gallery: Escape closes the large view", !(await page.locator("#work-dialog").evaluate((d) => d.open)));
await axe(page, "gallery, dark");
if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/site-gallery.png`, fullPage: true });
await ctx.close();
({ page, ctx } = await open({ ...galleryConfig, design: { themeKey: "midnight_blue", colorMode: "light" } }));
await axe(page, "gallery, light");
await ctx.close();
({ page, ctx } = await open({ ...baseConfig, gallery: { items: [{ src: "https://evil.example/x.png" }] } }));
ok("gallery: with no valid photos the section stays hidden", await page.locator("#work").isHidden() && await page.locator("#nav-work").isHidden());
await ctx.close();

// 7. phone widths in both modes with a gallery
for (const width of [390, 360]) {
  for (const colorMode of ["dark", "light"]) {
    ({ page, ctx } = await open({ ...galleryConfig, design: { themeKey: "midnight_blue", colorMode } }, { width }));
    ok(`no sideways scroll at ${width}px (${colorMode})`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    if (process.env.SHOT && colorMode === "light") await page.screenshot({ path: `${process.env.SHOT}/site-light-${width}.png`, fullPage: true });
    await ctx.close();
  }
}
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
server.close();
fs.rmSync(root, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
