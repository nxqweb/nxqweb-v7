// Offline test: the fictional example sites (public/examples/*) and the /examples page.
// They must match what the REAL template + demo configs produce (no hand-edited drift), be clearly labelled fictional, carry no invented claims, send no data anywhere,
// be hidden from search engines, and be linked from the public site. Planted-bug controls prove each check can fail.
import fs from "node:fs";
import { exampleSites } from "../src/lib/exampleSites.ts";
import { buildExampleFiles, checkExampleFiles } from "./build-example-sites.mjs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const themes = new Set(["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"]);
const forbidden = /\b(licensed|insured|bonded|certified|accredited|award[- ]winning|best in|number one|#1|guarantee[ds]?|money[- ]back|years of experience|since 19|since 20|free estimate|free quote|lowest price|cheapest|\d+\s*%|\$\s?\d|24\/7|same[- ]day|within \d+|reviews? from|five[- ]star|5[- ]star|testimonial)/i;

check("there are five examples with unique slugs, valid colour themes, and a mix of business types", exampleSites.length === 5 && new Set(exampleSites.map((s) => s.slug)).size === 5 && exampleSites.every((s) => themes.has(s.theme)) && new Set(exampleSites.map((s) => s.type)).size === 5 && new Set(exampleSites.map((s) => s.theme)).size >= 3);
check("the committed example sites are exactly what the real template and demo configs produce (no drift, no stale folders)", checkExampleFiles().length === 0, checkExampleFiles().join("; "));

const files = buildExampleFiles();
const perSite = (slug) => ({ html: files.get(`public/examples/${slug}/index.html`), config: files.get(`public/examples/${slug}/site.config.js`), css: files.get(`public/examples/${slug}/demo.css`) });
const rules = (html, config) => ({
  labelled: /class="demo-banner" role="note"><strong>Example site\.<\/strong> A fictional business/.test(html) && /demo: \{ fictional: true, salesUseOnly: true, liveLeadCapture: false, liveAnalytics: false \}/.test(config),
  hiddenFromSearch: /<meta name="robots" content="noindex, nofollow" \/>/.test(html),
  sendsNothing: !/lead-form\.js|analytics\.js/.test(html) && /leads: \{ enabled: false, endpoint: "", formKey: "" \}/.test(config) && /analytics: \{ enabled: false, endpoint: "", ingestKey: ""/.test(config) && !/https?:\/\//.test(html.replace(/<meta[^>]*>/g, "")),
  noContactDetails: /phone: ""/.test(config) && /email: ""/.test(config),
  // the demos say what they do NOT invent ("without inventing reviews, ... or guarantees"); that disclaimer is not a claim, everything else is checked
  noInventedClaims: !forbidden.test(config.replace(/^\/\/.*$/gm, "").replace(/without inventing [^."]*/gi, "")),
  scriptsOnlyFromItself: [...html.matchAll(/<script[^>]*>/g)].every((m) => /src="\.\/[a-z-]+\.js"/.test(m[0])) && !/<script(?![^>]*src=)[^>]*>\s*\S/.test(html),
  linksBackToNxqx: /href="\/examples">More examples<\/a><a href="\/plans">Plans<\/a>/.test(html) && /href="\/privacy">NXQX Privacy/.test(html) && /href="\/terms">NXQX Terms/.test(html),
  themeApplied: /siteConfig\.design = \{ themeKey: "(midnight_blue|charcoal_gold|forest_emerald|royal_violet)" \};\s*$/.test(config),
});
for (const site of exampleSites) {
  const { html, config } = perSite(site.slug);
  const r = rules(html, config);
  check(`${site.slug}: labelled as a fictional example, hidden from search, sends no data, no contact details, no invented claims, own scripts only, links back to NXQX, theme applied`, Object.values(r).every(Boolean), Object.entries(r).filter(([, v]) => !v).map(([k]) => k).join(","));
}
const probe = perSite("harbor-pine-cafe");
check("PLANTED BUG caught: the banner is removed", rules(probe.html.replace(/<div class="demo-banner"[\s\S]*?<\/div>/, ""), probe.config).labelled === false);
check("PLANTED BUG caught: search engines may index the example", rules(probe.html.replace('<meta name="robots" content="noindex, nofollow" />', ""), probe.config).hiddenFromSearch === false);
check("PLANTED BUG caught: the lead form script comes back", rules(probe.html.replace("</body>", '<script type="module" src="./lead-form.js"></script></body>'), probe.config).sendsNothing === false);
check("PLANTED BUG caught: an invented claim sneaks into a demo config", rules(probe.html, probe.config.replace("A simple list of hot and iced drinks", "Award-winning coffee, guaranteed fresh, from $3")).noInventedClaims === false);
check("PLANTED BUG caught: a phone number appears", rules(probe.html, probe.config.replace('phone: ""', 'phone: "555-0100"')).noContactDetails === false);
check("PLANTED BUG caught: an inline script appears", rules(probe.html.replace("</body>", "<script>alert(1)</script></body>"), probe.config).scriptsOnlyFromItself === false);
check("PLANTED BUG caught: a hand-edit makes a file drift from the template output", (() => { const expected = buildExampleFiles(); const f = "public/examples/harbor-pine-cafe/index.html"; return expected.get(f) !== expected.get(f).replace("Example site.", "Our site."); })());

const page = read("src/pages/PublicExamples.tsx");
const app = read("src/App.tsx");
const plans = read("src/pages/PublicPlans.tsx");
const pageRules = (p, a, pl) => ({
  routed: /path === "\/examples"\) return <PublicExamples \/>;/.test(a) && /path === "\/plans" \|\| path === "\/examples" \? "home"/.test(a),
  listsEveryExample: /exampleSites\.map\(\(site\) => \(/.test(p) && /href=\{`\/examples\/\$\{site\.slug\}\/`\}/.test(p),
  honest: /fictional businesses/.test(p) && /examples, not client work/.test(p) && /no reviews, prices or promises/.test(p) && /Example sites are fictional/.test(p),
  noInvention: !/dangerouslySetInnerHTML|testimonial|trusted by/i.test(p),
  ctaIsContact: /href="\/contact">Talk to us/.test(p) && !/signup/.test(p),
  linkedFromPlans: /<a href="\/examples">Examples<\/a>/.test(pl),
  imagesDescribed: /alt=\{`Screenshot of the example site for \$\{site\.name\}/.test(p) && /width=\{640\} height=\{400\}/.test(p),
  thumbsExist: exampleSites.every((s) => fs.existsSync(`public/examples/thumbs/${s.slug}.png`) && fs.statSync(`public/examples/thumbs/${s.slug}.png`).size > 20000 && fs.statSync(`public/examples/thumbs/${s.slug}.png`).size < 400000),
});
const pg = pageRules(page, app, plans);
check("the /examples page is routed, lists every example with a link to its folder, and is linked from the plans page", pg.routed && pg.listsEveryExample && pg.linkedFromPlans);
check("the page says plainly the examples are fictional and not client work, and offers only 'Talk to us' (no signup)", pg.honest && pg.noInvention && pg.ctaIsContact);
check("every card has a screenshot with a description and fixed size; all five screenshots exist and are a sensible size", pg.imagesDescribed && pg.thumbsExist);
check("PLANTED BUG caught: the page is not routed", pageRules(page, app.replace('if (path === "/examples") return <PublicExamples />;', ""), plans).routed === false);
check("PLANTED BUG caught: the fictional wording is removed", pageRules(page.replaceAll("fictional businesses", "real businesses"), app, plans).honest === false);
check("PLANTED BUG caught: a testimonial appears", pageRules(page + "\n// testimonial", app, plans).noInvention === false);
check("PLANTED BUG caught: the plans page loses its link", pageRules(page, app, plans.replace('<a href="/examples">Examples</a>', "")).linkedFromPlans === false);
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll example-site checks passed (offline).");
process.exit(failures ? 1 : 0);
