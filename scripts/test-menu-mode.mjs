// Offline test: NXQX-Menu v1 ("menu" order mode). A menu shows items with prices and descriptions, never a cart, stock or sold-out labels, and tells the
// customer how to order. It only appears when the database supports it, and an unusable setup falls back to normal online ordering.
import fs from "node:fs";
import { orderModeFromRow } from "../src/lib/emailOrder.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

// ---- mode parsing
check("menu mode with a phone, an email, or both is understood", orderModeFromRow({ order_mode: "menu", contact_phone: "555 0100" }).mode === "menu" && orderModeFromRow({ order_mode: "menu", contact_email: "cafe@example.com" }).mode === "menu" && (() => { const m = orderModeFromRow({ order_mode: "menu", contact_email: "cafe@example.com", contact_phone: "(555) 010-0199" }); return m.mode === "menu" && m.email === "cafe@example.com" && m.phone === "(555) 010-0199"; })());
check("menu with no usable contact falls back to normal online ordering", ["", "abc", "12", "<b>5550100</b>", "555 0100; drop"].every((phone) => orderModeFromRow({ order_mode: "menu", contact_phone: phone }).mode === "online") && orderModeFromRow({ order_mode: "menu", contact_email: "x@y.com?bcc=e@e.com" }).mode === "online" && orderModeFromRow({ order_mode: "menu" }).mode === "online");
check("email mode never carries the phone, and unknown modes are online", orderModeFromRow({ order_mode: "email", contact_email: "a@b.co", contact_phone: "555 0100" }).phone === "" && orderModeFromRow({ order_mode: "buffet", contact_email: "a@b.co" }).mode === "online");

// ---- shopper page
const pub = read("src/pages/PublicCommerceStorefront.tsx");
const card = read("src/components/store/StoreProductCard.tsx");
const dialog = read("src/components/store/StoreProductDialog.tsx");
check("in a menu the grid and the detail view are view-only", /viewOnly=\{orderMode\.mode === "menu"\} \/>/.test(pub) && (pub.match(/viewOnly=\{orderMode\.mode === "menu"\}/g) || []).length === 2);
check("a menu has no cart, no checkout form, no cart bar and no cart link", /\{orderMode\.mode === "menu" \? null : <>\s*<section className="panel panel-wide" id="store-cart"/.test(pub) && /!order && orderMode\.mode !== "menu" && itemCount > 0/.test(pub) && /!order && orderMode\.mode !== "menu" \? <a className="store-cart-link"/.test(pub));
check("a menu tells the customer how to order with call and email links built from the safe helpers", /data-testid="menu-how-to-order"/.test(pub) && /telHref\(orderMode\.phone\)/.test(pub) && /mailtoHref\(orderMode\.email\)/.test(pub) && />\{orderMode\.mode === "menu" \? "See the menu" : "Shop now"\}</.test(pub));
check("menu cards show no stock labels, sold-out badge or button", /!viewOnly && !inStock \? <span className="store-badge store-badge-soldout"/.test(card) && /!viewOnly && inStock && lowest/.test(card) && /\{viewOnly \? null : !inStock \?/.test(card));
check("the menu detail view lists sizes and prices, hides stock notes, and has Close instead of Add to cart", /viewOnly && showOptions \? \(\s*<ul className="menu-options"/.test(dialog) && /\{viewOnly \? null : selected && !isPurchasable\(selected\)/.test(dialog) && /viewOnly \? <button className="wide-btn" type="button" onClick=\{\(\) => ref\.current\?\.close\(\)\}>Close<\/button>/.test(dialog));
check("a normal store is untouched: viewOnly defaults to false", /viewOnly = false/.test(card) && /viewOnly = false/.test(dialog));

// ---- client page
const live = read("src/pages/ClientCommerceLiveStore.tsx");
check("the Menu choice only appears when the database lists it as supported", /setSupportsMenu\(Array\.isArray\(info\.supported_modes\) && info\.supported_modes\.includes\("menu"\)\)/.test(live) && /\{supportsMenu \? <label className="settings-card order-mode-option">/.test(live));
check("menu needs a contact email or phone before saving, and opening asks first", /orderChoice === "menu" && !profile\.contactEmail\.trim\(\) && !profile\.contactPhone\.trim\(\)/.test(live) && /Open your menu now\?/.test(live));
check("a menu hides the payment boxes like email mode", (live.match(/orderMode === "email" \|\| orderMode === "menu"/g) || []).length >= 5);
check("the client page sends the existing function with the same argument names", /rpc\("save_my_store_order_mode", \{ order_mode_value: orderChoice, make_live: makeLive \}\)/.test(live));

// ---- database draft
const draft = read("docs/drafts/migrations/06_store_menu_mode.sql");
check("the draft keeps the function names and argument names of migration 270", /function public\.save_my_store_order_mode\(order_mode_value text, make_live boolean default false\)/.test(draft) && /function public\.get_public_store_order_mode\(store_slug_value text\)/.test(draft) && /function public\.get_my_store_order_mode\(\)/.test(draft));
check("the draft needs an email or a phone for a menu, still needs an email for email mode, and lists supported modes", /Add a contact email or phone so customers know how to order from your menu/.test(draft) && /Add a contact email before taking orders by email/.test(draft) && /'supported_modes'/.test(draft));
check("the public function exposes the phone only for menus and never payment links", /'contact_phone', case when s\.settings ->> 'order_mode' = 'menu' then/.test(draft) && !/stripe_payment_link|paypal_url|venmo_url/.test(draft.replace(/--.*$/gm, "")));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll menu-mode checks passed (offline).");
process.exit(failures ? 1 : 0);
