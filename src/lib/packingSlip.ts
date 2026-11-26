// The words on a printed packing slip for one order (the Orders page prints it; see src/components/PackingSlip.tsx). Pure: it only
// arranges what the page already has. Everything a shopper typed stays plain text; the component shows it as text, never as HTML.
import type { OrderDelivery } from "./orderDelivery.ts";

export type SlipOrder = {
  order_number: string;
  customer_name: string;
  currency: string;
  subtotal: number;
  total: number;
  placed_at: string;
  items: Array<{ product_name: string; variant_title: string | null; quantity: number }>;
};

export type PackingSlipData = {
  orderNumber: string;
  placed: string; // already formatted for people, or ""
  heading: "Ship to" | "Pickup";
  to: string[]; // name first, then the address lines; for pickup just the name
  phone: string;
  items: Array<{ quantity: number; name: string }>;
  itemCount: number;
  note: string;
  totals: Array<{ label: string; amount: number }>;
};

const clean = (value: unknown, max: number): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function packingSlip(order: SlipOrder, delivery: OrderDelivery | undefined, formatDate: (iso: string) => string): PackingSlipData {
  const pickup = Boolean(delivery?.pickup);
  const name = clean(order.customer_name, 160) || "Customer";
  const addressLines = pickup ? [] : (delivery?.address || "").split("\n").map((line) => clean(line, 200)).filter(Boolean).slice(0, 8);
  const items = (Array.isArray(order.items) ? order.items : []).map((item) => {
    const variant = clean(item.variant_title, 120);
    const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 1;
    return { quantity, name: `${clean(item.product_name, 200) || "Item"}${variant && variant !== "Default" ? ` (${variant})` : ""}` };
  });
  const shipping = delivery?.shippingTotal || 0;
  const totals = [{ label: "Items", amount: Number(order.subtotal) || 0 }];
  if (shipping > 0) totals.push({ label: "Shipping", amount: shipping });
  totals.push({ label: "Total", amount: Number(order.total) || 0 });
  const placed = (() => { try { return order.placed_at && Number.isFinite(Date.parse(order.placed_at)) ? formatDate(order.placed_at) : ""; } catch { return ""; } })();
  return {
    orderNumber: clean(order.order_number, 60),
    placed,
    heading: pickup ? "Pickup" : "Ship to",
    to: [name, ...addressLines],
    phone: delivery?.phone || "",
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    note: delivery?.note || "",
    totals,
  };
}
