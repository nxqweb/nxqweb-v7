// Offline test: the "Send this order to" block on the shop owner's Orders page (src/lib/orderDelivery.ts). Before this, the page showed
// the customer's name and email but never the shipping address, phone or note, so an owner could not tell where to send an order.
// Everything here is text a shopper typed: it must come out as plain capped text, and odd data must never break the orders list.
import fs from "node:fs";
import { addressText, deliveryBadge, deliveryById, deliveryColumns, deliveryFromRow, hasDeliveryDetails } from "../src/lib/orderDelivery.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const row = { id: "o1", customer_phone: " 555-0100 ", customer_note: "Leave at the door", shipping_address: { address: " 1 Test Street\nApt 2 " }, shipping_total: "6.50", metadata: { delivery_method: "ship" } };
const d = deliveryFromRow(row);
check("a store-page order gives the address, phone, note and shipping charged", d.address === "1 Test Street\nApt 2" && d.phone === "555-0100" && d.note === "Leave at the door" && d.shippingTotal === 6.5 && d.pickup === false);
check("the older checkout's separate address parts become one readable block", addressText({ name: "Pat Lee", line1: "9 Oak Rd", line2: "", city: "Reno", state: "NV", postal_code: "89501", country: "US" }) === "Pat Lee\n9 Oak Rd\nReno, NV, 89501\nUS");
check("an empty, missing or odd address is just empty", [undefined, null, {}, [], "1 Test Street", 7, { address: 12 }].every((v) => addressText(v) === ""));
check("pickup is read from the order, and only an exact match counts", deliveryFromRow({ metadata: { delivery_method: "pickup" } }).pickup === true && deliveryFromRow({ metadata: { delivery_method: "PICKUP " } }).pickup === false && deliveryFromRow({ metadata: "pickup" }).pickup === false);
check("text is capped and control characters are dropped", deliveryFromRow({ customer_note: "x".repeat(5000) }).note.length === 2000 && deliveryFromRow({ customer_phone: "5\u000055-\u00070100" }).phone === "555-0100" && deliveryFromRow({ shipping_address: { address: "y".repeat(3000) } }).address.length === 1000);
check("a missing, negative or junk shipping amount is 0", [undefined, null, -4, "abc", {}].every((v) => deliveryFromRow({ shipping_total: v }).shippingTotal === 0));
check("non-text values never leak through as text", (() => { const odd = deliveryFromRow({ customer_phone: { a: 1 }, customer_note: ["x"], shipping_address: "street" }); return odd.phone === "" && odd.note === "" && odd.address === ""; })());

const map = deliveryById([row, { id: "o2", metadata: { delivery_method: "pickup" } }, { id: 5 }, null, "x", { customer_phone: "no id" }]);
check("rows are keyed by order id and broken rows are skipped", Object.keys(map).join(",") === "o1,o2" && map.o2.pickup === true);
check("anything that is not a list of rows gives an empty map", [undefined, null, {}, "rows", 3].every((v) => Object.keys(deliveryById(v)).length === 0));

check("the block shows only when there is something to show", hasDeliveryDetails(d) && hasDeliveryDetails(map.o2) && !hasDeliveryDetails(undefined) && !hasDeliveryDetails(deliveryFromRow({})));
check("the closed card says Ship or Pickup, or nothing", deliveryBadge(d) === "Ship" && deliveryBadge(map.o2) === "Pickup" && deliveryBadge(deliveryFromRow({})) === "" && deliveryBadge(undefined) === "");

const page = fs.readFileSync("src/pages/ClientCommerceOrders.tsx", "utf8");
check("the page reads only the needed columns from the shop's own orders, and a failure hides the block instead of the list", page.includes('.from("commerce_orders").select(deliveryColumns)') && page.includes("if (!result.error) setDelivery(deliveryById(result.data));") && page.includes("/* the delivery block simply stays hidden */") && deliveryColumns === "id, customer_phone, customer_note, shipping_address, shipping_total, metadata");
check("the read happens after the orders list is shown, never before it", page.indexOf("setVerified(true);") < page.indexOf("void loadDelivery();") && page.indexOf("void loadDelivery();") > 0);
check("shopper text is shown as plain text only (no link, no HTML injection)", !/dangerouslySetInnerHTML/.test(page) && !/href=\{[^}]*going\./.test(page) && page.includes('data-testid="order-delivery"'));
check("the owner can copy the address and sees pickup orders clearly", page.includes("Copy address") && page.includes("The customer will pick this up. No shipping needed."));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll order delivery checks passed (offline).");
process.exit(failures ? 1 : 0);
