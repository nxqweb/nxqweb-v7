// Offline test: the public store's pure rules (photos, prices, sales, stock limits, the cart, the checkout form, plain-words order errors).
import fs from "node:fs";
import {
  addLine, cartCount, cartNeedsShipping, cartStorageKey, cartTotal, changeLine, firstSentence, friendlyCheckoutError, genericCheckoutError, isPurchasable, lowStockThreshold,
  maxCartLines, maxQuantityPerLine, priceSummary, productHash, productImages, productInStock, restoreCart, saleInfo, serializeCart, slugFromHash, stockLabel, validateCheckout, variantStock,
} from "../src/lib/storeCatalog.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const v = (id, price, available, policy = "deny", title = "Default") => ({ id, title, price, available_quantity: available, inventory_policy: policy });
const p = (id, name, variants, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), base_price: variants[0]?.price ?? 0, variants, ...extra });

// ---- photos
check("photos: https only, unique, first the list then the main image, at most 8", (() => {
  const list = productImages({ image_url: "https://x.co/a.jpg", image_urls: ["https://x.co/b.jpg", "http://x.co/no.jpg", "javascript:alert(1)", 5, "https://x.co/a.jpg", " https://x.co/c.jpg "] });
  return list.join() === "https://x.co/b.jpg,https://x.co/a.jpg,https://x.co/c.jpg";
})() && productImages({ image_url: null, image_urls: "nope" }).length === 0 && productImages({ image_urls: Array.from({ length: 12 }, (_, i) => `https://x.co/${i}.jpg`) }).length === 8);

// ---- price and sale
check("price: from-to across options, and single price when equal", (() => {
  const a = priceSummary(p("a", "A", [v("1", 18, 5), v("2", 24, 5)])); const b = priceSummary(p("b", "B", [v("3", 9, 5)])); const c = priceSummary({ base_price: 7, variants: [] });
  return a.from === 18 && a.to === 24 && a.varies && b.varies === false && b.from === 9 && c.from === 7 && !c.varies;
})());
check("sale: only when the compare price is higher, with a rounded percent off", saleInfo(p("a", "A", [v("1", 15, 5)], { compare_at_price: 20 })).percentOff === 25 && saleInfo(p("a", "A", [v("1", 15, 5)], { compare_at_price: 20 })).onSale
  && !saleInfo(p("a", "A", [v("1", 15, 5)], { compare_at_price: 15 })).onSale && !saleInfo(p("a", "A", [v("1", 15, 5)], { compare_at_price: null })).onSale && !saleInfo(p("a", "A", [v("1", 15, 5)], { compare_at_price: -4 })).onSale && !saleInfo(p("a", "A", [v("1", 0, 5)], { compare_at_price: 10 })).onSale
  && saleInfo(p("a", "A", [v("1", 99, 5)], { compare_at_price: 100 })).percentOff === 1);

// ---- stock
check("stock: sold out, low stock and the maximum a customer can add", variantStock(v("1", 5, 0)).soldOut && variantStock(v("1", 5, -3)).soldOut && variantStock(v("1", 5, 2)).low === 2 && variantStock(v("1", 5, 2)).max === 2
  && variantStock(v("1", 5, lowStockThreshold + 1)).low === null && variantStock(v("1", 5, 500)).max === maxQuantityPerLine && variantStock(v("1", 5, "x")).soldOut);
check("stock: when backorders are allowed nothing is ever sold out", !variantStock(v("1", 5, 0, "continue")).soldOut && variantStock(v("1", 5, 0, "continue")).max === maxQuantityPerLine);
check("stock labels read plainly and a product is in stock when any option is", stockLabel(v("1", 5, 0)) === "Sold out" && stockLabel(v("1", 5, 2)) === "Only 2 left" && stockLabel(v("1", 5, 10)) === "" && productInStock(p("a", "A", [v("1", 5, 0), v("2", 5, 3)])) && !productInStock(p("a", "A", [v("1", 5, 0)])) && !productInStock(p("a", "A", [])) && isPurchasable(v("1", 5, 1)));

// ---- cart
const A = p("pa", "Vanilla", [v("va", 12, 2)]); const B = p("pb", "Soap", [v("vb", 9, 10), v("vc", 11, 0)]);
check("cart: adding stops at the stock and says so", (() => {
  let r = addLine([], A, A.variants[0]); r = addLine(r.cart, A, A.variants[0]); const third = addLine(r.cart, A, A.variants[0]);
  return r.cart[0].quantity === 2 && !r.capped && third.capped && third.cart[0].quantity === 2 && addLine([], B, B.variants[1]).capped && addLine([], B, B.variants[1]).cart.length === 0;
})());
check("cart: plus stops at stock, minus removes at zero, other lines are untouched", (() => {
  let c = addLine([], A, A.variants[0]).cart; c = addLine(c, B, B.variants[0]).cart;
  const up = changeLine(c, "va", +5); const down = changeLine(c, "va", -1); const other = changeLine(c, "vb", +1);
  return up.cart.find((l) => l.variant.id === "va").quantity === 2 && up.capped && down.cart.length === 1 && down.cart[0].variant.id === "vb" && other.cart.find((l) => l.variant.id === "vb").quantity === 2 && other.cart.find((l) => l.variant.id === "va").quantity === 1;
})());
check("cart: a line whose stock dropped to zero is removed when changed", changeLine([{ product: A, variant: v("va", 12, 0), quantity: 1 }], "va", 1).cart.length === 0);
check("cart: at most 25 different items", (() => { let c = []; for (let i = 0; i < 30; i++) { const prod = p(`p${i}`, `P${i}`, [v(`v${i}`, 1, 5)]); c = addLine(c, prod, prod.variants[0]).cart; } return c.length === maxCartLines && addLine(c, A, A.variants[0]).capped; })());
check("cart totals and counts", (() => { let c = addLine([], B, B.variants[0]).cart; c = addLine(c, B, B.variants[0]).cart; c = addLine(c, A, A.variants[0]).cart; return cartCount(c) === 3 && Math.abs(cartTotal(c) - 30) < 1e-9; })());
check("cart: shipping is needed unless every product says it does not need it", cartNeedsShipping([{ product: A, variant: A.variants[0], quantity: 1 }]) && !cartNeedsShipping([{ product: { ...A, requires_shipping: false }, variant: A.variants[0], quantity: 1 }]) && cartNeedsShipping([{ product: { ...A, requires_shipping: false }, variant: A.variants[0], quantity: 1 }, { product: B, variant: B.variants[0], quantity: 1 }]));

// ---- remembering the cart in the browser
check("saved cart keeps only ids and quantities, never prices", (() => { const s = serializeCart(addLine([], A, A.variants[0]).cart); return s === '[{"v":"va","q":1}]' && !/price|12/.test(s); })());
check("restoring: unknown items dropped, quantity capped to current stock, duplicates ignored, junk ignored", (() => {
  const raw = JSON.stringify([{ v: "va", q: 9 }, { v: "gone", q: 1 }, { v: "vb", q: 0 }, { v: "vb", q: 2.9 }, { v: "vb", q: 1 }, null, "x", { v: 5, q: 1 }, { v: "vc", q: 1 }]);
  const r = restoreCart(raw, [A, B]);
  return r.length === 2 && r[0].variant.id === "va" && r[0].quantity === 2 && r[1].variant.id === "vb" && r[1].quantity === 2;
})() && restoreCart("not json", [A]).length === 0 && restoreCart('{"a":1}', [A]).length === 0 && restoreCart(null, [A]).length === 0
  && restoreCart(JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ v: "va", q: 1 }))), [A]).length === 1);
check("each store has its own saved cart key", cartStorageKey("shop-a") !== cartStorageKey("shop-b") && cartStorageKey("shop-a").includes("shop-a"));

// ---- checkout form
check("checkout: name and a real-looking email are required; address only when shipping", (() => {
  const ok = validateCheckout({ name: "Jo", email: "jo@x.co", phone: "", address: "1 Main" }, true);
  const empty = validateCheckout({ name: " ", email: "", phone: "", address: "" }, true);
  const badMail = validateCheckout({ name: "Jo", email: "jo@x", phone: "", address: "x" }, true);
  const noShip = validateCheckout({ name: "Jo", email: "jo@x.co", phone: "", address: "" }, false);
  return Object.keys(ok).length === 0 && empty.name && empty.email && empty.address && badMail.email && Object.keys(noShip).length === 0;
})());

// ---- plain-words order errors
check("order errors: clear server sentences are kept, technical text becomes one calm sentence", friendlyCheckoutError("Vanilla Candle does not have enough available stock for the requested quantity.").startsWith("Vanilla Candle")
  && friendlyCheckoutError("A product in this cart is no longer available.") === "A product in this cart is no longer available." && friendlyCheckoutError("Storefront is not available.") === "This store is not taking orders right now."
  && friendlyCheckoutError("Customer name and email are required.") === "Please enter your name and email."
  && friendlyCheckoutError('duplicate key value violates unique constraint "commerce_orders_pkey"') === genericCheckoutError && friendlyCheckoutError(null) === genericCheckoutError && friendlyCheckoutError("") === genericCheckoutError && friendlyCheckoutError("permission denied for table commerce_orders") === genericCheckoutError);
check("every kept server sentence really exists in a migration (so the list cannot drift)", (() => {
  const sql = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  return ["A product in this cart is no longer available.", "A selected product option is no longer available.", "A cart item is no longer available.", "Enter a valid customer email address.", "Each cart quantity must be between 1 and 99.", "Your cart must contain between 1 and 25 different items.", "Checkout session is invalid. Please refresh and try again.", "Storefront is not available.", "This storefront does not have a direct payment method available."].every((m) => sql.includes(m));
})());

// ---- text helpers
check("first sentence for the hero: stops at the sentence end, trims, cuts long text on a word", firstSentence("Small-batch candles. Made in Sacramento.") === "Small-batch candles." && firstSentence("  Hello   world  ") === "Hello world" && firstSentence("") === ""
  && firstSentence("word ".repeat(60)).endsWith("…") && firstSentence("word ".repeat(60)).length <= 140 && firstSentence("Wow! Great.") === "Wow!");
check("product links in the address bar round-trip and refuse anything odd", productHash("vanilla-candle") === "#product-vanilla-candle" && slugFromHash("#product-vanilla-candle") === "vanilla-candle" && slugFromHash("#product-<script>") === "" && slugFromHash("#other") === "" && slugFromHash("") === "");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store-catalog checks passed (offline).");
process.exit(failures ? 1 : 0);
