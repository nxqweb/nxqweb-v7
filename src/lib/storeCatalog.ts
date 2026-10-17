// Pure logic for the public store: product facts, stock limits, the cart, the checkout form, and plain-words checkout errors. No network, no
// browser calls except the optional storage helpers, so every rule here is easy to test. The server still re-checks everything (prices,
// stock, quantities); these rules exist so a customer is told early and kindly instead of getting a failed order.

export type StoreVariant = { id: string; title: string; price: number; available_quantity: number; inventory_policy: string };
export type StoreProduct = {
  id: string;
  name: string;
  slug: string;
  short_description?: string | null;
  description?: string | null;
  base_price: number;
  compare_at_price?: number | null;
  image_url?: string | null;
  image_urls?: unknown;
  requires_shipping?: boolean | null;
  variants: StoreVariant[];
};
export type CartLine = { product: StoreProduct; variant: StoreVariant; quantity: number };

export const maxQuantityPerLine = 99;
export const maxCartLines = 25;
export const lowStockThreshold = 3;

export function formatMoney(value: number, currency = "USD"): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0)); }
  catch { return `$${Number(value || 0).toFixed(2)}`; }
}

// ---------- photos
const httpsImage = /^https:\/\/[^\s<>"]+$/i;
export function productImages(product: Pick<StoreProduct, "image_url" | "image_urls">): string[] {
  const list: string[] = [];
  const push = (value: unknown) => { if (typeof value === "string" && httpsImage.test(value.trim()) && !list.includes(value.trim())) list.push(value.trim()); };
  if (Array.isArray(product.image_urls)) product.image_urls.forEach(push);
  push(product.image_url);
  return list.slice(0, 8);
}

// ---------- price and sale
export type PriceSummary = { from: number; to: number; varies: boolean };
export function priceSummary(product: Pick<StoreProduct, "base_price" | "variants">): PriceSummary {
  const prices = (product.variants || []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n >= 0);
  if (prices.length === 0) { const base = Number(product.base_price) || 0; return { from: base, to: base, varies: false }; }
  const from = Math.min(...prices);
  const to = Math.max(...prices);
  return { from, to, varies: to > from };
}

export function saleInfo(product: Pick<StoreProduct, "base_price" | "compare_at_price" | "variants">): { onSale: boolean; percentOff: number } {
  const compare = Number(product.compare_at_price);
  const current = priceSummary(product).from;
  if (!Number.isFinite(compare) || compare <= 0 || !(compare > current) || current <= 0) return { onSale: false, percentOff: 0 };
  return { onSale: true, percentOff: Math.max(1, Math.round(((compare - current) / compare) * 100)) };
}

// ---------- stock
export type Stock = { soldOut: boolean; low: number | null; max: number };
export function variantStock(variant: Pick<StoreVariant, "available_quantity" | "inventory_policy">): Stock {
  const available = Math.max(0, Math.floor(Number(variant.available_quantity) || 0));
  if (variant.inventory_policy === "deny") {
    if (available <= 0) return { soldOut: true, low: null, max: 0 };
    return { soldOut: false, low: available <= lowStockThreshold ? available : null, max: Math.min(available, maxQuantityPerLine) };
  }
  return { soldOut: false, low: null, max: maxQuantityPerLine }; // backorders allowed
}
export const isPurchasable = (variant: StoreVariant) => !variantStock(variant).soldOut;
export const productInStock = (product: StoreProduct) => (product.variants || []).some(isPurchasable);
export const stockLabel = (variant: StoreVariant): string => { const s = variantStock(variant); return s.soldOut ? "Sold out" : s.low !== null ? `Only ${s.low} left` : ""; };

// ---------- the cart
export const cartCount = (cart: CartLine[]) => cart.reduce((sum, line) => sum + line.quantity, 0);
export const cartTotal = (cart: CartLine[]) => cart.reduce((sum, line) => sum + Number(line.variant.price) * line.quantity, 0);
export const cartNeedsShipping = (cart: CartLine[]) => cart.some((line) => line.product.requires_shipping !== false);

export type CartChange = { cart: CartLine[]; capped: boolean };
export function addLine(cart: CartLine[], product: StoreProduct, variant: StoreVariant): CartChange {
  const stock = variantStock(variant);
  if (stock.soldOut) return { cart, capped: true };
  const existing = cart.find((line) => line.variant.id === variant.id);
  if (existing) {
    if (existing.quantity >= stock.max) return { cart, capped: true };
    return { cart: cart.map((line) => (line.variant.id === variant.id ? { ...line, quantity: line.quantity + 1 } : line)), capped: false };
  }
  if (cart.length >= maxCartLines) return { cart, capped: true };
  return { cart: [...cart, { product, variant, quantity: 1 }], capped: false };
}

export function changeLine(cart: CartLine[], variantId: string, delta: number): CartChange {
  let capped = false;
  const next = cart.flatMap((line) => {
    if (line.variant.id !== variantId) return [line];
    const max = variantStock(line.variant).max;
    const wanted = line.quantity + delta;
    if (wanted > max) { capped = true; return max > 0 ? [{ ...line, quantity: max }] : []; }
    return wanted > 0 ? [{ ...line, quantity: wanted }] : [];
  });
  return { cart: next, capped };
}

// What is stored in the browser: only ids and quantities, never prices (prices always come fresh from the store).
export function serializeCart(cart: CartLine[]): string {
  return JSON.stringify(cart.map((line) => ({ v: line.variant.id, q: line.quantity })));
}
export function restoreCart(raw: string | null, products: StoreProduct[]): CartLine[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const lines: CartLine[] = [];
  for (const item of parsed.slice(0, maxCartLines)) {
    if (!item || typeof item !== "object") continue;
    const { v, q } = item as { v?: unknown; q?: unknown };
    if (typeof v !== "string" || typeof q !== "number" || !Number.isFinite(q)) continue;
    const product = products.find((p) => (p.variants || []).some((variant) => variant.id === v));
    const variant = product?.variants.find((variant) => variant.id === v);
    if (!product || !variant || lines.some((l) => l.variant.id === v)) continue;
    const max = variantStock(variant).max;
    const quantity = Math.min(Math.floor(q), max);
    if (quantity >= 1) lines.push({ product, variant, quantity });
  }
  return lines;
}
export const cartStorageKey = (slug: string) => `nxq-cart-v1-${slug}`;

// ---------- checkout form
export type CheckoutForm = { name: string; email: string; phone: string; address: string };
export type CheckoutErrors = Partial<Record<"name" | "email" | "address", string>>;
const emailLike = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function validateCheckout(form: CheckoutForm, needsShipping: boolean): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (!form.name.trim()) errors.name = "Please enter your name.";
  if (!form.email.trim()) errors.email = "Please enter your email so the shop can reach you about this order.";
  else if (!emailLike.test(form.email.trim())) errors.email = "That email does not look right. Please check it.";
  if (needsShipping && !form.address.trim()) errors.address = "Please enter the address to ship to.";
  return errors;
}

// The server's messages that are safe and clear for a customer are kept; everything else becomes one calm sentence.
const checkoutSafe: Array<[RegExp, string | null]> = [
  [/does not have enough (available )?stock/i, null],
  [/^A (selected )?product( option)? (in this cart )?is no longer available\.$/i, null],
  [/^A cart (item|product) is no longer available\.$/i, null],
  [/^Enter a valid customer email address\.$/i, null],
  [/^A valid customer email is required\.$/i, "Please enter a valid email address."],
  [/^Customer name( and email are| is) required\.$/i, "Please enter your name and email."],
  [/^Each cart quantity must be between 1 and 99\.$/i, null],
  [/^Your cart must contain between 1 and 25 different items\.$/i, null],
  [/^Your cart is empty\.$/i, null],
  [/^Checkout session is invalid\. Please refresh and try again\.$/i, null],
  [/^Storefront (is not available\.|not found)$/i, "This store is not taking orders right now."],
  [/does not have a direct payment method available/i, "This store cannot take orders right now. Please contact the shop."],
  // The database's own limits, in plain words (the shopper form also stops these before sending).
  [/160 characters or fewer/i, "Your name is too long (160 characters at most)."],
  [/phone must be 80 characters or fewer/i, "Your phone number is too long (80 characters at most)."],
  [/Order note must be 2000 characters or fewer/i, "Your order note is too long (2000 characters at most)."],
  [/Shipping address is invalid or too large/i, "Your address is too long. Please shorten it."],
  [/Too many recent order attempts/i, "Several orders were tried with this email recently. Please wait a little and try again."],
  [/too many order attempts right now/i, "This store is very busy right now. Please try again in a few minutes."],
];
export const genericCheckoutError = "We could not place your order. Please check your details and try again.";
export function friendlyCheckoutError(message: string | null | undefined): string {
  const text = String(message ?? "").trim();
  for (const [pattern, replacement] of checkoutSafe) if (pattern.test(text)) return replacement ?? text;
  return genericCheckoutError;
}

// ---------- small text helpers
export function firstSentence(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const match = flat.match(/^.*?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const productHash = (slug: string) => `#product-${slug}`;
export function slugFromHash(hash: string): string {
  const m = /^#product-([a-z0-9]+(?:-[a-z0-9]+)*)$/i.exec(hash || "");
  return m ? m[1] : "";
}
