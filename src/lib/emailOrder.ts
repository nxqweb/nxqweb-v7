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

// Lone half-emoji characters make encodeURIComponent throw, so they are swapped for a replacement mark before anything is encoded.
// Lone half-emoji characters make encodeURIComponent throw, so they are swapped for a replacement mark before anything is encoded.
// (A plain loop, not a regex lookbehind: older iPhones cannot parse lookbehind and would fail to load the whole store.)
function wellFormed(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { out += text[i] + text[i + 1]; i += 1; } else out += "\uFFFD";
    } else if (code >= 0xdc00 && code <= 0xdfff) out += "\uFFFD";
    else out += text[i];
  }
  return out;
}
const clean = (text: string) => wellFormed(text).replace(/[\r\n]+/g, " ").trim();

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
  // Who the order is from comes FIRST: if a long order has to be shortened to fit a link, the items are trimmed, never the customer's contact details.
  const body = [
    `Hi ${clean(input.storeName)}, I would like to place this order:`,
    "",
    ...details,
    "",
    ...itemLines,
    "",
    `Total: ${formatMoney(total, input.currency)}`,
    input.note.trim() ? `\nNote: ${wellFormed(input.note.trim())}` : "",
    "",
    "Please reply with how to pay and when I can expect it. Thank you!",
  ].join("\n");
  return { subject: `Order request for ${clean(input.storeName)}`, body };
}

// Some email apps refuse very long links, so the body is shortened to fit. The full text is always available through the Copy button.
export const maxMailtoLength = 1800;
export function emailOrderLink(email: string, subject: string, body: string): { href: string; shortened: boolean } {
  const to = email.trim();
  if (!emailPattern.test(to)) return { href: "", shortened: false };
  const build = (text: string) => `mailto:${to}?subject=${encodeURIComponent(wellFormed(subject))}&body=${encodeURIComponent(wellFormed(text))}`;
  let chars = Array.from(body); // whole characters, so an emoji is never cut in half
  let shortened = false;
  while (build(chars.join("")).length > maxMailtoLength && chars.length > 80) {
    chars = [...Array.from(chars.slice(0, Math.floor(chars.length * 0.9)).join("").trimEnd()), "…"];
    shortened = true;
  }
  return { href: build(chars.join("")), shortened };
}
export function emailOrderHref(email: string, subject: string, body: string): string {
  return emailOrderLink(email, subject, body).href;
}
