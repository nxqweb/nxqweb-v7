// Builds the fictional example sites into public/examples/<slug>/ from the REAL client-site template (templates/business-v1) and the demo configs.
//   node scripts/build-example-sites.mjs --write   writes the files (run after changing a demo config or the template)
//   node scripts/build-example-sites.mjs --check   exits 1 if the committed files differ from what the template would produce (used by scripts/test-example-sites.mjs)
// Each example gets: the template's index.html with a visible "example site" banner, a noindex tag, no lead-form or analytics scripts and footer links to the NXQX legal pages;
// the template's styles, accessibility styles and renderer unchanged; and the demo config with the example's colour theme.
import fs from "node:fs";
import path from "node:path";
import { exampleSites } from "../src/lib/exampleSites.ts";

const templateDir = "templates/business-v1";
const outDir = "public/examples";
const read = (p) => fs.readFileSync(p, "utf8");

const bannerCss = `/* Example-site banner (added by scripts/build-example-sites.mjs). Dark bar, light text: readable on every theme. */
.demo-banner { background: #111; color: #fff; padding: 0.6rem 1rem; text-align: center; font: 600 0.9rem/1.4 system-ui, sans-serif; }
.demo-banner a { color: #ffe08a; text-decoration: underline; margin: 0 0.4rem; }
.demo-banner a:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
`;

export function buildExampleFiles() {
  const files = new Map();
  const index = read(`${templateDir}/index.html`);
  const stylesheets = { "styles.css": read(`${templateDir}/styles.css`), "a11y.css": read(`${templateDir}/a11y.css`), "app.js": read(`${templateDir}/app.js`) };
  for (const site of exampleSites) {
    let html = index;
    const must = (needle, label) => { if (!html.includes(needle)) throw new Error(`template changed: cannot find ${label}`); };
    must('<meta name="viewport" content="width=device-width, initial-scale=1.0" />', "the viewport tag");
    html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1.0" />', '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta name="robots" content="noindex, nofollow" />');
    must('<link rel="stylesheet" href="./a11y.css" />', "the accessibility stylesheet link");
    html = html.replace('<link rel="stylesheet" href="./a11y.css" />', '<link rel="stylesheet" href="./a11y.css" />\n    <link rel="stylesheet" href="./demo.css" />');
    must('<a class="sr-only" href="#main-content">Skip to content</a>', "the skip link");
    html = html.replace('<a class="sr-only" href="#main-content">Skip to content</a>', '<a class="sr-only" href="#main-content">Skip to content</a>\n    <div class="demo-banner" role="note"><strong>Example site.</strong> A fictional business, built with the NXQX-Web template.<a href="/examples">More examples</a><a href="/plans">Plans</a></div>');
    must('<script type="module" src="./lead-form.js"></script>', "the lead form script");
    html = html.replace('    <script type="module" src="./lead-form.js"></script>\n', "").replace('    <script type="module" src="./analytics.js"></script>\n', "");
    must('<a href="/privacy.html">Privacy</a>', "the footer privacy link");
    html = html.replace(/<a href="\/privacy\.html">Privacy<\/a>\s*<a href="\/terms\.html">Terms<\/a>\s*<a href="\/accessibility\.html">Accessibility<\/a>/, '<a href="/privacy">NXQX Privacy</a>\n        <a href="/terms">NXQX Terms</a>');
    const config = `${read(`${templateDir}/${site.config}`).trimEnd()}\nsiteConfig.design = { themeKey: ${JSON.stringify(site.theme)} };\n`;
    const dir = `${outDir}/${site.slug}`;
    files.set(`${dir}/index.html`, html);
    files.set(`${dir}/site.config.js`, config);
    files.set(`${dir}/demo.css`, bannerCss);
    for (const [name, content] of Object.entries(stylesheets)) files.set(`${dir}/${name}`, content);
  }
  return files;
}

export function checkExampleFiles() {
  const problems = [];
  const expected = buildExampleFiles();
  for (const [file, content] of expected) {
    if (!fs.existsSync(file)) problems.push(`missing ${file}`);
    else if (read(file) !== content) problems.push(`out of date ${file}`);
  }
  if (fs.existsSync(outDir)) {
    for (const dir of fs.readdirSync(outDir, { withFileTypes: true })) {
      if (dir.isDirectory() && dir.name !== "thumbs" && !exampleSites.some((s) => s.slug === dir.name)) problems.push(`stale folder ${outDir}/${dir.name}`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--write")) {
    for (const [file, content] of buildExampleFiles()) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
    console.log(`wrote ${exampleSites.length} example sites to ${outDir}/`);
  } else {
    const problems = checkExampleFiles();
    if (problems.length) { console.log(problems.join("\n")); process.exit(1); }
    console.log(`example sites are up to date (${exampleSites.length})`);
  }
}
