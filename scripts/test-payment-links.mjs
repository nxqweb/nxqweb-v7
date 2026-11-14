// Offline test: per-order payment links carry the right amount/reference where the provider supports it, never invent an amount for
// Stripe, leave unexpected links alone, and the store only ever builds them from links that already passed the safe-host check.
import fs from "node:fs";
import { orderPaymentHref } from "../src/lib/paymentLinks.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const ctx = { orderNumber: "NXQ-9E963B25", total: 36, currency: "USD", email: "jo@example.com" };

// PayPal.me
check("PayPal.me link gets the exact total and currency in the path", orderPaymentHref("paypal", "https://paypal.me/CandleCo", ctx) === "https://paypal.me/CandleCo/36.00USD");
check("an amount already in the saved PayPal.me link is replaced by the order total", orderPaymentHref("paypal", "https://www.paypal.me/CandleCo/10USD", ctx) === "https://www.paypal.me/CandleCo/36.00USD");
check("fractional totals keep two decimals", orderPaymentHref("paypal", "https://paypal.me/CandleCo", { ...ctx, total: 12.5 }) === "https://paypal.me/CandleCo/12.50USD");
check("currency follows the order", orderPaymentHref("paypal", "https://paypal.me/CandleCo", { ...ctx, currency: "cad" }) === "https://paypal.me/CandleCo/36.00CAD");
check("other PayPal links (invoices, buttons) are left alone", orderPaymentHref("paypal", "https://www.paypal.com/ncp/payment/ABC123", ctx) === "https://www.paypal.com/ncp/payment/ABC123");

// Venmo
const venmo = new URL(orderPaymentHref("venmo", "https://venmo.com/u/CandleCo", ctx));
check("Venmo link gets pay, exact amount and the order number as the note", venmo.pathname === "/u/CandleCo" && venmo.searchParams.get("txn") === "pay" && venmo.searchParams.get("amount") === "36.00" && venmo.searchParams.get("note") === "Order NXQ-9E963B25" && venmo.searchParams.get("audience") === "private");
check("an old amount in the saved Venmo link is overwritten", new URL(orderPaymentHref("venmo", "https://venmo.com/CandleCo?amount=1", ctx)).searchParams.get("amount") === "36.00");
check("Venmo account pages are left alone", orderPaymentHref("venmo", "https://account.venmo.com/pay", ctx) === "https://account.venmo.com/pay");

// Stripe
const stripe = new URL(orderPaymentHref("stripe", "https://buy.stripe.com/test_abc123", ctx));
check("Stripe link gets the order number and the shopper's email", stripe.searchParams.get("client_reference_id") === "NXQ-9E963B25" && stripe.searchParams.get("prefilled_email") === "jo@example.com" && stripe.pathname === "/test_abc123");
check("Stripe link NEVER gets an amount (Stripe does not support it)", ![...stripe.searchParams.keys()].some((key) => /amount|price|total/i.test(key)));
check("a bad email is not attached to the Stripe link", !new URL(orderPaymentHref("stripe", "https://buy.stripe.com/x", { ...ctx, email: "not-an-email" })).searchParams.has("prefilled_email"));
check("the order reference is cleaned to characters Stripe accepts", new URL(orderPaymentHref("stripe", "https://buy.stripe.com/x", { ...ctx, orderNumber: "A B/C#1" })).searchParams.get("client_reference_id") === "ABC1");
check("other Stripe hosts are left alone", orderPaymentHref("stripe", "https://checkout.stripe.com/c/pay/cs_1", ctx) === "https://checkout.stripe.com/c/pay/cs_1");

// safety
check("no link in, no link out", orderPaymentHref("stripe", null, ctx) === null && orderPaymentHref("paypal", null, ctx) === null && orderPaymentHref("venmo", null, ctx) === null);
check("look-alike hosts are never modified", orderPaymentHref("stripe", "https://buy.stripe.com.evil.example/x", ctx) === "https://buy.stripe.com.evil.example/x" && orderPaymentHref("paypal", "https://paypal.me.evil.example/x", ctx) === "https://paypal.me.evil.example/x" && orderPaymentHref("venmo", "https://venmo.com.evil.example/u/x", ctx) === "https://venmo.com.evil.example/u/x");
check("unusable totals leave PayPal and Venmo links unchanged", ["paypal", "venmo"].every((p) => [0, -5, Number.NaN, Infinity].every((total) => orderPaymentHref(p, p === "paypal" ? "https://paypal.me/CandleCo" : "https://venmo.com/CandleCo", { ...ctx, total }) === (p === "paypal" ? "https://paypal.me/CandleCo" : "https://venmo.com/CandleCo"))));
check("garbage input is returned unchanged, never thrown", orderPaymentHref("stripe", "not a url", ctx) === "not a url");

// wiring
const storefront = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const live = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
check("the store builds all three links through orderPaymentHref", ["stripe", "paypal", "venmo"].every((p) => new RegExp(`orderPaymentHref\\("${p}", safePaymentUrl\\("${p}"`).test(storefront)));
check("the store never links a provider URL without the safe-host check", !/href=\{order\.(stripe_payment_link|paypal_url|venmo_url)/.test(storefront) && (storefront.match(/safePaymentUrl\(/g) || []).length === 3);
check("the order page tells Stripe shoppers the exact amount to pay", storefront.includes("please pay exactly {money(order.total, order.currency)} for order {order.order_number}"));
check("the Live store page explains how amounts work for the owner", live.includes("How amounts work") && live.includes("lets customers choose what to pay") && live.includes("PayPal.me and Venmo links get each order's exact total added automatically"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll payment-link checks passed (offline).");
process.exit(failures ? 1 : 0);
