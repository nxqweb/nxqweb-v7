// Offline test: every internal link in the app points at a page that really exists. The router sends unknown /client/..., /owner/... and
// /portal/... links back to the base page without any message, so a typo in a link looks like "the button does nothing". This finds them.
import fs from "node:fs";
import path from "node:path";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const app = fs.readFileSync("src/App.tsx", "utf8");
const exact = new Set([...app.matchAll(/path === "([^"]+)"/g)].map((m) => m[1]));
const regexes = [...app.matchAll(/if \((\/\^[^\n]*?\$\/)\.test\(path\)\)/g)].map((m) => { try { return new Function(`return ${m[1]}`)(); } catch { return null; } }).filter(Boolean);
exact.add("/");

function exists(href) {
  const clean = href.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
  if (exact.has(clean)) return true;
  return regexes.some((re) => re.test(clean));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
const files = walk("src").filter((f) => !f.endsWith(".test.ts"));

const found = [];
const patterns = [
  /href=["'](\/[^"'$`{}\s]*)["']/g,               // href="/x"
  /href:\s*["'](\/[^"'$`{}\s]*)["']/g,            // { href: "/x" }
  /(?:window\.)?location\.(?:href|replace|assign)\s*(?:=|\()\s*["'](\/[^"'$`{}\s]*)["']/g, // location.href = "/x"
  /href=\{\s*["'](\/[^"'$`{}\s]*)["']\s*\}/g,
];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const re of patterns) for (const m of text.matchAll(re)) found.push({ file, href: m[1] });
}
// links built from a base path plus a suffix are checked by their literal base only
const internal = found.filter(({ href }) => !href.startsWith("//") && !/\.(png|svg|webp|jpg|ico|json|txt|xml|css|js)$/.test(href));
const broken = internal.filter(({ href }) => !exists(href));
const uniq = [...new Set(broken.map((b) => `${b.href}  (${b.file})`))];

check("the route table was read (sanity: dozens of exact routes and the store matchers)", exact.size > 50 && regexes.length >= 2, `exact=${exact.size} regex=${regexes.length}`);
check("links were found (sanity: the scan is not empty)", internal.length > 150, String(internal.length));
check("every internal link points at a page that exists", uniq.length === 0, uniq.slice(0, 8).join(" | "));

// the Commerce menu and the plan-change page must list only real Commerce pages
const nav = fs.readFileSync("src/components/CommerceNav.tsx", "utf8");
check("every Commerce menu link is a real route", [...nav.matchAll(/href: "([^"]+)"/g)].every((m) => exists(m[1])));

// reserved store paths must stay ahead of the generic /store/<slug> matcher
const order = ['path === "/store/checkout"', 'path === "/store/request"', "/^\\/store\\/[^/]+\\/?$/.test(path)"];
check("reserved store routes are checked before the generic store matcher", order.every((s) => app.includes(s)) && app.indexOf(order[0]) < app.indexOf(order[2]) && app.indexOf(order[1]) < app.indexOf(order[2]));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll link-integrity checks passed (offline).");
process.exit(failures ? 1 : 0);
