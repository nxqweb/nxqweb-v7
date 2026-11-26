// Offline test: the shipping fee screens are wired the safe way (applied from docs/drafts/patches/08_store_shipping_frontend.patch when
// draft migration 08 becomes a real migration).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (file) => fs.readFileSync(file, "utf8");

const store = read("src/pages/PublicCommerceStorefront.tsx");
check("the store page asks for the rule and treats any failure as no fee", store.includes('rpc("get_public_store_shipping"') && store.includes("if (!result.error) setShippingRule(shippingRuleFromRow(result.data));"));
check("the shipping-aware order function is used only when a rule is on (online stores only)", store.includes('shippingOn ? "create_public_store_order_with_shipping" : "create_public_stripe_ready_direct_payment_order"') && store.includes('const shippingOn = orderMode.mode === "online" && shippingRuleActive(shippingRule);'));
const place = store.slice(store.indexOf("async function placeOrder"), store.indexOf("const setField"));
check("the page never sends an amount, only the delivery choice", place.includes("...(shippingOn ? { delivery_method: delivery } : {})") && !/shipping_total|flat_fee|shippingFee/.test(place));
check("pickup lifts the address requirement and the shopper sees the total with shipping", store.includes('const addressNeeded = needsShipping && delivery !== "pickup";') && place.includes("validateCheckout(form, addressNeeded)") && store.includes("formatMoney(total + shippingFee, currency)"));
const card = read("src/components/StoreShippingCard.tsx");
check("the owner's card hides itself when the database has no shipping functions", card.includes('rpc("get_my_store_shipping")') && card.includes("if (!available) return null;") && card.includes('rpc("save_my_store_shipping", checked.args)'));
check("the Live store page shows the card for online ordering only", read("src/pages/ClientCommerceLiveStore.tsx").includes('{orderMode === "email" || orderMode === "menu" ? null : <StoreShippingCard />}'));
check("the owner is warned that a fixed-price Stripe link cannot add shipping", card.includes("A link with a fixed price cannot add shipping."));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store shipping wiring checks passed (offline).");
process.exit(failures ? 1 : 0);
