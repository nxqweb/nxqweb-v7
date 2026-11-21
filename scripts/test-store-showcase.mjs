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
check("the menu, big hero logo, hero title and section title are rendered only for that case", (page.match(/branding\?\.logo \? <nav className="store-nav"/g) || []).length === 1 && page.includes('{branding?.logo ? <img className="store-hero-logo" src={') && page.includes('{branding?.logo ? <h2 className="store-hero-title">') && page.includes("{branding?.logo && data.products.length > 0 ? <h2 className=\"store-section-title\""));
check("the menu has Home, Shop, About and Contact, each pointing at a real anchor on the page", ['<a href="#top">Home</a>', '<a href="#products">Shop</a>', '<a href="#store-about">About</a>', '<a href="#store-about">Contact</a>'].every((l) => page.includes(l)) && page.includes('id="top"') && page.includes('id="products"') && info.includes('id="store-about"'));
check("the big logo is decorative (empty alt) and the page still has exactly one h1", /className="store-hero-logo" src=\{[^}]*\} data-cutout=\{[^}]*\} alt=""/.test(page) && (page.match(/<h1>/g) || []).length === 1);
check("every showcase style is scoped to [data-showcase], so other stores are untouched", block.split("\n").filter((l) => /^\.store-theme/.test(l) || /^  \.store-theme/.test(l)).every((l) => /data-showcase|store-nav|store-section-title/.test(l)));
check("the products sit four across on a wide screen, one across on a phone", /\.store-product-grid \{ grid-template-columns: repeat\(auto-fill, minmax\(210px, 1fr\)\)/.test(block) && /@media \(max-width: 860px\)/.test(block) && /\.store-hero \{ min-height: 0; gap: 14px; \}/.test(block) && /\.store-hero-copy \{ grid-area: 2 \/ 1; width: 100%; \}/.test(block));
check("a logo saved on a white background blends into the page, and an older grid rule on the header is overridden", block.includes("mix-blend-mode: multiply") && block.includes("var(--store-bg, #faf6ef) !important") && block.includes("display: flex !important"));
check("menu links are at least 40px tall and the cart, checkout and payment code is not touched", block.includes("min-height: 40px") && !/create_public|placeOrder|checkout/i.test(block));
check("motion and layout stay safe: no animation added, no fixed widths that can overflow a phone", !/animation|@keyframes/.test(block) && !/width: [0-9]{4,}px/.test(block));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store showcase checks passed (offline).");
process.exit(failures ? 1 : 0);
