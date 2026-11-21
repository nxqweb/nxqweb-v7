// Offline test: the "The money arrived" button on the Orders page (migration 295, promoted from draft 09 on 2026-11-18).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const page = fs.readFileSync("src/pages/ClientCommerceOrders.tsx", "utf8");
check("the button shows only where the helper allows it (a real unpaid order whose hold ran out)", page.includes('{canConfirmLate(going, order.payment_status === "paid", order.is_test, wasAutoCancelled(order.events)) ? <button className="wide-btn" data-testid="confirm-late"'));
check("the owner is asked to confirm the money really arrived before anything is sent", /window\.confirm\(`Did the payment for \$\{order\.order_number\} arrive in your own account\?/.test(page) && page.indexOf("if (!confirmed) return;", page.indexOf("async function confirmLatePayment")) < page.indexOf('rpc("confirm_my_late_direct_payment"'));
check("only the order id is sent", page.includes('rpc("confirm_my_late_direct_payment", { order_uuid: order.id })'));
check("a refusal is shown through the safe-message helper and the list reloads after success", page.includes("setError(lateConfirmError(result.error.message))") && /is open again and marked paid\. You can send it now\.`\);\s*await loadOrders\(\);/.test(page));
check("the normal Confirm button is not offered on a cancelled order", page.includes('order.payment_status !== "paid" && !order.is_test && order.fulfillment_status !== "cancelled" ?'));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll late payment wiring checks passed (offline).");
process.exit(failures ? 1 : 0);
