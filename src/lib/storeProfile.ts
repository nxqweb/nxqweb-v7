// Optional public store profile (migration 269): a short About and how customers can reach the shop owner. The limits and rules here mirror
// the database function so a mistake is caught before saving, and the database still re-checks everything. Pure helpers, no network.
export const storeProfileLimits = { about: 600, email: 254, phone: 40, social: 300 } as const;

export type StoreProfile = { about: string; contactEmail: string; contactPhone: string; socialUrl: string };
export const emptyStoreProfile: StoreProfile = { about: "", contactEmail: "", contactPhone: "", socialUrl: "" };

export type StoreProfileArgs = { about_value: string; contact_email_value: string; contact_phone_value: string; social_url_value: string };
export type StoreProfileCheck = { ok: true; args: StoreProfileArgs } | { ok: false; error: string };

const emailPattern = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const phonePattern = /^[0-9+()\-.\s]+$/;
const httpsPattern = /^https:\/\/[^\s<>"]+$/i;

export function normalizeStoreProfile(input: StoreProfile): StoreProfileCheck {
  const about = input.about.trim();
  const email = input.contactEmail.trim().toLowerCase();
  const phone = input.contactPhone.trim();
  const social = input.socialUrl.trim();
  if (about.length > storeProfileLimits.about) return { ok: false, error: `About text must be ${storeProfileLimits.about} characters or fewer.` };
  if (email && (email.length > storeProfileLimits.email || !emailPattern.test(email))) return { ok: false, error: "Enter a valid contact email." };
  if (phone && (phone.length > storeProfileLimits.phone || !phonePattern.test(phone))) return { ok: false, error: "Enter a valid contact phone number." };
  if (social && (social.length > storeProfileLimits.social || !httpsPattern.test(social))) return { ok: false, error: "Enter a social link that starts with https://." };
  return { ok: true, args: { about_value: about, contact_email_value: email, contact_phone_value: phone, social_url_value: social } };
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }

// Reads the owner function result or the public function result (same keys); anything unexpected becomes empty text.
export function profileFromRow(row: unknown): StoreProfile {
  const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  return { about: text(source.about), contactEmail: text(source.contact_email), contactPhone: text(source.contact_phone), socialUrl: text(source.social_url) };
}

export function profileHasContent(profile: StoreProfile): boolean {
  return Boolean(profile.about.trim() || profile.contactEmail.trim() || profile.contactPhone.trim() || profile.socialUrl.trim());
}

// Links for the public store. Stored values are re-checked here so a bad value can never become a clickable link.
export function mailtoHref(email: string): string { return emailPattern.test(email.trim()) ? `mailto:${email.trim()}` : ""; }
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^0-9+]/g, "");
  return phonePattern.test(trimmed) && digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : "";
}
export function socialHref(url: string): string { return httpsPattern.test(url.trim()) ? url.trim() : ""; }

// A short summary for search results and link previews, cut on a word boundary.
export function metaDescription(about: string, max = 160): string {
  const flat = about.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
