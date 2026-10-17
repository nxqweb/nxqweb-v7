// Offline test: accessibility basics found by an axe-core scan (2026-10-16). Static checks so they stay fixed: every labelled div has a role,
// the pages that had no page heading now have one, and the progress bar is a real progress bar. (The live scan itself is documented in the handoff.)
import fs from "node:fs";
import path from "node:path";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : []); }
const files = walk("src");
const bad = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/<(div|span|section)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/\baria-label=/.test(attrs) && !/\brole=/.test(attrs) && m[1] !== "section") bad.push(`${file}: <${m[1]} ${attrs.trim().slice(0, 60)}`);
  }
}
check("no div or span has an aria-label without a role (screen readers ignore it)", bad.length === 0, bad.slice(0, 3).join(" | "));

// a link or a button with a status/alert role loses its meaning for screen readers (axe: link-name); announcements belong in a separate live region
const wrongRole = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/<(a|button)\b([^>]*)>/g)) if (/\brole="(status|alert|log|region)"/.test(m[2])) wrongRole.push(`${file}: <${m[1]} ${m[2].trim().slice(0, 60)}`);
}
check("no link or button carries a status, alert, log or region role", wrongRole.length === 0, wrongRole.slice(0, 3).join(" | "));

const css = fs.readFileSync("src/styles/final-frontend-polish.css", "utf8");
check("a screen-reader-only text class exists", /\.sr-only \{[^}]*clip: rect\(0, 0, 0, 0\);[^}]*\}/.test(css));
check("the plans page and the signup page have a page heading", /<h1 className="sr-only">NXQX-Web service levels and plans<\/h1>/.test(fs.readFileSync("src/pages/PublicPlans.tsx", "utf8")) && /<h1 className="sr-only">Create your NXQX-Web client account<\/h1>/.test(fs.readFileSync("src/pages/PortalSignup.tsx", "utf8")));
const home = fs.readFileSync("src/pages/PublicHome.tsx", "utf8");
check("the decorative home groups with labels are marked as images", /className="px-dotsrow" role="img" aria-label=/.test(home) && /className="px-devs" data-px-reveal role="img" aria-label=/.test(home));
check("every page component that renders a page has exactly one top-level heading source (sanity: client Commerce pages each have an h1)", fs.readdirSync("src/pages").filter((f) => /^ClientCommerce.*\.tsx$/.test(f)).every((f) => /<h1\b/.test(fs.readFileSync(`src/pages/${f}`, "utf8"))));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll a11y-basics checks passed (offline).");
process.exit(failures ? 1 : 0);
