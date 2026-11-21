// "Get paid" helper on the client's Live store page: plain steps for getting ONE public payment link, and a safe way to try the link.
// Pure data and functions (tested offline in scripts/test-payment-links.mjs). A link can only be tested when it passes the same check the
// store itself uses (https, on the payment company's own website), so "Test my link" can never open anything else.
import { safePaymentUrl } from "./safeUrl.ts";

export type PayProvider = "paypal" | "venmo" | "stripe";
export type PayGuide = { provider: PayProvider; name: string; bestFor: string; example: string; steps: string[] };

export const payGuides: PayGuide[] = [
  { provider: "paypal", name: "PayPal", bestFor: "Easiest if you already use PayPal.", example: "https://paypal.me/yourname", steps: [
    "Sign in to PayPal and look for your PayPal.Me link (search \"PayPal.Me\" in PayPal's help if you cannot see it).",
    "Copy the link. It looks like paypal.me/yourname.",
    "Paste it in the PayPal link box on this page and press Save private draft.",
  ] },
  { provider: "venmo", name: "Venmo", bestFor: "Easiest if your customers already use Venmo.", example: "https://venmo.com/u/yourname", steps: [
    "Open Venmo and go to your profile to find your username.",
    "Your link is venmo.com/u/ followed by your username.",
    "Paste it in the Venmo link box on this page and press Save private draft.",
  ] },
  { provider: "stripe", name: "Stripe", bestFor: "Best for taking cards. Needs your own Stripe account.", example: "https://buy.stripe.com/...", steps: [
    "Sign in to your own Stripe account and create a Payment Link.",
    "Copy the link. It starts with buy.stripe.com.",
    "Paste it in the Stripe Payment Link box on this page and press Save private draft.",
  ] },
];

export const otherWaysNote = "Using something else, like Cash App or Zelle? Type it in Payment instructions, for example: Cash App $yourname, put your order number in the note.";
export const checkRulesNote = "PayPal and Venmo have their own rules for selling. Check that your account is allowed to take payments for a business.";

// What "Test my link" may open: the cleaned link when it is a real https link on that company's own site, otherwise nothing.
export type LinkTest = { ok: true; url: string } | { ok: false; reason: string };
export function testablePayLink(provider: PayProvider, typed: unknown): LinkTest {
  const text = typeof typed === "string" ? typed.trim() : "";
  const guide = payGuides.find((item) => item.provider === provider);
  if (!guide) return { ok: false, reason: "Unknown payment type." };
  if (!text) return { ok: false, reason: `Type or paste your ${guide.name} link in its box first.` };
  const safe = safePaymentUrl(provider, text);
  if (!safe) return { ok: false, reason: `That does not look like a ${guide.name} link. It should look like ${guide.example}` };
  return { ok: true, url: safe };
}
