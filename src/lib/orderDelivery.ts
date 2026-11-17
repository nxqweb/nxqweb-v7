// What the shop owner needs to send an order out: where it goes, how to reach the shopper, and what the shopper wrote.
// These are read from the owner's own order rows (row-level security limits them to this client). Everything here is text a shopper
// typed, so it is only ever shown as plain text, trimmed and length-capped, and never turned into a link.

export type OrderDelivery = {
  address: string;
  phone: string;
  note: string;
  pickup: boolean;
  shippingTotal: number;
  heldUntil: number | null; // when the shop stops holding the items for an unpaid order (milliseconds), or null
  released: boolean; // the hold already ended: the order was cancelled and the items went back on sale
};

export const deliveryColumns = "id, customer_phone, customer_note, shipping_address, shipping_total, metadata, reservation_expires_at, reservation_released_at";

// Control characters (other than tab, new line and carriage return) are dropped by character code.
const printable = (value: string): string => Array.from(value).filter((ch) => { const code = ch.charCodeAt(0); return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127); }).join("");
const text = (value: unknown, max: number): string => typeof value === "string" ? printable(value).trim().slice(0, max) : "";
const time = (value: unknown): number | null => { const at = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// The store page saves the address as { address: "..." }; the older checkout saved separate parts. Both become one readable block.
export function addressText(value: unknown): string {
  const parts = record(value);
  const single = text(parts.address, 1000);
  if (single) return single;
  const cityLine = [text(parts.city, 120), text(parts.state ?? parts.region, 120), text(parts.postal_code ?? parts.zip, 40)].filter(Boolean).join(", ");
  return [text(parts.name, 160), text(parts.line1 ?? parts.address_line1, 300), text(parts.line2 ?? parts.address_line2, 300), cityLine, text(parts.country, 120)].filter(Boolean).join("\n").slice(0, 1000);
}

export function deliveryFromRow(row: unknown): OrderDelivery {
  const raw = record(row);
  const amount = Number(raw.shipping_total);
  return {
    address: addressText(raw.shipping_address),
    phone: text(raw.customer_phone, 80),
    note: text(raw.customer_note, 2000),
    pickup: record(raw.metadata).delivery_method === "pickup",
    shippingTotal: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    heldUntil: time(raw.reservation_expires_at),
    released: time(raw.reservation_released_at) !== null,
  };
}

// Rows keyed by order id. Anything that is not a list of rows with a text id becomes an empty map (the page then shows nothing extra).
export function deliveryById(rows: unknown): Record<string, OrderDelivery> {
  if (!Array.isArray(rows)) return {};
  const map: Record<string, OrderDelivery> = {};
  for (const row of rows) {
    const id = record(row).id;
    if (typeof id === "string" && id) map[id] = deliveryFromRow(row);
  }
  return map;
}

export const hasDeliveryDetails = (delivery: OrderDelivery | undefined): delivery is OrderDelivery =>
  Boolean(delivery && (delivery.address || delivery.phone || delivery.note || delivery.pickup || delivery.shippingTotal > 0));

// One short line for the closed order card, so the owner sees at a glance what to do with it.
export function deliveryBadge(delivery: OrderDelivery | undefined): string {
  if (!delivery) return "";
  if (delivery.pickup) return "Pickup";
  return delivery.address ? "Ship" : "";
}

// True when the SYSTEM cancelled the order because its hold ran out, and the owner did not also close it by hand afterwards.
// (The same rule the server uses in draft migration 09.) The order's history comes from the orders list the page already has.
export function wasAutoCancelled(events: unknown): boolean {
  if (!Array.isArray(events)) return false;
  const rows = events.map((event) => record(event));
  return rows.some((event) => event.event_type === "reservation_expired")
    && !rows.some((event) => event.event_type === "fulfillment_status_changed" && event.to_status === "cancelled");
}

// What an unpaid order's hold means for the owner, in plain words. "" when there is nothing to say (paid, test, or no hold recorded).
export function holdMessage(delivery: OrderDelivery | undefined, paid: boolean, now: number, formatTime: (at: number) => string, autoCancelled: boolean): string {
  if (!delivery || paid) return "";
  // "released" is also set when the owner cancels an order by hand; only the system's own cancel gets this explanation.
  if (delivery.released) return autoCancelled ? "This order was cancelled automatically because the payment was not confirmed in time. The items went back on sale." : "";
  if (delivery.heldUntil === null) return "";
  if (delivery.heldUntil <= now) return "The hold on these items has run out. This order will be cancelled automatically in a few minutes unless you confirm the payment now.";
  return `The items are held until ${formatTime(delivery.heldUntil)}. If the payment is not confirmed by then, the order is cancelled automatically and the items go back on sale.`;
}

// "The money arrived late" (draft migration 09): offered only on a real, unpaid order whose hold ran out.
export const canConfirmLate = (delivery: OrderDelivery | undefined, paid: boolean, isTest: boolean, autoCancelled: boolean): boolean => Boolean(delivery && delivery.released && autoCancelled && !paid && !isTest);

// The server's refusals that are clear and safe to show the owner are kept word for word; anything else becomes one calm sentence.
const lateSafe = [/has sold out since this order was cancelled/i, /is no longer in your store/i, /too old to confirm late/i, /cancelled automatically for running out of time/i, /still being held/i];
export function lateConfirmError(message: unknown): string {
  const text = typeof message === "string" ? message.trim().slice(0, 300) : "";
  return text && lateSafe.some((pattern) => pattern.test(text)) ? text : "This order could not be reopened right now. Nothing was changed. Please try again.";
}
