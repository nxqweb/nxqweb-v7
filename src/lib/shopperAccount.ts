// Shopper accounts for a client's public store (migration 268). Pure helpers: no network, no storage, easy to test.
// Shoppers use plain email + password sign-up with NO business_name metadata, so they can never become a client.

export const shopperLimits = { name: 160, phone: 80, address: 1000, passwordMin: 8 } as const;

export type ShopperProfileInput = { fullName: string; phone: string; address: string };
export type ShopperProfilePayload = { full_name: string | null; phone: string | null; shipping_address: { address: string } };
export type ShopperProfileResult = { ok: true; payload: ShopperProfilePayload } | { ok: false; error: string };

export type ShopperProfileRow = {
  email?: string | null;
  has_profile?: boolean;
  full_name?: string | null;
  phone?: string | null;
  shipping_address?: { address?: unknown } | null;
};

export type ShopperOrderRow = {
  order_number: string;
  status?: string | null;
  payment_status?: string | null;
  fulfillment_stage?: string | null;
  grand_total?: number | string | null;
  currency_code?: string | null;
  placed_at?: string | null;
};

// "/store/<slug>/account" is the shopper page; "/store/<slug>" is the store itself.
export function storeSlugFromPath(pathname: string): string {
  return pathname.split("/").filter(Boolean)[1] || "";
}

export function shopperAccountPath(slug: string): string {
  return `/store/${encodeURIComponent(slug)}/account`;
}

export function isShopperAccountPath(pathname: string): boolean {
  return /^\/store\/[^/]+\/account\/?$/.test(pathname);
}

export function normalizeProfileInput(input: ShopperProfileInput): ShopperProfileResult {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  if (fullName.length > shopperLimits.name) return { ok: false, error: `Name must be ${shopperLimits.name} characters or fewer.` };
  if (phone.length > shopperLimits.phone) return { ok: false, error: `Phone must be ${shopperLimits.phone} characters or fewer.` };
  if (address.length > shopperLimits.address) return { ok: false, error: `Address must be ${shopperLimits.address} characters or fewer.` };
  return { ok: true, payload: { full_name: fullName || null, phone: phone || null, shipping_address: { address } } };
}

// The checkout form keeps the address as one line, stored as { address }. Anything else in the saved object is ignored.
export function profileToCheckoutFields(profile: ShopperProfileRow | null | undefined) {
  const address = profile?.shipping_address && typeof profile.shipping_address.address === "string" ? profile.shipping_address.address : "";
  return {
    email: profile?.email || "",
    name: profile?.full_name || "",
    phone: profile?.phone || "",
    address,
  };
}

// Fill only what the shopper has not already typed, so autofill never overwrites their edits.
export function mergeCheckoutAutofill<T extends { name: string; email: string; phone: string; address: string }>(current: T, saved: { name: string; email: string; phone: string; address: string }): T {
  return {
    ...current,
    name: current.name || saved.name,
    email: current.email || saved.email,
    phone: current.phone || saved.phone,
    address: current.address || saved.address,
  };
}

export type SignUpCheck = { ok: true } | { ok: false; error: string };

export function validateCredentials(email: string, password: string): SignUpCheck {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return { ok: false, error: "Enter a valid email address." };
  if (password.length < shopperLimits.passwordMin) return { ok: false, error: `Use a password with at least ${shopperLimits.passwordMin} characters.` };
  return { ok: true };
}

// Turn database and sign-in errors into short plain sentences. Unknown errors stay generic so internals never leak.
export function friendlyShopperError(message: string | null | undefined): string {
  const text = String(message || "");
  if (/Sign in to continue/i.test(text)) return "Please sign in to continue.";
  if (/Confirm your email/i.test(text) || /Email not confirmed/i.test(text)) return "Please confirm your email address first. Check your inbox for the confirmation link, then sign in.";
  if (/Customer accounts are not available/i.test(text) || /Storefront is not available/i.test(text)) return "This store does not offer accounts right now. You can still check out as a guest.";
  if (/Invalid login credentials/i.test(text)) return "That email and password do not match. Please try again.";
  if (/already registered/i.test(text) || /already been registered/i.test(text)) return "An account with that email already exists. Try signing in instead.";
  if (/rate limit/i.test(text) || /too many/i.test(text) || /seconds/i.test(text)) return "Too many attempts right now. Please wait a minute and try again.";
  if (/Password should be/i.test(text) || /weak/i.test(text)) return `Use a stronger password with at least ${shopperLimits.passwordMin} characters.`;
  if (/must be \d+ characters or fewer/i.test(text) || /too large/i.test(text)) return "One of the details is too long. Please shorten it and try again.";
  return "Something went wrong. Please try again in a moment.";
}

export function orderStatusLabel(order: Pick<ShopperOrderRow, "status" | "payment_status" | "fulfillment_stage">): string {
  const stage = order.fulfillment_stage || "";
  if (stage === "cancelled" || order.status === "cancelled") return "Cancelled";
  if (stage === "refunded" || order.payment_status === "refunded") return "Refunded";
  if (stage === "delivered") return "Delivered";
  if (stage === "shipped") return "Shipped";
  if (stage === "ready_for_pickup") return "Ready for pickup";
  if (order.payment_status === "paid") return stage === "processing" ? "Paid, being prepared" : "Paid";
  return "Waiting for the store to confirm your payment";
}

export function formatOrderTotal(order: Pick<ShopperOrderRow, "grand_total" | "currency_code">): string {
  const value = Number(order.grand_total);
  if (!Number.isFinite(value)) return "";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency_code || "USD" }).format(value); } catch { return `$${value.toFixed(2)}`; }
}
