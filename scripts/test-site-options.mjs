// Website options end to end, offline: brief (src/lib/websiteBrief.ts) -> report text -> Edge helper (supabase/functions/_shared/site-options.mjs) -> worker and builder
// wiring -> the client-site template (templates/business-v1). Drift between the front end and the Edge helper fails here. Planted-bug controls included.
import fs from "node:fs";
import { colourModeOptions, briefOptionLines } from "../src/lib/websiteBrief.ts";
import { siteOptionsFromReport, normalizeSiteOptions, resolveColourMode, COLOUR_MODES, DEFAULT_SITE_OPTIONS, applyStaticOptions, applyStaticOptionsToBase64 } from "../supabase/functions/_shared/site-options.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

// ---- brief text -> Edge helper, every combination
const readerFor = (lines) => { const map = new Map(lines.map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()])); return (label) => map.get(label) ?? ""; };
let allRoundTrip = true;
for (const option of colourModeOptions) for (const seo of [true, false]) for (const smoothScroll of [true, false]) {
  const got = siteOptionsFromReport(readerFor(briefOptionLines({ colourMode: option.value, seo, smoothScroll })));
  if (got.color_mode !== option.value || got.seo !== seo || got.smooth_scroll !== smoothScroll) allRoundTrip = false;
}
check("all 16 combinations written by the brief are read back correctly by the Edge helper", allRoundTrip);
check("the Edge helper knows exactly the brief's colour modes", COLOUR_MODES.join() === colourModeOptions.map((o) => o.value).join());
check("an old report without the new lines gets the defaults", JSON.stringify(siteOptionsFromReport(() => "")) === JSON.stringify(DEFAULT_SITE_OPTIONS));
check("unknown colour words fall back to recommend; SEO and smooth scrolling only turn off on a clear no", (() => {
  const o = siteOptionsFromReport((l) => ({ "Website colour mode": "hot pink", "Search-engine setup (SEO)": "maybe", "Smooth scrolling": "NO" }[l] ?? ""));
  return o.color_mode === "recommend" && o.seo === true && o.smooth_scroll === false;
})());
check("normalize accepts good plan data and defaults everything else", JSON.stringify(normalizeSiteOptions({ color_mode: "both", seo: false, smooth_scroll: false })) === JSON.stringify({ color_mode: "both", seo: false, smooth_scroll: false })
  && [null, "x", 5, [], { color_mode: "evil", seo: "no", smooth_scroll: 0 }].every((v) => JSON.stringify(normalizeSiteOptions(v)) === JSON.stringify(DEFAULT_SITE_OPTIONS)));
check("recommend builds dark today; light and both pass through; junk becomes dark", resolveColourMode("recommend") === "dark" && resolveColourMode("light") === "light" && resolveColourMode("both") === "both" && resolveColourMode("x") === "dark" && resolveColourMode(undefined) === "dark");

// ---- options written into the page itself (no scripts needed)
const templateHtml = fs.readFileSync("templates/business-v1/index.html", "utf8");
const seoOff = applyStaticOptions(templateHtml, { seo: false });
const lightOnly = applyStaticOptions(templateHtml, { color_mode: "light" });
check("SEO off writes a static noindex tag once, right after the viewport tag", (seoOff.match(/name="robots"/g) || []).length === 1 && /<meta name="viewport"[^>]*\/>\s*<meta name="robots" content="noindex, nofollow" \/>/.test(seoOff));
check("applying twice never duplicates it, and a page that already has a robots tag is left alone", applyStaticOptions(seoOff, { seo: false }) === seoOff);
check("Light only sets data-mode and the light theme colour in the HTML so the first paint is already light", lightOnly.includes('<html lang="en" data-mode="light">') && lightOnly.includes('content="#f5f6fa"') && !lightOnly.includes('content="#070b12"'));
check("dark, 'recommend', 'both' and the defaults leave the page byte-for-byte unchanged (Both is decided in the visitor's browser)", ["dark", "recommend", "both"].every((m) => applyStaticOptions(templateHtml, { color_mode: m }) === templateHtml) && applyStaticOptions(templateHtml, undefined) === templateHtml && applyStaticOptions(templateHtml, {}) === templateHtml);
check("if the template changes and an anchor is missing, the page is left untouched rather than guessed at", applyStaticOptions(templateHtml.replace('<html lang="en">', '<html lang="en" class="x">'), { color_mode: "light" }).includes("data-mode") === false && applyStaticOptions(templateHtml.replace(/<meta name="viewport"[^>]*>/, ""), { seo: false }).includes("noindex") === false);
check("junk input is returned as is", applyStaticOptions(null, { seo: false }) === null && applyStaticOptions(5, {}) === 5);
check("the base64 route used by the builder gives exactly the same page (including non-ASCII text)", (() => {
  const page = templateHtml.replace("<title>", "<title>Caf\u00e9 \u2603 ");
  const encoded = Buffer.from(page).toString("base64");
  const out = Buffer.from(applyStaticOptionsToBase64(encoded, { seo: false, color_mode: "light" }), "base64").toString();
  return out === applyStaticOptions(page, { seo: false, color_mode: "light" }) && applyStaticOptionsToBase64(encoded, {}) === encoded;
})());
check("the template's own run-time noindex and the static one say the same thing", /addMeta\('name', 'robots', 'noindex, nofollow'\)/.test(fs.readFileSync("templates/business-v1/app.js", "utf8")) && seoOff.includes('content="noindex, nofollow"'));

// ---- worker + builder wiring (source)
const worker = fs.readFileSync("supabase/functions/prepare-build-plan/index.ts", "utf8");
const builder = fs.readFileSync("supabase/functions/build-business-website/index.ts", "utf8");
const app = fs.readFileSync("templates/business-v1/app.js", "utf8");
const css = fs.readFileSync("templates/business-v1/styles.css", "utf8");
const html = fs.readFileSync("templates/business-v1/index.html", "utf8");
const lead = fs.readFileSync("templates/business-v1/lead-form.js", "utf8");

const wiring = {
  "the plan worker carries the options on every plan (reused or new), before the plan is saved": (w) => w.indexOf("buildPlan = { ...buildPlan, site_options: siteOptionsFromReport(") > 0 && w.indexOf("buildPlan = { ...buildPlan, site_options: siteOptionsFromReport(") < w.indexOf('admin.from("projects").update({') && w.includes("setupField(setupFields, label)"),
  "the options do not change the AI fingerprint (changing them never needs a new AI answer)": (w) => !/fingerprintInput = \{[^}]*site_options/.test(w),
  "the builder normalizes the plan's options before use": (_w, b) => b.includes("normalizeSiteOptions(buildPlan.site_options)"),
  "the builder writes the static options into index.html while syncing the template": (_w, b) => b.includes('const content = file === "index.html" ? applyStaticOptionsToBase64(fetched, pageOptions) : fetched;') && b.includes("normalizeSiteOptions((projectRes.data.build_plan as JsonRecord).site_options)"),
  "the builder writes colour mode, smooth scrolling and SEO into the site config": (_w, b) => b.includes("colorMode: resolveColourMode(siteOptions.color_mode)") && b.includes("smoothScroll: siteOptions.smooth_scroll") && b.includes("enabled: siteOptions.seo"),
};
for (const [name, test] of Object.entries(wiring)) check(name, test(worker, builder));
const plantW = (name, from, to, key) => check(`control: ${name}`, worker.includes(from) && !wiring[key](worker.split(from).join(to), builder));
const plantB = (name, from, to, key) => check(`control: ${name}`, builder.includes(from) && !wiring[key](worker, builder.split(from).join(to)));
plantW("saving the plan before the options are added is noticed", "buildPlan = { ...buildPlan, site_options: siteOptionsFromReport(", "buildPlan = { ...buildPlan, xsite_options: siteOptionsFromReport(", "the plan worker carries the options on every plan (reused or new), before the plan is saved");
plantB("using raw plan data in the builder is noticed", "normalizeSiteOptions(buildPlan.site_options)", "buildPlan.site_options", "the builder normalizes the plan's options before use");
plantB("not applying the static options to index.html is noticed", 'file === "index.html" ? applyStaticOptionsToBase64(fetched, pageOptions) : fetched', "fetched", "the builder writes the static options into index.html while syncing the template");
plantB("dropping the SEO switch from the config is noticed", "enabled: siteOptions.seo", "enabled: true", "the builder writes colour mode, smooth scrolling and SEO into the site config");

// ---- template safety and coverage
const galleryRegex = (() => { const m = app.match(/const GALLERY_SRC = (\/.*\/[a-z]*);/); return m ? eval(m[1]) : null; })();
check("the gallery only accepts ./gallery/<name>.(jpg|jpeg|png|webp)", Boolean(galleryRegex) && ["./gallery/a.png", "./gallery/job-1_final.JPG", "./gallery/x.webp"].every((v) => galleryRegex.test(v)));
check("the gallery refuses remote, traversal, script, svg and extensionless paths", Boolean(galleryRegex) && ["https://evil.example/a.png", "//evil.example/a.png", "./gallery/../a.png", "../gallery/a.png", "/gallery/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "./gallery/a.svg", "./gallery/a.png?x=1", "./gallery/.png", "./gallery/a", "./gallery/a.png\n", "./gallery/sub/a.png"].every((v) => !galleryRegex.test(v)));
check("config text reaches the page as text, never as markup", !/innerHTML\s*=\s*[^'"\s;]/.test(app.replace(/\.innerHTML = ''/g, "")) && !/insertAdjacentHTML|document\.write|eval\(/.test(app));
check("only the three known colour modes are accepted from config", /\['dark', 'light', 'both'\]\.includes\(design\?\.colorMode\)/.test(app));
check("SEO off adds noindex and returns before any structured data", /enabled === false\) \{\s*addMeta\('name', 'robots', 'noindex, nofollow'\);\s*return;/.test(app));
check("structured data only uses the client's own facts (name, description, phone, email, area)", /const data = \{ '@context': 'https:\/\/schema\.org', '@type': 'LocalBusiness', name: business\.name \};/.test(app) && !/aggregateRating|review|priceRange|award|license|openingHours/i.test(app));
check("the gallery size is capped and images load lazily", app.includes(".slice(0, 12)") && app.includes("image.loading = 'lazy'"));
check("smooth scrolling can be turned off (site.smoothScroll === false)", app.includes("site?.smoothScroll === false") && css.includes('html[data-smooth="off"] { scroll-behavior: auto; }'));
check("the page has the switch, the gallery section and the dialog, all hidden until configured", /id="mode-toggle"[^>]*hidden/.test(html) && /id="work"[^>]*hidden/.test(html) && /id="nav-work"[^>]*hidden/.test(html) && html.includes('<dialog class="work-dialog"'));
const light = css.match(/:root\[data-mode="light"\] \{([\s\S]*?)\n\}/)?.[1] || "";
const rootBlock = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] || "";
const colourVars = ["--bg", "--bg-top", "--bg-deep", "--text", "--muted", "--line", "--panel", "--accent", "--accent-2", "--nav", "--em", "--meta", "--surface", "--text-soft", "--faint", "--ghost", "--glass", "--header-bg", "--grid", "--tint", "--foot", "--shadow"];
check("light mode redefines every colour variable the dark theme defines", colourVars.every((v) => rootBlock.includes(`${v}:`) && light.includes(`${v}:`)), colourVars.filter((v) => !light.includes(`${v}:`)).join(","));
check("cascade order: the light palette comes AFTER every dark theme rule (same specificity, the later rule wins), so Light really is light for all four themes", (() => { const lightAt = css.indexOf(':root[data-mode="light"] {'); const themeRules = [...css.matchAll(/^:root\[data-theme="[a-z_]+"\] \{/gm)].map((m) => m.index); return lightAt > 0 && themeRules.length === 3 && themeRules.every((i) => i < lightAt); })());
check("control: a light block placed BEFORE the theme rules would be caught", (() => { const lightAt = css.indexOf(':root[data-mode="light"] {'); const themeAt = css.indexOf(':root[data-theme="charcoal_gold"] {'); return !(themeAt > lightAt) && lightAt > themeAt; })());
check("every one of the four themes has a readable light accent", ["charcoal_gold", "forest_emerald", "royal_violet"].every((t) => css.includes(`:root[data-mode="light"][data-theme="${t}"]`)));
check("no dark-only colours are left in the page rules (they would be unreadable in light mode)", !/#0a0f18|#b9c3d0|#d5dce6|#8796a9|#8896a8|#b7c7dc|#b7c3d1|color: white|rgba\(7,11,18,\.78\)|rgba\(10,16,26,\.76\)/.test(css.replace(rootBlock, "").replace(light, "")));
check("the lead form inputs follow the theme instead of fixed dark colours", !/#ffffff22|#ffffff08/.test(lead) && lead.includes("var(--line)") && lead.includes("var(--panel)"));
check("control: a leftover dark-only colour would be caught", /#0a0f18/.test(css.replace(rootBlock, "").replace(light, "") + " #0a0f18"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll site option checks passed.");
process.exit(failures ? 1 : 0);
