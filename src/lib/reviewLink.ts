// "Get more reviews": the client saves ONE public review link. This file only checks and tidies what they typed and names the site it points to.
// The database (draft 05_reviews_collector) applies the same rules again, so a bad link can never be stored even if this page is bypassed.

export const maxReviewLinkLength = 500;
const linkPattern = /^https:\/\/[^\s<>"'`@]+$/i;
const hostPattern = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?::[0-9]{1,5})?(?:[/?#]|$)/i;

export type ReviewLinkCheck = { ok: true; url: string } | { ok: false; error: string };

export function checkReviewLink(input: string): ReviewLinkCheck {
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, error: "Paste the link where customers leave you a review." };
  if (/^http:\/\//i.test(text)) return { ok: false, error: "Use the secure version of the link: it must start with https://" };
  if (!/^https:\/\//i.test(text)) return { ok: false, error: "The link must start with https:// (copy it from your review page's Share button)." };
  if (text.length > maxReviewLinkLength) return { ok: false, error: "That link is too long. Use the short link from your review page's Share button." };
  if (!linkPattern.test(text)) return { ok: false, error: "The link cannot have spaces, quotes or a username in it. Copy it again from your review page." };
  if (!hostPattern.test(text)) return { ok: false, error: "That does not look like a web address. Copy it again from your review page." };
  return { ok: true, url: text };
}

export function checkBusinessName(input: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(input ?? "").replace(/\s+/g, " ").trim();
  if (name.length > 80) return { ok: false, error: "Keep the business name to 80 characters or fewer." };
  if (/[<>]/.test(name)) return { ok: false, error: "The business name cannot contain < or > characters." };
  return { ok: true, name };
}

// A friendly name for where the link goes, shown next to the link so the client can tell they pasted the right one. Anything unknown shows its own host.
const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function reviewSiteName(url: string): string {
  const host = (url.match(hostPattern)?.[1] ?? "").toLowerCase().replace(/^www\./, "");
  if (!host) return "your review page";
  if (["g.page", "g.co", "maps.app.goo.gl", "goo.gl"].includes(host) || hostIs(host, "google.com") || hostIs(host, "google.co.uk")) return "Google";
  if (hostIs(host, "yelp.com")) return "Yelp";
  if (hostIs(host, "facebook.com") || host === "fb.me" || host === "fb.com") return "Facebook";
  if (hostIs(host, "trustpilot.com")) return "Trustpilot";
  if (hostIs(host, "tripadvisor.com")) return "Tripadvisor";
  if (hostIs(host, "nextdoor.com")) return "Nextdoor";
  return host;
}

// The printed QR code holds up to this many bytes of link; a longer link still works in the messages, only the card's code cannot carry it.
export const qrLinkMaxBytes = 213; // equals qrCode.qrMaxBytes (a test checks this); no runtime import so this file stays easy to test
export function linkFitsQr(url: string): boolean { return new TextEncoder().encode(url).length <= qrLinkMaxBytes; }
