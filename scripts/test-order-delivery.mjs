// Offline test: the "Send this order to" block on the shop owner's Orders page (src/lib/orderDelivery.ts). Before this, the page showed
// the customer's name and email but never the shipping address, phone or note, so an owner could not tell where to send an order.
// Everything here is text a shopper typed: it must come out as plain capped text, and odd data must never break the orders list.
import fs from "node:fs";
import { wasAutoCancelled, canConfirmLate, lateConfirmError, holdMessage, addressText, deliveryBadge, deliveryById, deliveryColumns, deliveryFromRow, hasDeliveryDetails } from "../src/lib/orderDelivery.ts";

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

// ---- the two-hour hold on an unpaid order (the server cancels it automatically afterwards)
const at = Date.parse("2026-11-17T18:00:00Z");
const fmtTime = (ms) => new Date(ms).toISOString().slice(11, 16);
const held = deliveryFromRow({ reservation_expires_at: "2026-11-17T19:30:00Z" });
check("an unpaid order says until when the items are held and what happens after", held.heldUntil === Date.parse("2026-11-17T19:30:00Z") && !held.released && holdMessage(held, false, at, fmtTime, true) === "The items are held until 19:30. If the payment is not confirmed by then, the order is cancelled automatically and the items go back on sale.");
check("a hold that just ran out asks the owner to confirm now", /confirm the payment now/.test(holdMessage(held, false, Date.parse("2026-11-17T19:31:00Z"), fmtTime, true)));
check("an automatically cancelled order says why", (() => { const gone = deliveryFromRow({ reservation_expires_at: "2026-11-17T19:30:00Z", reservation_released_at: "2026-11-17T19:45:00Z" }); return gone.released && /cancelled automatically because the payment was not confirmed in time/.test(holdMessage(gone, false, at, fmtTime, true)); })());
check("a paid order, a missing row or an order without a hold says nothing", holdMessage(held, true, at, fmtTime, true) === "" && holdMessage(undefined, false, at, fmtTime, true) === "" && holdMessage(deliveryFromRow({}), false, at, fmtTime, true) === "");
check("odd dates are ignored", [undefined, null, 5, "soon", {}].every((v) => deliveryFromRow({ reservation_expires_at: v, reservation_released_at: v }).heldUntil === null && !deliveryFromRow({ reservation_released_at: v }).released));

// ---- only the system's own cancel counts as "automatic" (an order the owner cancelled by hand must never say so)
const expiredEvent = { event_type: "reservation_expired", to_status: "cancelled" };
const handCancel = { event_type: "fulfillment_status_changed", to_status: "cancelled" };
check("the history tells an automatic cancel from a hand cancel", wasAutoCancelled([expiredEvent]) && !wasAutoCancelled([handCancel]) && !wasAutoCancelled([handCancel, expiredEvent]) && !wasAutoCancelled([{ event_type: "order_created" }]) && [undefined, null, "x", {}, [null, 5]].every((v) => wasAutoCancelled(v) === false));
check("a hand-cancelled order gets no 'cancelled automatically' line and no late-confirm offer", (() => { const gone = deliveryFromRow({ reservation_released_at: "2026-11-17T19:45:00Z" }); return holdMessage(gone, false, at, fmtTime, false) === "" && !canConfirmLate(gone, false, false, false) && /cancelled automatically/.test(holdMessage(gone, false, at, fmtTime, true)); })());
check("the page judges it from the order's own history", fs.readFileSync("src/pages/ClientCommerceOrders.tsx", "utf8").includes("wasAutoCancelled(order.events));"));

// ---- "the money arrived late" helpers (the button itself waits in docs/drafts/patches until draft 09 is a real migration)
const goneRow = deliveryFromRow({ reservation_released_at: "2026-11-17T19:45:00Z" });
check("late confirm is offered only on a real unpaid order whose hold ran out", canConfirmLate(goneRow, false, false, true) && !canConfirmLate(goneRow, true, false, true) && !canConfirmLate(goneRow, false, true, true) && !canConfirmLate(held, false, false, true) && !canConfirmLate(undefined, false, false, true));
check("clear server refusals are shown word for word", lateConfirmError("Late Candle has sold out since this order was cancelled. Refund the customer or add stock first.") === "Late Candle has sold out since this order was cancelled. Refund the customer or add stock first." && /too old/.test(lateConfirmError("This order is too old to confirm late. Contact the customer instead.")));
check("anything else becomes one calm sentence (no database wording leaks)", [undefined, null, "", 5, 'duplicate key value violates unique constraint "x"', "permission denied for function"].every((m) => lateConfirmError(m) === "This order could not be reopened right now. Nothing was changed. Please try again."));

const page = fs.readFileSync("src/pages/ClientCommerceOrders.tsx", "utf8");
check("the page reads only the needed columns from the shop's own orders, and a failure hides the block instead of the list", page.includes('.from("commerce_orders").select(deliveryColumns)') && page.includes("if (!result.error) { setDelivery(deliveryById(result.data)); setDeliveryReadAt(Date.now()); }") && page.includes("/* the delivery block simply stays hidden */") && deliveryColumns === "id, customer_phone, customer_note, shipping_address, shipping_total, metadata, reservation_expires_at, reservation_released_at");
check("the read happens after the orders list is shown, never before it", page.indexOf("setVerified(true);") < page.indexOf("void loadDelivery();") && page.indexOf("void loadDelivery();") > 0);
check("shopper text is shown as plain text only (no link, no HTML injection)", !/dangerouslySetInnerHTML/.test(page) && !/href=\{[^}]*going\./.test(page) && page.includes('data-testid="order-delivery"'));
check("the owner can copy the address and sees pickup orders clearly", page.includes("Copy address") && page.includes("The customer will pick this up. No shipping needed."));

check("the owner sees the hold deadline on the order card, before the Confirm button, and never on practice orders", page.indexOf('data-testid="order-hold"') > 0 && page.indexOf('data-testid="order-hold"') < page.indexOf("Confirm payment received") && page.includes('const hold = order.is_test ? "" : holdMessage('));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll order delivery checks passed (offline).");
process.exit(failures ? 1 : 0);
