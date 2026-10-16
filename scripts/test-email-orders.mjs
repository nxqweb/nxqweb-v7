// Offline test: "order by email" stores. The email text and link are built safely (nothing a customer types can add mail fields), an unusable setup
// falls back to normal online ordering, and the pages and database draft are wired together.
import fs from "node:fs";
import { buildEmailOrder, emailOrderHref, maxMailtoLength, orderModeFromRow } from "../src/lib/emailOrder.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const line = (name, title, price, quantity) => ({ product: { id: name, name, slug: name, base_price: price, variants: [] }, variant: { id: `${name}-${title}`, title, price, available_quantity: 9, inventory_policy: "deny" }, quantity });
const input = (extra = {}) => ({
  storeName: "Light of the World", currency: "USD", needsShipping: true, note: "",
  lines: [line("Vanilla Bean Candle", "Default", 18, 2), line("Lavender Soap", "Large", 7.5, 1)],
  customer: { name: "Sam Customer", email: "sam@example.com", phone: "555 0100", address: "1 Main St, Town" }, ...extra,
});

// ---- mode
check("online is the default for anything unexpected", ["online", null, undefined, 5, {}, { order_mode: "weird" }].every((row) => orderModeFromRow(typeof row === "string" ? { order_mode: row } : row).mode === "online"));
check("email mode needs a valid contact email, otherwise it falls back to online", orderModeFromRow({ order_mode: "email", contact_email: "shop@example.com" }).mode === "email" && ["", "nope", "a@b", "x@y.com?bcc=evil@e.com", "x@y.com&bcc=e@e.com", "a b@c.com"].every((e) => orderModeFromRow({ order_mode: "email", contact_email: e }).mode === "online"));

// ---- text
const built = buildEmailOrder(input());
check("the email lists every item with quantity and line price, the total, and the customer's details", /2 x Vanilla Bean Candle - \$36\.00/.test(built.body) && /1 x Lavender Soap \(Large\) - \$7\.50/.test(built.body) && /Total: \$43\.50/.test(built.body) && /Name: Sam Customer/.test(built.body) && /Email: sam@example.com/.test(built.body) && /Phone: 555 0100/.test(built.body) && /Ship to: 1 Main St, Town/.test(built.body));
check("the default option name is not shown, the subject names the store", !/\(Default\)/.test(built.body) && built.subject === "Order request for Light of the World");
check("address is left out when nothing ships; phone and note only when given", (() => { const b = buildEmailOrder(input({ needsShipping: false, customer: { name: "A", email: "a@b.co", phone: "", address: "x" } })).body; return !/Ship to/.test(b) && !/Phone:/.test(b) && !/Note:/.test(b); })() && /Note: Gift wrap please/.test(buildEmailOrder(input({ note: "Gift wrap please" })).body));
check("line breaks typed into a name cannot fake extra lines", !/\nTotal: \$1\.00/.test(buildEmailOrder(input({ customer: { name: "Sam\nTotal: $1.00", email: "s@e.co", phone: "", address: "" } })).body));

// ---- link
const href = emailOrderHref("shop@example.com", built.subject, built.body);
check("the link goes to the shop's address with an encoded subject and body", href.startsWith("mailto:shop@example.com?subject=") && href.includes("&body=") && !/\s/.test(href));
check("customer text cannot add recipients or fields to the link", (() => {
  const evil = emailOrderHref("shop@example.com", "S", buildEmailOrder(input({ customer: { name: "x&bcc=evil@e.com", email: "a@b.co?cc=evil@e.com", phone: "", address: "?bcc=evil@e.com" } })).body);
  const query = evil.split("?").slice(1).join("?");
  const parts = query.split("&");
  return parts.length === 2 && parts[0].startsWith("subject=") && parts[1].startsWith("body=") && !/(^|[?&])(bcc|cc)=/.test(query);
})());
check("an invalid shop address gives no link at all", ["", "x", "a@b.com?bcc=e@e.com", "a@b.com,c@d.com"].every((e) => emailOrderHref(e, "s", "b") === ""));
check("a very long order still fits in a link email apps accept", (() => {
  const many = Array.from({ length: 25 }, (_, i) => line(`Candle number ${i} with a long name`, "Option", 10, 3));
  const h = emailOrderHref("shop@example.com", "S", buildEmailOrder(input({ lines: many, note: "n".repeat(900) })).body);
  return h.length <= maxMailtoLength && h.startsWith("mailto:shop@example.com?subject=");
})());

// ---- wiring
const live = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
const pub = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const draft = fs.readFileSync("supabase/migrations/270_store_order_by_email.sql", "utf8");
check("the public store asks the database for the mode and any failure keeps online ordering", /rpc\("get_public_store_order_mode", \{ store_slug_value: slug \}\)/.test(pub) && /catch \{ \/\* online ordering \*\/ \}/.test(pub) && /orderModeFromRow\(result\.data\)/.test(pub));
check("the checkout form sends an email order in email mode and creates an online order otherwise", /if \(orderMode\.mode === "email"\) sendEmailOrder\(\); else void placeOrder\(\);/.test(pub));
check("email mode never calls the online order function", (() => { const start = pub.indexOf("function sendEmailOrder"); const end = pub.indexOf("async function copyEmailOrder"); return start > 0 && end > start && !/create_public_stripe_ready_direct_payment_order/.test(pub.slice(start, end)); })());
check("the shopper can open the email, copy the text, or clear the cart after sending", /data-testid="email-order-link"/.test(pub) && /Copy order text/.test(pub) && /I sent it, clear my cart/.test(pub) && /Nothing is charged and no stock is held/.test(pub));
check("an email built from an old cart is dropped when the cart changes", /useEffect\(\(\) => \{ setEmailOrder\(null\); \}, \[cart\]\)/.test(pub));
check("the Live store page hides the choice when the database does not have it yet", /\{orderMode !== null \? <section[^>]*data-testid="order-mode-panel"/.test(live) && /get_my_store_order_mode/.test(live));
check("email mode needs a contact email before saving, and opening asks first", /Type your contact email in the About and contact box below/.test(live) && /Open this store now\? Customers will be able to see it and send you orders by email/.test(live));
check("email mode hides the payment link boxes and the Open storefront button", /\{orderMode === "email" \? null : <>\s*<label><span>Stripe Payment Link/.test(live) && /\{orderMode === "email" \? null : <button className="wide-btn" disabled=\{busy === "settings"\} onClick=\{\(\) => void save\(true\)\}/.test(live));
check("saving the store name in email mode does not leave an open store closed", /orderMode === "email" && data\.status === "active" && !makeLive/.test(live) && /save_my_store_order_mode", \{ order_mode_value: "email", make_live: true \}/.test(live));
check("the database migration refuses email mode without a contact email and never returns payment links", /Add a contact email before taking orders by email/.test(draft) && !/'(stripe_payment_link|paypal_url|venmo_url)'/.test(draft.slice(draft.indexOf("get_public_store_order_mode"))));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll email-order checks passed (offline).");
process.exit(failures ? 1 : 0);
