// Offline test: the Commerce workspace menu keeps every page reachable, puts the everyday pages first, and becomes one swipeable row on
// phones (it used to stack 15 buttons and push the page content off the first screen).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const nav = fs.readFileSync("src/components/CommerceNav.tsx", "utf8");
const css = fs.readFileSync("src/styles/plan-forms.css", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");

const hrefs = [...nav.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"/g)].map((m) => ({ href: m[1], label: m[2] }));
const expected = ["/client/commerce", "/client/commerce/tutorial", "/client/commerce/products", "/client/commerce/images", "/client/commerce/live", "/client/commerce/orders", "/client/commerce/setup",
  "/client/commerce/inventory", "/client/commerce/categories", "/client/commerce/catalog", "/client/commerce/preview", "/client/commerce/content", "/client/commerce/requests", "/client/commerce/usage", "/client/commerce/readiness"];
check("all 15 pages are still in the menu, none duplicated", hrefs.length === 15 && new Set(hrefs.map((h) => h.href)).size === 15 && expected.every((e) => hrefs.some((h) => h.href === e)), hrefs.map((h) => h.href).join(","));
check("every menu link goes to a real route", hrefs.every((h) => h.href === "/client/commerce" ? app.includes('path === "/client/commerce"') : app.includes(`path === "${h.href}"`)), hrefs.filter((h) => !app.includes(`path === "${h.href}"`)).map((h) => h.href).join(","));
check("everyday pages come first (dashboard, tutorial, products, photos, live store, orders, setup)", hrefs.slice(0, 7).map((h) => h.label).join(",") === "Dashboard,Tutorial,Products,Photos,Live store,Orders,Setup", hrefs.slice(0, 7).map((h) => h.label).join(","));
check("the current page is marked and scrolled into view", /aria-current=\{path === href \? "page" : undefined\}/.test(nav) && /scrollIntoView\(\{ block: "nearest", inline: "center" \}\)/.test(nav) && /catch \{ \/\* cosmetic only \*\/ \}/.test(nav));
check("layout moved into CSS classes (no inline grid that blocks the phone layout)", /className="commerce-nav-grid"/.test(nav) && !/gridTemplateColumns/.test(nav) && /\.commerce-nav-grid \{ display: grid;/.test(css));
check("on phones the menu is one scrollable row with no wrapping", /@media \(max-width: 640px\)[\s\S]*\.commerce-nav-grid \{ display: flex; flex-wrap: nowrap; overflow-x: auto;/.test(css) && /\.commerce-nav-link \{ flex: 0 0 auto;/.test(css));
check("buttons stay at least 44px tall on phones", /\.commerce-nav-link \{ flex: 0 0 auto; min-width: 104px; min-height: 44px;/.test(css));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll commerce-nav checks passed (offline).");
process.exit(failures ? 1 : 0);
