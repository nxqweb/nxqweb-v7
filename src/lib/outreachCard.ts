// The owner's printable outreach card: a name, a phone number and the site address become a small card with a scannable code to the plans page.
// Pure functions only (checked by scripts/test-outreach-card.mjs). Nothing is stored on a server and nothing is sent anywhere.

export type CardInput = { name: string; phone: string; site: string };
export type CardResult = { ok: true; name: string; phone: string; plansUrl: string; siteHost: string } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex
const bad = /[<>"\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/; // markup, control, zero-width and text-direction characters
export const cardLimits = { name: 60, phone: 30, site: 100 };

// Accepts "example.com", "https://example.com" or "https://example.com/anything"; always returns the plans page of that HTTPS site. No credentials, no ports, no odd hosts.
export function plansUrlFor(site: string): string | null {
  const raw = site.trim();
  if (!raw || raw.length > cardLimits.site || bad.test(raw) || /\s/.test(raw)) return null;
  const withScheme = /^https:\/\//i.test(raw) ? raw : /^[a-z][a-z0-9+.-]*:/i.test(raw) ? "" : `https://${raw}`;
  if (!withScheme) return null;
  let url: URL;
  try { url = new URL(withScheme); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!/^(?=.{4,100}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)) return null;
  return `https://${url.hostname.toLowerCase()}/plans`;
}

export function checkCard(input: CardInput): CardResult {
  const name = input.name.replace(/\s+/g, " ").trim();
  const phone = input.phone.replace(/\s+/g, " ").trim();
  if (name.length < 2) return { ok: false, error: "Type your name (at least 2 characters)." };
  if (name.length > cardLimits.name) return { ok: false, error: `Your name can be up to ${cardLimits.name} characters.` };
  if (bad.test(name)) return { ok: false, error: "Your name has a character that is not allowed. Please retype it." };
  if (phone.length > cardLimits.phone || (phone && (!/^[0-9+()\-. ]+$/.test(phone) || phone.replace(/\D/g, "").length < 7))) return { ok: false, error: "Type a phone number with at least 7 digits (digits, spaces, + ( ) - . only), or leave it empty." };
  const plansUrl = plansUrlFor(input.site);
  if (!plansUrl) return { ok: false, error: "Type your website address, like example.com or https://example.com (https only, no spaces)." };
  return { ok: true, name, phone, plansUrl, siteHost: new URL(plansUrl).hostname };
}
