// Link safety for addresses that come from data (store settings, provider records), not from our code.
// React 19 already blocks `javascript:` links; these helpers also stop non-web schemes and, for payment
// buttons on public storefronts, any host that is not the named payment provider (anti-phishing).

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const PAYMENT_HOSTS: Record<"stripe" | "paypal" | "venmo", string[]> = {
  stripe: ["buy.stripe.com", "checkout.stripe.com", "donate.stripe.com"],
  paypal: ["paypal.me", "www.paypal.me", "paypal.com", "www.paypal.com"],
  venmo: ["venmo.com", "www.venmo.com", "account.venmo.com"],
};

// Only https links on the provider's own hosts are shown; anything else hides the button.
export function safePaymentUrl(provider: keyof typeof PAYMENT_HOSTS, value: unknown): string | null {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== "https:") return null;
  return PAYMENT_HOSTS[provider].includes(url.hostname.toLowerCase()) ? safe : null;
}
