// "Order by email" stores (migration 270): instead of paying online, the customer sends the shop an email with their order. Everything here is
// pure text building, no network. The email address always comes from the store's saved contact email and is re-checked with the same strict rule the
// database uses, and every part of the message is URL-encoded, so nothing a customer types can add mail fields (bcc, extra recipients) to the link.
import type { CartLine } from "./storeCatalog";

// Same plain dollar format as the store (kept local so this file has no runtime imports and stays trivially testable).
function formatMoney(value: number, currency: string): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0)); }
  catch { return `$${Number(value || 0).toFixed(2)}`; }
}

// online: normal checkout. email: the customer emails their order. menu: the items are shown with prices and the customer is told how to order (call or email).
export type OrderMode = { mode: "online" | "email" | "menu"; email: string; phone: string };
export const onlineMode: OrderMode = { mode: "online", email: "", phone: "" };

const emailPattern = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const phonePattern = /^[0-9+()\-.\s]+$/; // same rule as the store profile; at least 7 digits are checked below

// Reads the public function result. Anything unexpected (or an unusable email or phone) falls back to normal online ordering, never to a broken button.
export function orderModeFromRow(row: unknown): OrderMode {
  const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const rawEmail = typeof source.contact_email === "string" ? source.contact_email.trim() : "";
  const rawPhone = typeof source.contact_phone === "string" ? source.contact_phone.trim() : "";
  const email = emailPattern.test(rawEmail) ? rawEmail : "";
  const phone = phonePattern.test(rawPhone) && rawPhone.replace(/\D/g, "").length >= 7 ? rawPhone : "";
  if (source.order_mode === "email" && email) return { mode: "email", email, phone: "" };
  if (source.order_mode === "menu" && (email || phone)) return { mode: "menu", email, phone };
  return onlineMode;
}

export type EmailOrderInput = {
  storeName: string;
  lines: CartLine[];
  currency: string;
  customer: { name: string; email: string; phone: string; address: string };
  note: string;
  needsShipping: boolean;
};

const clean = (text: string) => text.replace(/[\r\n]+/g, " ").trim();

export function buildEmailOrder(input: EmailOrderInput): { subject: string; body: string } {
  const total = input.lines.reduce((sum, line) => sum + Number(line.variant.price) * line.quantity, 0);
  const itemLines = input.lines.map((line) => {
    const option = line.variant.title && line.variant.title !== "Default" ? ` (${clean(line.variant.title)})` : "";
    return `${line.quantity} x ${clean(line.product.name)}${option} - ${formatMoney(Number(line.variant.price) * line.quantity, input.currency)}`;
  });
  const details = [
    `Name: ${clean(input.customer.name)}`,
    `Email: ${clean(input.customer.email)}`,
    input.customer.phone.trim() ? `Phone: ${clean(input.customer.phone)}` : "",
    input.needsShipping && input.customer.address.trim() ? `Ship to: ${clean(input.customer.address)}` : "",
  ].filter(Boolean);
  const body = [
    `Hi ${clean(input.storeName)}, I would like to place this order:`,
    "",
    ...itemLines,
    "",
    `Total: ${formatMoney(total, input.currency)}`,
    "",
    ...details,
    input.note.trim() ? `\nNote: ${input.note.trim()}` : "",
    "",
    "Please reply with how to pay and when I can expect it. Thank you!",
  ].join("\n");
  return { subject: `Order request for ${clean(input.storeName)}`, body };
}

// Some email apps refuse very long links, so the body is shortened to fit. The full text is always available through the Copy button.
export const maxMailtoLength = 1800;
export function emailOrderHref(email: string, subject: string, body: string): string {
  const to = email.trim();
  if (!emailPattern.test(to)) return "";
  const build = (text: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  let text = body;
  while (build(text).length > maxMailtoLength && text.length > 80) text = `${text.slice(0, Math.floor(text.length * 0.9)).trimEnd()}…`;
  return build(text);
}
