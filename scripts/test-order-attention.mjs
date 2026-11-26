// Offline test: the Commerce dashboard tells the owner, in plain words, which orders need action (practice orders never count), and a
// store with no products shows a friendly "opening soon" message. Email alerts need a verified domain, so the dashboard is the alert.
import fs from "node:fs";
import { orderAttentionMessage, summarizeOrderAttention } from "../src/lib/orderAttention.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const orders = [
  { payment_status: "pending", fulfillment_status: "new", is_test: false },
  { payment_status: "pending", fulfillment_status: "new", is_test: false },
  { payment_status: "paid", fulfillment_status: "processing", is_test: false },
  { payment_status: "paid", fulfillment_status: "shipped", is_test: false },
  { payment_status: "paid", fulfillment_status: "delivered", is_test: false },
  { payment_status: "pending", fulfillment_status: "cancelled", is_test: false },
  { payment_status: "pending", fulfillment_status: "new", is_test: true },
];
const a = summarizeOrderAttention({ orders });
check("unpaid open orders count as waiting for payment confirmation", a.awaitingPayment === 2, JSON.stringify(a));
check("paid orders that are not shipped yet count as ready to ship", a.toShip === 1, JSON.stringify(a));
check("shipped, delivered and cancelled orders need no action", a.awaitingPayment + a.toShip === 3);
check("only real waiting states count: failed, refunded, partially refunded and practice-pending payments never tell the owner to act", ["failed", "refunded", "partially_refunded", "test_pending"].every((p) => { const r = summarizeOrderAttention({ orders: [{ payment_status: p, fulfillment_status: "new", is_test: false }] }); return r.awaitingPayment === 0 && r.toShip === 0; }));
check("a paid order that is ready for pickup needs no more action from the owner", summarizeOrderAttention({ orders: [{ payment_status: "paid", fulfillment_status: "ready_for_pickup", is_test: false }] }).toShip === 0 && summarizeOrderAttention({ orders: [{ payment_status: "paid", fulfillment_status: "processing", is_test: false }] }).toShip === 1);
check("practice (test) orders never count", summarizeOrderAttention({ orders: [{ payment_status: "pending", fulfillment_status: "new", is_test: true }] }).awaitingPayment === 0 && a.total === 6);
check("missing, null or malformed data gives zeros and never crashes", JSON.stringify(summarizeOrderAttention(null)) === JSON.stringify({ awaitingPayment: 0, toShip: 0, total: 0 }) && summarizeOrderAttention({ orders: "x" }).total === 0 && summarizeOrderAttention({ orders: [null, 5, {}] }).awaitingPayment === 0);
check("plain-words message: singular, plural, both, none", orderAttentionMessage({ awaitingPayment: 1, toShip: 0, total: 1 }) === "1 order is waiting for you to confirm payment."
  && orderAttentionMessage({ awaitingPayment: 2, toShip: 0, total: 2 }) === "2 orders are waiting for you to confirm payment."
  && orderAttentionMessage({ awaitingPayment: 1, toShip: 3, total: 4 }) === "1 order is waiting for you to confirm payment and 3 paid orders are ready to ship."
  && orderAttentionMessage({ awaitingPayment: 0, toShip: 0, total: 0 }) === "No orders are waiting for you right now.");

const dash = fs.readFileSync("src/pages/ClientCommerceDashboard.tsx", "utf8");
check("the dashboard asks for orders with the existing owner function and shows the card with a link to Orders", /supabase\.rpc\("get_my_commerce_orders"\)/.test(dash) && /data-testid="orders-waiting-card"/.test(dash) && /href="\/client\/commerce\/orders"/.test(dash) && /orderAttentionMessage\(orderAttention\)/.test(dash));
check("orders load in the background, only once a store exists, and a failure only hides the card", /if \(\(catalogResult\.data as CatalogSummary \| null\)\?\.storefront\) void loadOrderAttention\(\);\s*setLoading\(false\);/.test(dash) && /async function loadOrderAttention\(\) \{[\s\S]{0,300}if \(!ordersResult\.error\) setOrderAttention\(summarizeOrderAttention\(ordersResult\.data\)\);[\s\S]{0,120}catch \{ \/\* the card simply stays hidden \*\/ \}/.test(dash) && !/await supabase\.rpc\("get_my_commerce_orders"\)[\s\S]{0,40}setLoading/.test(dash));
check("the setup section no longer talks about a build and migration plan and says only the store name is required", !/build and migration plan/.test(dash) && /Only the store name is required/.test(dash) && /Open store setup form/.test(dash));
const store = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
check("an empty store says it is opening soon instead of a technical line", /Our shop is opening soon\./.test(store) && /New products are on the way\. Please check back soon\./.test(store) && !/No products are live yet/.test(store));
check("the empty message is styled for the store theme", /\.store-empty/.test(fs.readFileSync("src/styles/storefront-theme.css", "utf8")));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll order-attention checks passed (offline).");
process.exit(failures ? 1 : 0);
