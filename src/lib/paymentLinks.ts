// Per-order payment links for a client's public store. The store owner saves ONE public link per provider; at checkout we add what
// each provider officially supports so the shopper pays the right amount and the owner can match the payment to the order.
//  * PayPal.me: the exact amount goes in the link path (paypal.me/<name>/<amount><CURRENCY>). PayPal.me has no note field.
//  * Venmo:     amount, note (the order number) and "pay" are query parameters on venmo.com/<handle> links.
//  * Stripe:    Payment Links accept client_reference_id and prefilled_email, but NOT an amount (the price lives in the link itself).
// Callers pass only links that already passed safePaymentUrl (https + the provider's own host). Anything unexpected is returned unchanged.

export type PaymentProvider = "stripe" | "paypal" | "venmo";
export type OrderPaymentContext = { orderNumber: string; total: number; currency: string; email?: string | null };

function amountText(total: number): string | null {
  return Number.isFinite(total) && total > 0 && total < 1_000_000 ? total.toFixed(2) : null;
}

function referenceId(orderNumber: string): string | null {
  const clean = String(orderNumber || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 200);
  return clean || null;
}

export function orderPaymentHref(provider: PaymentProvider, safeUrl: string | null, context: OrderPaymentContext): string | null {
  if (!safeUrl) return null;
  try {
    const url = new URL(safeUrl);
    const host = url.hostname.toLowerCase();

    if (provider === "paypal" && (host === "paypal.me" || host === "www.paypal.me")) {
      const handle = url.pathname.split("/").filter(Boolean)[0];
      const amount = amountText(context.total);
      const currency = /^[A-Za-z]{3}$/.test(context.currency || "") ? context.currency.toUpperCase() : "USD";
      if (!handle || !amount) return safeUrl;
      return `${url.origin}/${handle}/${amount}${currency}`;
    }

    if (provider === "venmo" && (host === "venmo.com" || host === "www.venmo.com")) {
      const amount = amountText(context.total);
      if (url.pathname.split("/").filter(Boolean).length === 0 || !amount) return safeUrl;
      url.searchParams.set("txn", "pay");
      url.searchParams.set("audience", "private");
      url.searchParams.set("amount", amount);
      url.searchParams.set("note", `Order ${context.orderNumber}`.slice(0, 200));
      return url.toString();
    }

    if (provider === "stripe" && host === "buy.stripe.com") {
      const reference = referenceId(context.orderNumber);
      if (reference) url.searchParams.set("client_reference_id", reference);
      const email = String(context.email || "").trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 320) url.searchParams.set("prefilled_email", email);
      return url.toString();
    }

    return safeUrl;
  } catch {
    return safeUrl;
  }
}
