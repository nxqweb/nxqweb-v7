// Offline test: public store pages use a light, warm theme that is scoped to those pages only (no leak into the NXQX app), keeps
// product cards aligned even without a photo, stays readable (WCAG contrast), and is mobile-ready.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const css = fs.readFileSync("src/styles/storefront-theme.css", "utf8");
const store = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const account = fs.readFileSync("src/pages/PublicShopperAccount.tsx", "utf8");
const credit = fs.readFileSync("src/components/StoreCredit.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");

// ---- scoping: every selector in the file must live under .store-theme
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes [\w-]+ \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
const preludes = [...bare.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((p) => p && !p.startsWith("@"));
const unscoped = preludes.flatMap((p) => p.split(",").map((x) => x.trim())).filter((sel) => sel && !sel.includes(".store-theme"));
check("every selector is scoped to .store-theme (nothing else in the app changes)", preludes.length > 20 && unscoped.length === 0, unscoped.slice(0, 3).join(" | "));
check("the stylesheet is loaded by the app", /import "\.\/styles\/storefront-theme\.css";/.test(app) && app.indexOf("storefront-theme.css") > app.indexOf("premium-v2.css"));

// ---- pages opt in
const mains = (page) => [...page.matchAll(/<main className="([^"]*)"/g)].map((m) => m[1]);
const skeleton = fs.readFileSync("src/components/store/StoreSkeleton.tsx", "utf8");
check("every main element on the store, its loading skeleton and the shopper account pages uses the theme", mains(store).length >= 2 && mains(store).every((c) => c.includes("store-theme")) && mains(skeleton).length === 1 && mains(skeleton).every((c) => c.includes("store-theme")) && mains(account).length >= 3 && mains(account).every((c) => c.includes("store-theme")));
check("every main element on the public Booking request page uses the theme (customer-facing page, same warm look as the store)", mains(fs.readFileSync("src/pages/PublicBooking.tsx", "utf8")).length >= 3 && mains(fs.readFileSync("src/pages/PublicBooking.tsx", "utf8")).every((c) => c.includes("store-theme")));
check("no other page opts into the store theme", fs.readdirSync("src/pages").filter((f) => f.endsWith(".tsx") && !["PublicCommerceStorefront.tsx", "PublicShopperAccount.tsx", "PublicBooking.tsx"].includes(f)).every((f) => !fs.readFileSync(`src/pages/${f}`, "utf8").includes("store-theme")));

// ---- layout
check("products sit in an equal-card responsive grid", /store-product-grid/.test(store) && /grid-template-columns: repeat\(auto-fill, minmax\(230px, 1fr\)\)/.test(css));
const cardSource = fs.readFileSync("src/components/store/StoreProductCard.tsx", "utf8");
check("a product without a photo gets a placeholder so cards line up", /store-product-photo-empty/.test(cardSource) && /store-product-photo-empty/.test(css) && /aspect-ratio: 4 \/ 3/.test(css));
check("phones get one column and tighter padding", /@media \(max-width: 560px\)/.test(css) && /grid-template-columns: 1fr/.test(css));
check("the credit line is centered and quiet", /store-credit/.test(credit) && /\.store-theme \.store-credit/.test(css) && /Website by NXQX-Web/.test(credit));

// ---- contrast (WCAG): text colours against the surfaces they sit on
const vars = Object.fromEntries([...css.matchAll(/--store-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [["ink on page", vars.ink, vars.bg], ["ink on card", vars.ink, vars.surface], ["muted on card", vars.muted, vars.surface], ["muted on tint (empty states)", vars.muted, vars.tint], ["white on accent (buttons)", "#ffffff", vars.accent], ["white on dark accent (hover)", "#ffffff", vars["accent-dark"]]];
for (const [label, fg, bg] of pairs) check(`contrast ${label} is at least 4.5:1`, Boolean(fg && bg) && ratio(fg, bg) >= 4.5, `${fg} on ${bg} = ${fg && bg ? ratio(fg, bg).toFixed(2) : "?"}`);
check("form labels no longer use the unreadable gold", /label span[\s\S]{0,400}color: var\(--store-ink\) !important/.test(css));

check("links, buttons and menus show a clear focus outline for keyboard users", /\.store-theme a:focus-visible, \.store-theme button:focus-visible, \.store-theme select:focus-visible/.test(css) && /outline: 3px solid var\(--store-accent-dark\)/.test(css));
check("the focus outline color itself passes contrast against the page and cards", ratio(vars["accent-dark"], vars.bg) >= 3 && ratio(vars["accent-dark"], vars.surface) >= 3);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll storefront-theme checks passed (offline).");
process.exit(failures ? 1 : 0);
