// Offline test: the printed packing slip on the Orders page (src/lib/packingSlip.ts, src/components/PackingSlip.tsx). The slip must show
// where the order goes and what is in it, treat everything a shopper typed as plain text, and leave the page normal after printing.
import fs from "node:fs";
import { packingSlip } from "../src/lib/packingSlip.ts";
import { deliveryFromRow } from "../src/lib/orderDelivery.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const fmt = (iso) => iso.slice(0, 10);

const order = { order_number: "WICK-AB12CD34", customer_name: "Pat Lee", currency: "USD", subtotal: 36, total: 42.5, placed_at: "2026-11-17T18:00:00Z", items: [{ product_name: "Lavender Candle", variant_title: "8 oz", quantity: 2 }, { product_name: "Wax Melts", variant_title: "Default", quantity: 1 }] };
const ship = deliveryFromRow({ customer_phone: "555-0100", customer_note: "Leave at the door", shipping_address: { address: "1 Test Street\nApt 2\nReno, NV 89501" }, shipping_total: 6.5 });
const slip = packingSlip(order, ship, fmt);
check("the slip names the order and its date", slip.orderNumber === "WICK-AB12CD34" && slip.placed === "2026-11-17");
check("Ship to: the customer's name, then each address line", slip.heading === "Ship to" && JSON.stringify(slip.to) === JSON.stringify(["Pat Lee", "1 Test Street", "Apt 2", "Reno, NV 89501"]) && slip.phone === "555-0100");
check("items list the count and name, with the option only when it means something", JSON.stringify(slip.items) === JSON.stringify([{ quantity: 2, name: "Lavender Candle (8 oz)" }, { quantity: 1, name: "Wax Melts" }]) && slip.itemCount === 3);
check("totals show items, shipping when charged, and the total", JSON.stringify(slip.totals) === JSON.stringify([{ label: "Items", amount: 36 }, { label: "Shipping", amount: 6.5 }, { label: "Total", amount: 42.5 }]) && slip.note === "Leave at the door");

const pick = packingSlip(order, deliveryFromRow({ shipping_address: { address: "1 Test Street" }, metadata: { delivery_method: "pickup" } }), fmt);
check("a pickup order says Pickup and prints no address", pick.heading === "Pickup" && JSON.stringify(pick.to) === JSON.stringify(["Pat Lee"]) && pick.totals.length === 2);
const bare = packingSlip({ ...order, customer_name: "", placed_at: "not a date", items: [{ product_name: "", variant_title: null, quantity: 0 }] }, undefined, fmt);
check("missing details never break the slip", bare.to[0] === "Customer" && bare.placed === "" && bare.items[0].name === "Item" && bare.items[0].quantity === 1 && bare.note === "" && bare.phone === "");
check("a date formatter that fails gives an empty date, not a crash", packingSlip(order, ship, () => { throw new Error("x"); }).placed === "");
check("a very long address is capped at 8 lines", packingSlip(order, deliveryFromRow({ shipping_address: { address: Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") } }), fmt).to.length === 9);

const component = fs.readFileSync("src/components/PackingSlip.tsx", "utf8");
check("the slip is built from ordinary text elements (nothing typed by a shopper can become HTML)", !/dangerouslySetInnerHTML|innerHTML|document\.write/.test(component) && component.includes("createPortal(") && component.includes('data-testid="packing-slip"'));
const page = fs.readFileSync("src/pages/ClientCommerceOrders.tsx", "utf8");
check("the button is on real orders only and the page returns to normal after printing", page.includes('{order.is_test ? null : <button className="icon-btn" data-testid="print-slip"') && page.includes('window.addEventListener("afterprint", done, { once: true });') && page.includes('document.body.classList.remove("printing-slip")') && /try \{ window\.print\(\); \} catch \{ done\(\); \}/.test(page));
const css = fs.readFileSync("src/styles/plan-forms.css", "utf8");
check("on screen the slip is hidden; on paper it is the only thing", /\.packing-slip \{ display: none; \}/.test(css) && css.includes("body.printing-slip > *:not(.packing-slip) { display: none !important; }") && css.includes("body.printing-slip .packing-slip { display: block;"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll packing slip checks passed (offline).");
process.exit(failures ? 1 : 0);
