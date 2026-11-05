// Small helpers for custom-order requests on a Commerce store: (1) an optional "inspiration photo link" the customer can paste while uploaded pictures are held for security
// scanning, (2) reading that link back safely in the store owner's inbox, and (3) ready-made reply emails (a plain mailto link, so no email provider is needed).
// Pure functions so a test can pin every case. The link is stored inside the existing request text (no database change).
export const INSPIRATION_PREFIX = "Inspiration link: ";
const MAX_LINK = 300;
export const MAX_REQUEST_TEXT = 5000;

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

// Empty is fine (the field is optional). Only http(s) links to a real-looking site are accepted: never javascript:, data:, a link with a login inside it, a local address or a bare IP.
export function normalizeInspirationLink(raw: string): LinkResult {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, url: "" };
  if (text.length > MAX_LINK) return { ok: false, error: "That link is too long. Paste the page address only." };
  if (/\s/.test(text)) return { ok: false, error: "A link cannot contain spaces. Paste just the page address." };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch { return { ok: false, error: "That does not look like a web address." }; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "Use a web link that starts with https://" };
  if (parsed.username || parsed.password) return { ok: false, error: "Remove the login details from that link." };
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return { ok: false, error: "That does not look like a public website address." };
  return { ok: true, url: parsed.href };
}

// Appends the link as the LAST line of the details. Returns an error text if the result would be too long for the database (5000 characters).
export function descriptionWithLink(description: string, url: string): { ok: true; text: string } | { ok: false; error: string } {
  const base = String(description ?? "").trim();
  if (!url) return { ok: true, text: base };
  const text = `${base}\n\n${INSPIRATION_PREFIX}${url}`;
  if (text.length > MAX_REQUEST_TEXT) return { ok: false, error: "Your details plus the link are too long. Please shorten the details a little." };
  return { ok: true, text };
}

// Reads the link line back. Only a line that is exactly the prefix plus a link that passes the same check is treated as a link; anything else stays plain text.
export function splitInspirationLink(description: string): { text: string; url: string } {
  const full = String(description ?? "");
  const lines = full.replace(/\r\n/g, "\n").split("\n");
  const last = lines[lines.length - 1] || "";
  if (!last.startsWith(INSPIRATION_PREFIX)) return { text: full, url: "" };
  const checked = normalizeInspirationLink(last.slice(INSPIRATION_PREFIX.length));
  if (!checked.ok || !checked.url || checked.url === "") return { text: full, url: "" };
  return { text: lines.slice(0, -1).join("\n").trim(), url: checked.url };
}

export type ReplyInput = { status: string; customerName: string; productName: string; storeName: string; note?: string };
const firstName = (name: string) => (String(name || "").trim().split(/\s+/)[0] || "there").slice(0, 40);
const clean = (value: string, max: number) => String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

// A friendly first draft for the owner to read and edit before sending. It never promises a price or date the owner did not write.
export function requestReplyDraft(input: ReplyInput): { subject: string; body: string } {
  const store = clean(input.storeName, 80) || "our shop";
  const item = clean(input.productName, 120) || "your request";
  const name = firstName(input.customerName);
  const note = clean(input.note || "", 600);
  const noteLine = note ? `\n\n${note}` : "";
  const signoff = `\n\nThank you,\n${store}`;
  switch (input.status) {
    case "accepted":
      return { subject: `Your request: ${item}`, body: `Hi ${name},\n\nGood news: I can make "${item}" for you.${noteLine}\n\nI will follow up with the details and how to pay.${signoff}` };
    case "declined":
      return { subject: `About your request: ${item}`, body: `Hi ${name},\n\nThank you so much for thinking of me for "${item}". I am sorry, but I am not able to make this one.${noteLine}\n\nI would love to help with something from my regular selection if you would like.${signoff}` };
    case "need_more_information":
      return { subject: `A question about your request: ${item}`, body: `Hi ${name},\n\nThanks for your request for "${item}". I need a little more information before I can say yes.${noteLine}\n\nCould you reply with those details?${signoff}` };
    case "quoted":
      return { subject: `Your request: ${item}`, body: `Hi ${name},\n\nThanks for your request for "${item}". Here is what I can offer:${noteLine}\n\nLet me know if you would like to go ahead.${signoff}` };
    default:
      return { subject: `Your request: ${item}`, body: `Hi ${name},\n\nThanks for your request for "${item}".${noteLine}${signoff}` };
  }
}

const SAFE_EMAIL = /^[^@\s?&#%<>"]+@[^@\s?&#%<>"]+\.[^@\s?&#%<>"]+$/;
const MAX_HREF = 1800;
// A mailto link, or "" when the address is not plain enough to trust. Long bodies are shortened so the link always works in mail apps.
export function mailtoHref(email: string, subject: string, body: string): string {
  const to = String(email || "").trim();
  if (!SAFE_EMAIL.test(to)) return "";
  const make = (text: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  let text = body;
  while (make(text).length > MAX_HREF && text.length > 40) text = `${text.slice(0, Math.floor(text.length * 0.8)).trimEnd()}...`;
  return make(text).length > MAX_HREF ? "" : make(text);
}
