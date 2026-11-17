// What the shop owner needs to send an order out: where it goes, how to reach the shopper, and what the shopper wrote.
// These are read from the owner's own order rows (row-level security limits them to this client). Everything here is text a shopper
// typed, so it is only ever shown as plain text, trimmed and length-capped, and never turned into a link.

export type OrderDelivery = {
  address: string;
  phone: string;
  note: string;
  pickup: boolean;
  shippingTotal: number;
};

export const deliveryColumns = "id, customer_phone, customer_note, shipping_address, shipping_total, metadata";

// Control characters (other than tab, new line and carriage return) are dropped by character code.
const printable = (value: string): string => Array.from(value).filter((ch) => { const code = ch.charCodeAt(0); return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127); }).join("");
const text = (value: unknown, max: number): string => typeof value === "string" ? printable(value).trim().slice(0, max) : "";
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
