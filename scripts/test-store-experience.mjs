// Offline test: the public store behaves like a real shop. Product cards and the detail dialog (photos, options, accessibility), cart limits and
// memory, checkout form help, plain error text, sharing, loading state, reduced motion, and readable colours for every new badge and message.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const page = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const card = fs.readFileSync("src/components/store/StoreProductCard.tsx", "utf8");
const dialog = fs.readFileSync("src/components/store/StoreProductDialog.tsx", "utf8");
const skeleton = fs.readFileSync("src/components/store/StoreSkeleton.tsx", "utf8");
const css = fs.readFileSync("src/styles/storefront-theme.css", "utf8");

// ---- product card
check("the card shows a sale badge, a low-stock badge and a sold-out badge", /store-badge-sale">\{sale\.percentOff\}% off/.test(card) && /store-badge-low">\{lowest\.label\}/.test(card) && /store-badge-soldout">Sold out/.test(card));
check("a one-option product adds straight to the cart, a many-option product opens the choices, a sold-out one is disabled", /single \? <button className="wide-btn" type="button" onClick=\{\(\) => onAdd\(product, single\)\}>Add to cart/.test(card) && /onClick=\{\(\) => onOpen\(product\)\}>Choose options/.test(card) && /<button className="wide-btn" type="button" disabled>Sold out<\/button>/.test(card));
check("the photo and the name both open the product, and the photo is decorative (the name already says what it is)", /className="store-product-open" onClick=\{\(\) => onOpen\(product\)\} aria-label=\{`View \$\{product\.name\}`\}/.test(card) && /className="store-name-button" onClick=\{\(\) => onOpen\(product\)\}/.test(card) && /<img className="store-product-photo" src=\{photo\} alt="" loading="lazy" \/>/.test(card));
check("a sale price shows the old price struck through with a spoken 'was' label", /<s className="store-compare-price" aria-label=\{`was /.test(card) && /price\.varies \? <span>From <strong>/.test(card));

// ---- detail dialog
check("the detail view is a real modal dialog with a title, a close button and backdrop-click to close", /<dialog[\s\S]{0,200}aria-labelledby=\{titleId\}/.test(dialog) && /dialog\.showModal\(\)/.test(dialog) && /aria-label="Close"/.test(dialog) && /event\.target === ref\.current\) ref\.current\?\.close\(\)/.test(dialog) && /onClose=\{onClose\}/.test(dialog));
check("the dialog does not close itself from an effect cleanup (that un-selected the product when React re-ran effects)", !/return \(\) => \{[^}]*\.close\(\)/.test(dialog));
check("the gallery has previous and next buttons, labelled thumbnails with the current one marked, arrow keys, and descriptive photo text", /aria-label="Previous photo"/.test(dialog) && /aria-label="Next photo"/.test(dialog) && /aria-label=\{`Show photo \$\{index \+ 1\} of \$\{images\.length\}`\} aria-current=\{index === photo \? "true" : undefined\}/.test(dialog) && /event\.key === "ArrowRight"/.test(dialog) && /event\.key === "ArrowLeft"/.test(dialog) && /alt=\{`\$\{product\.name\}, photo \$\{photo \+ 1\} of \$\{images\.length\}`\}/.test(dialog));
check("options are a labelled radio group, a sold-out option is disabled, and Add to cart needs an available option", /<fieldset className="store-options">\s*<legend>Choose an option<\/legend>/.test(dialog) && /type="radio"[\s\S]{0,160}disabled=\{sold\}/.test(dialog) && /disabled=\{!selected \|\| !isPurchasable\(selected\)\}/.test(dialog) && /onAdd\(product, selected\); ref\.current\?\.close\(\)/.test(dialog));
check("a product with only a 'Default' option shows no option chooser", /const showOptions = variants\.length > 1 \|\| \(variants\.length === 1 && variants\[0\]\.title\.trim\(\)\.toLowerCase\(\) !== "default"\)/.test(dialog));

// ---- the page: cart rules
check("adding and changing quantities go through the stock-aware rules and say so when the limit is hit", /addLine\(cart, product, variant\)/.test(page) && /changeLine\(cart, variantId, delta\)/.test(page) && (page.match(/That is all we have in stock right now\./g) || []).length === 2 && /disabled=\{item\.quantity >= max\}/.test(page));
check("the cart is remembered per store in this browser, restored against fresh store data, and failure to store never breaks the page", /restoreCart\(window\.localStorage\.getItem\(cartStorageKey\(slug\)\), data\.products\)/.test(page) && /serializeCart\(cart\)/.test(page) && /catch \{ \/\* private browsing/.test(page) && /catch \{ \/\* cosmetic \*\//.test(page) && /if \(!data \|\| cartReady\) return;/.test(page));
check("a product link in the address bar opens that product; the back button and closing keep the address clean", /window\.addEventListener\("hashchange", onHash\)/.test(page) && /window\.history\.replaceState\(null, "", productHash\(product\.slug\)\)/.test(page) && /replaceState\(null, "", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/.test(page) && /slugFromHash\(window\.location\.hash\)/.test(page));
check("each line can be removed, and the page announces cart messages politely", /aria-label=\{`Remove \$\{item\.product\.name\} from the cart`\}/.test(page) && /role="status" aria-live="polite" data-testid="store-toast"/.test(page));

// ---- checkout
check("the details are checked before the order is sent, the first problem box gets focus, and each message is tied to its box", /validateCheckout\(form, needsShipping\)/.test(page) && /document\.getElementById\(`field-\$\{first\}`\)\?\.focus\(\)/.test(page) && /aria-invalid=\{fieldErrors\.name \? true : undefined\} aria-describedby=\{fieldErrors\.name \? "err-name" : undefined\}/.test(page) && /id="field-name"/.test(page) && /id="field-email"/.test(page) && /id="field-address"/.test(page));
check("checkout is a real form (Enter works) with required and optional boxes labelled, and the address is only required when something ships", /<form className="panel panel-wide" noValidate onSubmit=\{\(event\) => \{ event\.preventDefault\(\); if \(orderMode\.mode === "email"\) sendEmailOrder\(\); else void placeOrder\(\); \}\}>/.test(page) && /needsShipping \? <em className="required-mark">\(required\)<\/em> : <em className="optional-tag">\(not needed for pickup items\)<\/em>/.test(page) && /type="submit"/.test(page));
check("customers never see raw server text: order failures go through the plain-words helper", /setError\(friendlyCheckoutError\(result\.error\.message\)\)/.test(page) && !/setError\(result\.error\.message\)/.test(page));

// ---- extras
check("a Share button uses the phone's share sheet, or copies the link and says so", /typeof navigator\.share === "function"\) await navigator\.share\(\{ title: data\.store\.name, url \}\)/.test(page) && /showToast\("Store link copied\."\)/.test(page) && /aria-label="Share this store"/.test(page));
check("the hero shows the first sentence of the shop's About, or a plain default, with a Shop now link", /firstSentence\(profile\.about\) : "Order directly from the shop\."/.test(page) && /href="#products"/.test(page) && /id="products"/.test(page));
check("loading shows a placeholder skeleton that tells screen readers it is loading, and a failed load offers a calm message", /if \(loading\) return <StoreSkeleton \/>/.test(page) && /aria-busy="true"/.test(skeleton) && /role="status">Loading the store/.test(skeleton) && /If a shop gave you this link, please check back soon\./.test(page));
check("no raw HTML is ever injected into the store", ![page, card, dialog].some((t) => /dangerouslySetInnerHTML/.test(t)));

// ---- motion and colour
check("motion respects 'reduce motion': skeleton shimmer, photo zoom and smooth scrolling all switch off", (css.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length >= 3 && /animation: none/.test(css) && /scroll-behavior: auto/.test(css));
check("native controls use a light scheme so radios and scrollbars match the store", /\.store-theme, \.store-theme \.store-dialog \{ color-scheme: light; \}/.test(css));
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rule = (sel, prop) => { const m = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*?${prop}: (#[0-9a-fA-F]{6})`)); return m ? m[1] : null; };
const pairs = [
  ["low-stock badge", rule(".store-theme .store-badge-low", "color"), rule(".store-theme .store-badge-low", "background")],
  ["sold-out badge", rule(".store-theme .store-badge-soldout", "color"), rule(".store-theme .store-badge-soldout", "background")],
  ["toast", rule(".store-theme .store-toast", "color"), rule(".store-theme .store-toast", "background")],
];
for (const [label, fg, bg] of pairs) check(`contrast of the ${label} is at least 4.5:1`, Boolean(fg && bg) && ratio(fg, bg) >= 4.5, `${fg} on ${bg}`);
check("contrast of the field error and the stock note text on white is at least 4.5:1", ratio(rule(".store-theme .store-field-error", "color"), "#ffffff") >= 4.5 && ratio(rule(".store-theme .store-stock-note", "color"), "#ffffff") >= 4.5);
check("the sale badge is white text on the brand brown, which passes", /\.store-theme \.store-badge-sale \{ background: var\(--store-accent\); color: #fff !important; \}/.test(css));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store-experience checks passed (offline).");
process.exit(failures ? 1 : 0);
