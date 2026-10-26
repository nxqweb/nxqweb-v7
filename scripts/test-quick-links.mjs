// Offline test: the Quick links cards at the bottom of the client portal home and the Commerce pages (owner request 2026-10-25: "make it super easy to find everything").
// Every card must point at a page that really exists, no page may be missing from its grid, and the footer must not bring back the screen-tall empty gap.
import fs from "node:fs";
import { assistantQuickLink, attentionQuickLink, commerceQuickLinks, portalQuickLinks, quickLinksForPath } from "../src/lib/quickLinks.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const app = read("src/App.tsx");
const component = read("src/components/QuickLinks.tsx");
const nav = read("src/components/CommerceNav.tsx");
const lib = read("src/lib/quickLinks.ts");
const css = read("src/styles/plan-forms.css");

const routes = [...app.matchAll(/path === "(\/client[^"]*)"/g)].map((m) => m[1]);
const portalRoutes = routes.filter((r) => r !== "/client" && r !== "/client/assistant" && r !== "/client/attention" && !r.startsWith("/client/commerce")); // /client/assistant is a conditional card, checked below
const commerceRoutes = routes.filter((r) => r.startsWith("/client/commerce"));
const hrefs = (set) => set.map((l) => l.href);

check("every portal card points at a real route in App.tsx", hrefs(portalQuickLinks).every((h) => routes.includes(h)));
check("every Commerce card points at a real route in App.tsx", hrefs(commerceQuickLinks).every((h) => routes.includes(h)));
check("no client page is missing from the portal grid (a new page must be added to it)", portalRoutes.every((r) => hrefs(portalQuickLinks).includes(r)) && portalRoutes.length === portalQuickLinks.length);
check("no Commerce page is missing from the Commerce grid", commerceRoutes.every((r) => hrefs(commerceQuickLinks).includes(r)) && commerceRoutes.length === commerceQuickLinks.length);
const navHrefs = [...nav.matchAll(/href: "(\/client\/commerce[^"]*)"/g)].map((m) => m[1]);
check("the Commerce grid covers every page in the top Commerce menu", navHrefs.length > 10 && navHrefs.every((h) => hrefs(commerceQuickLinks).includes(h)));
check("the My assistant card exists only when its switch is on, sits among the other cards, and points at a real route", routes.includes("/client/assistant") && assistantQuickLink.href === "/client/assistant" && !hrefs(quickLinksForPath("/client").links).includes("/client/assistant") && hrefs(quickLinksForPath("/client", { assistant: true }).links).filter((h) => h === "/client/assistant").length === 1 && quickLinksForPath("/client", { assistant: true }).links.length === portalQuickLinks.length + 1 && quickLinksForPath("/client/commerce", { assistant: true }).links.length === commerceQuickLinks.length);
check("the footer turns the assistant card on from the one switch in siteAssistantConfig, and the switch is on only through the real gateway when Supabase is configured (migration 278 is applied)", /quickLinksForPath\(path, \{ assistant: Boolean\(siteAssistantGateway\), attention: Boolean\(screenAttentionGateway\) \}\)/.test(component) && /export const siteAssistantGateway: SiteAssistantGateway \| null = supabase \? createSiteAssistantGateway\(supabase\) : null;/.test(read("src/lib/siteAssistantConfig.ts")));
check("addresses are unique within each grid", new Set(hrefs(portalQuickLinks)).size === portalQuickLinks.length && new Set(hrefs(commerceQuickLinks)).size === commerceQuickLinks.length);
check("every card has a short name and a plain-words hint", [...portalQuickLinks, ...commerceQuickLinks].every((l) => l.label.trim().length >= 3 && l.label.length <= 24 && l.hint.trim().length >= 8 && l.hint.length <= 60));

const iconKeys = [...lib.slice(lib.indexOf("export type QuickLinkIcon"), lib.indexOf("export type QuickLinkItem")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
const mapped = [...component.slice(component.indexOf("const icons"), component.indexOf("// Rendered once")).matchAll(/\b([a-z]+): [A-Z][A-Za-z0-9]+/g)].map((m) => m[1]);
check("every icon name used by a card has an icon in the component", [...portalQuickLinks, ...commerceQuickLinks].every((l) => mapped.includes(l.icon)) && iconKeys.every((k) => mapped.includes(k)));

check("the portal home gets the portal grid (with or without a trailing slash)", quickLinksForPath("/client")?.id === "portal" && quickLinksForPath("/client/")?.id === "portal");
check("every Commerce page gets the Commerce grid", quickLinksForPath("/client/commerce")?.id === "commerce" && quickLinksForPath("/client/commerce/orders")?.id === "commerce" && quickLinksForPath("/client/commerce/live/")?.id === "commerce");
check("other pages get no grid (Business pages have their own menu; public and owner pages never)", ["/client/business", "/client/billing", "/", "/plans", "/portal/login", "/owner", "/store/x", "/clientele"].every((p) => quickLinksForPath(p) === null));

check("App renders the footer once, inside the main content, after the page", (app.match(/<QuickLinksFooter \/>/g) || []).length === 1 && /<\/AppErrorBoundary><QuickLinksFooter \/><\/div>/.test(app) && /import \{ QuickLinksFooter \} from "\.\/components\/QuickLinks"/.test(app));
check("the footer never reuses .nxq-page (a full-screen-tall box) or a second <main>", !/className="[^"]*nxq-page/.test(component) && !/<main/.test(component));
check("the grid is a labelled nav with a real heading and links (not buttons)", /<nav aria-labelledby=/.test(component) && /<h2 id=/.test(component) && /<a aria-current=/.test(component) && !/<button/.test(component));
check("the current page's card is marked for screen readers", /aria-current=\{here === href \? "page" : undefined\}/.test(component));
check("cards are at least 44px tall, one column on a phone, and leave room for the floating Report a problem button", /\.quick-link \{[^}]*min-height: 64px/.test(css) && /\.quick-links-grid \{ grid-template-columns: 1fr; \}/.test(css) && /\.quick-links-footer \{ padding: 0 16px 96px; \}/.test(css));

check("in light mode the footer paints its own cream background (it sits outside .nxq-page, which is where the page paints its light background)", /body\[data-nxq-theme="light"\] \.quick-links-footer \{[^}]*background: #f4f1e8/.test(css));

check("the Screen attention map card exists only when its switch is on, sits among the other cards, points at a real route, and the switch is on only through the real gateway when Supabase is configured (migration 279 is applied)", routes.includes("/client/attention") && attentionQuickLink.href === "/client/attention" && !hrefs(quickLinksForPath("/client").links).includes("/client/attention") && hrefs(quickLinksForPath("/client", { attention: true }).links).filter((h) => h === "/client/attention").length === 1 && quickLinksForPath("/client", { attention: true }).links.length === portalQuickLinks.length + 1 && quickLinksForPath("/client", { assistant: true, attention: true }).links.length === portalQuickLinks.length + 2 && /export const screenAttentionGateway: ScreenAttentionGateway \| null = supabase \? createScreenAttentionGateway\(supabase\) : null;/.test(read("src/lib/screenAttentionMapConfig.ts")));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
