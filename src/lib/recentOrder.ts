// "Your recent order" on the public store page. After a shopper places an order, the payment steps were only on the screen: a refresh,
// a closed tab or a phone that reloaded the page lost them, and the shopper could not pay (or ordered twice). The page now remembers the
// answer the server already gave THIS browser (order number, total, the shop's public payment links) for two hours, which is how long
// the shop holds the stock. No name, email, phone or address is kept. Everything read back is re-checked, because browser storage can
// hold anything.

export type RecentOrder = {
  order_number: string;
  total: number;
  currency: string;
  stripe_payment_link?: string | null;
  paypal_url?: string | null;
  venmo_url?: string | null;
  payment_note?: string | null;
  subtotal?: number;
  shipping_total?: number;
  delivery_method?: string;
};

export const recentOrderMaxAgeMs = 2 * 60 * 60 * 1000;
export const recentOrderKey = (slug: string) => `nxq-recent-order-v1-${slug}`;

const amount = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 9999999.99 ? n : null;
};
const link = (value: unknown): string | null => typeof value === "string" && value.length <= 500 && /^https:\/\//i.test(value) ? value : null;

export function serializeRecentOrder(order: RecentOrder, now: number): string {
  return JSON.stringify({
    n: order.order_number, t: order.total, c: order.currency,
    s: order.stripe_payment_link ?? null, p: order.paypal_url ?? null, v: order.venmo_url ?? null,
    note: order.payment_note ?? null, sub: order.subtotal ?? null, ship: order.shipping_total ?? null, how: order.delivery_method ?? null,
    at: now,
  });
}

// The remembered order, or null when there is none, it is older than two hours, it claims to be from the future, or anything looks wrong.
export function restoreRecentOrder(raw: string | null | undefined, now: number): RecentOrder | null {
  if (!raw || raw.length > 4000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.at !== "number" || !Number.isFinite(row.at) || row.at > now + 60_000 || now - row.at > recentOrderMaxAgeMs) return null;
  if (typeof row.n !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(row.n)) return null;
  const total = amount(row.t);
  if (total === null) return null;
  if (typeof row.c !== "string" || !/^[A-Za-z]{3}$/.test(row.c)) return null;
  const order: RecentOrder = {
    order_number: row.n, total, currency: row.c.toUpperCase(),
    stripe_payment_link: link(row.s), paypal_url: link(row.p), venmo_url: link(row.v),
    payment_note: typeof row.note === "string" ? row.note.slice(0, 500) : null,
  };
  const subtotal = amount(row.sub); const shipping = amount(row.ship);
  if (subtotal !== null) order.subtotal = subtotal;
  if (shipping !== null) order.shipping_total = shipping;
  if (row.how === "pickup" || row.how === "ship") order.delivery_method = row.how;
  return order;
}

// Minutes left before the shop stops holding the stock (never below 0), for the "pay within" hint.
export function recentOrderMinutesLeft(raw: string | null | undefined, now: number): number {
  try {
    const at = (JSON.parse(raw || "{}") as { at?: unknown }).at;
    return typeof at === "number" && Number.isFinite(at) ? Math.max(0, Math.round((at + recentOrderMaxAgeMs - now) / 60000)) : 0;
  } catch { return 0; }
}
