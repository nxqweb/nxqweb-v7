// Offline test: the store "showcase" layout (top menu, big-logo hero, section title, four-across grid), written for the candle client's mockup (2026-11-21).
// It turns on ONLY for a store whose owner saved a look with a logo; every other store keeps the plain layout.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const page = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const css = fs.readFileSync("src/styles/storefront-theme.css", "utf8");
const info = fs.readFileSync("src/components/StoreWebsiteSections.tsx", "utf8");
const start = css.indexOf("/* Showcase layout:");
const nextComment = css.indexOf("\n/* ", start + 10); // other features may add CSS after this block (for example the parked shipping screens)
const block = css.slice(start, nextComment === -1 ? undefined : nextComment);

check("the layout switches on only when the saved look has a logo", page.includes('data-showcase={branding?.logo ? "true" : undefined}'));
check("the menu, fixed background logo, hero title and section title are rendered only for that case", (page.match(/branding\?\.logo \? <nav className="store-nav"/g) || []).length === 1 && page.includes('{branding?.logo ? <div className="store-bg-logo" aria-hidden="true">') && page.includes('{branding?.logo ? <h2 className="store-hero-title">') && page.includes("{branding?.logo && data.products.length > 0 ? <h2 className=\"store-section-title\""));
check("the menu has Home, Shop, About and Contact, each pointing at a real anchor on the page", ['<a href="#top">Home</a>', '<a href="#products">Shop</a>', '<a href="#store-about">About</a>', '<a href="#store-about">Contact</a>'].every((l) => page.includes(l)) && page.includes('id="top"') && page.includes('id="products"') && info.includes('id="store-about"'));
check("the background logo is decorative (empty alt) and the page still has exactly one h1", /<img src=\{[^}]*\} data-cutout=\{[^}]*\} alt=""/.test(page) && page.includes('aria-hidden="true"') && (page.match(/<h1>/g) || []).length === 1);
check("every showcase style is scoped to [data-showcase], so other stores are untouched", block.split("\n").filter((l) => /^\.store-theme/.test(l) || /^  \.store-theme/.test(l)).every((l) => /data-showcase|store-nav|store-section-title/.test(l)));
check("the products sit four across on a wide screen, one across on a phone", /\.store-product-grid \{ grid-template-columns: repeat\(auto-fill, minmax\(210px, 1fr\)\)/.test(block) && /@media \(max-width: 860px\)/.test(block) && /\.store-hero \{ min-height: 0; gap: 14px; \}/.test(block) && /\.store-hero-copy \{ grid-area: 2 \/ 1; width: 100%; \}/.test(block));
check("a logo saved on a white background blends into the page, and an older grid rule on the header is overridden", block.includes("mix-blend-mode: multiply") && block.includes("var(--store-bg, #faf6ef) !important") && block.includes("display: flex !important"));
check("menu links are at least 40px tall and the cart, checkout and payment code is not touched", block.includes("min-height: 40px") && !/create_public|placeOrder|checkout/i.test(block));
check("motion and layout stay safe: no animation added, no fixed widths that can overflow a phone", !/animation|@keyframes/.test(block) && !/width: [0-9]{4,}px/.test(block));

check("the search icon and bar exist only for showcase stores, the search is client-side, and an empty result says so", page.includes('{branding?.logo ? <button className="icon-btn store-search-btn" type="button" aria-label="Search products"') && page.includes('{branding?.logo && searchOpen ? <div className="store-search" role="search">') && page.includes("const needle = branding?.logo ? query.trim().toLowerCase() : \"\";") && page.includes('data-testid="store-search-empty"') && !/rpc\([^)]*query/.test(page));
check("the header shows the logo's icon alone when one was found, and the search styles are scoped to showcase", page.includes('data-mark={logoCut && logoCut.source === branding.logo && logoCut.mark ? "true" : undefined}') && css.includes('.store-theme[data-showcase] .store-logo[data-mark]') && css.includes(".store-theme .store-search-btn, .store-theme .store-search { display: none; }"));
check("the logo is a fixed full-page background behind the content (page scrolls over it), only for showcase stores", /\.store-theme\[data-showcase\] \.store-bg-logo \{ display: flex; position: fixed; inset: 0; z-index: 0;/.test(css) && css.includes(".store-theme .store-bg-logo { display: none; }") && css.includes(".store-theme[data-showcase] .portal-shell { position: relative; z-index: 1; }") && /pointer-events: none/.test(css.slice(css.indexOf(".store-bg-logo { display: flex")))); 

check("the background logo is full strength and crisp; only the cards blur what is behind them (frosted glass)", /\.store-bg-logo img \{ opacity: 1; filter: none;/.test(css) && /backdrop-filter: blur\(22px\)/.test(css) && !/\.store-bg-logo img \{[^}]*filter: blur/.test(css));

check("on a computer the cleaned logo is also capped at 44% of the screen width and 600px, and lined up with the page column on wide screens, so a big sharp logo stays in the hero's right half instead of spilling over the products (phones keep their own rule)", /@media \(min-width: 861px\) \{ \.store-theme\[data-showcase\] \.store-bg-logo img\[data-cutout\] \{ width: min\(var\(--showcase-logo-size\), 44vw, 600px\); \} main\.store-theme\[data-showcase\] \.store-bg-logo \{ padding-right: max\(7vw, calc\(\(100vw - 1200px\) \/ 2\)\); \} \}/.test(css));
check("the background logo is capped at a crisp size through one setting (--showcase-logo-size) that can be raised for a sharper file", css.includes("--showcase-logo-size: 460px;") && css.includes("width: min(var(--showcase-logo-size), 82vw)"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store showcase checks passed (offline).");
process.exit(failures ? 1 : 0);
