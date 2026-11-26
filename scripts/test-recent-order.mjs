// Offline test: "Your recent order" on the public store page (src/lib/recentOrder.ts). After ordering, a refresh or a closed tab used to lose
// the payment steps. The page now remembers what the server told this browser for two hours. Browser storage can hold anything, so
// everything read back is re-checked, and no personal detail is ever stored.
import fs from "node:fs";
import { recentOrderKey, recentOrderMaxAgeMs, recentOrderMinutesLeft, restoreRecentOrder, serializeRecentOrder } from "../src/lib/recentOrder.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const now = 1_800_000_000_000;
const order = { order_id: "o1", order_number: "WICK-AB12CD34", total: 30.5, currency: "USD", paypal_url: "https://paypal.me/wickwax", stripe_payment_link: null, payment_note: "Put the order number in the note.", subtotal: 24, shipping_total: 6.5, delivery_method: "ship", reservation_expires_at: "x" };
const raw = serializeRecentOrder(order, now);
const back = restoreRecentOrder(raw, now + 5 * 60_000);
check("an order comes back with its number, total, links and note", back && back.order_number === "WICK-AB12CD34" && back.total === 30.5 && back.currency === "USD" && back.paypal_url === "https://paypal.me/wickwax" && back.stripe_payment_link === null && back.payment_note === "Put the order number in the note." && back.shipping_total === 6.5 && back.delivery_method === "ship");
check("nothing personal is stored (no name, email, phone, address, order id)", !/name|email|phone|address|o1/i.test(raw.replace("note", "")) && Object.keys(JSON.parse(raw)).sort().join(",") === "at,c,how,n,note,p,s,ship,sub,t,v");
check("it is forgotten after two hours, and a time from the future is refused", restoreRecentOrder(raw, now + recentOrderMaxAgeMs + 1) === null && restoreRecentOrder(raw, now + recentOrderMaxAgeMs - 1) !== null && restoreRecentOrder(raw, now - 5 * 60_000) === null);
check("minutes left count down and never go below 0", recentOrderMinutesLeft(raw, now) === 120 && recentOrderMinutesLeft(raw, now + 90 * 60_000) === 30 && recentOrderMinutesLeft(raw, now + 5 * 60 * 60_000) === 0 && recentOrderMinutesLeft("junk", now) === 0 && recentOrderMinutesLeft(null, now) === 0);

const tamper = (change) => restoreRecentOrder(JSON.stringify({ ...JSON.parse(raw), ...change }), now);
check("junk, empty, huge or non-object storage gives nothing", [null, undefined, "", "not json", "[]", "7", '"text"', "x".repeat(5000)].every((v) => restoreRecentOrder(v, now) === null));
check("an odd order number is refused (it is shown on the page)", [{ n: "<img src=x>" }, { n: "" }, { n: "ab" }, { n: 12345 }, { n: "A".repeat(50) }, { n: "-LEADING" }].every((c) => tamper(c) === null));
check("an odd total or currency is refused", [{ t: -1 }, { t: "abc" }, { t: null }, { t: 1e12 }, { c: "DOLLARS" }, { c: 5 }, { c: "" }].every((c) => tamper(c) === null));
check("a link that is not https is dropped, the order still comes back", (() => { const o = tamper({ p: "javascript:alert(1)", s: "http://buy.stripe.com/x", v: { a: 1 } }); return o && o.paypal_url === null && o.stripe_payment_link === null && o.venmo_url === null; })());
check("a missing or odd time is refused", [{ at: "now" }, { at: null }, { at: Infinity }].every((c) => tamper(c) === null));
check("a long note is cut and an odd delivery choice is ignored", tamper({ note: "x".repeat(900) }).payment_note.length === 500 && tamper({ how: "teleport" }).delivery_method === undefined);
check("each store has its own slot", recentOrderKey("a") !== recentOrderKey("b") && recentOrderKey("wick").includes("wick"));

const page = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
check("the page saves the order when it is created and tolerates storage failures", page.includes("window.localStorage.setItem(recentOrderKey(slug), serializeRecentOrder(result.data as OrderResult, Date.now()))") && page.includes("/* the steps stay on screen */") && page.includes("/* private browsing: nothing to remember */"));
check("an expired or broken slot is cleaned up on the next visit", page.includes("else if (raw) window.localStorage.removeItem(recentOrderKey(slug));"));
check("the card offers the payment steps again and a way to dismiss it, and tells the shopper not to order twice", page.includes('data-testid="recent-order-card"') && page.includes("Show how to pay") && page.includes("I already paid") && page.includes("You do not need to order again."));
check("payment links still go through the safety check before they become buttons", /safePaymentUrl\("paypal", order\.paypal_url\)/.test(page) && /safePaymentUrl\("stripe", order\.stripe_payment_link\)/.test(page));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll recent order checks passed (offline).");
process.exit(failures ? 1 : 0);
