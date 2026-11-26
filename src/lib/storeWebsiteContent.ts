// What a shop owner writes on the "Website content" page (migration 108) as it appears on her PUBLIC store page: an announcement bar, a homepage message, an optional verse, her
// story, hours and pickup, contact, three policies and social links. The database function returns raw saved text; everything here re-checks it so a bad value can never become
// a clickable link or break the page. Pure functions (no network) so a test can pin each case.
import { mailtoHref, telHref } from "./storeProfile.ts";

export const websiteLimits = { announcement: 300, heading: 120, body: 2000, verse: 600, reference: 80, note: 400, facts: 1000, policy: 2000 } as const;

export type StoreWebsite = {
  announcement: string;
  message: { heading: string; body: string } | null;
  verse: { text: string; reference: string; note: string } | null;
  story: { heading: string; body: string } | null;
  hours: string;
  pickup: string;
  phone: string;
  email: string;
  policies: { label: string; text: string }[];
  social: { label: string; href: string }[];
};
export const emptyWebsite: StoreWebsite = { announcement: "", message: null, verse: null, story: null, hours: "", pickup: "", phone: "", email: "", policies: [], social: [] };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.split("\u0000").join("").replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

// Only the shop's own social site is accepted for each label: https, no login inside the link, and the right domain.
const socialHosts: Record<string, { label: string; domains: string[] }> = {
  instagram: { label: "Instagram", domains: ["instagram.com"] },
  facebook: { label: "Facebook", domains: ["facebook.com", "fb.com"] },
  tiktok: { label: "TikTok", domains: ["tiktok.com"] },
  youtube: { label: "YouTube", domains: ["youtube.com", "youtu.be"] },
};
export function safeSocialLink(key: string, raw: unknown): string {
  const rule = socialHosts[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!rule || !value || value.length > 300 || /\s/.test(value)) return "";
  let url: URL;
  try { url = new URL(value); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  const host = url.hostname.toLowerCase();
  return rule.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.href : "";
}

export function websiteFromRow(raw: unknown): StoreWebsite {
  const root = obj(raw);
  const a = obj(root.announcement); const m = obj(root.homepage_message); const v = obj(root.verse); const s = obj(root.story); const c = obj(root.contact); const p = obj(root.policies); const so = obj(root.social);
  const announcement = a.enabled === true ? text(a.text, websiteLimits.announcement) : "";
  const message = m.enabled === true && text(m.body, websiteLimits.body) ? { heading: text(m.heading, websiteLimits.heading), body: text(m.body, websiteLimits.body) } : null;
  const verse = v.enabled === true && text(v.text, websiteLimits.verse) ? { text: text(v.text, websiteLimits.verse), reference: text(v.reference, websiteLimits.reference), note: text(v.message, websiteLimits.note) } : null;
  const story = text(s.body, websiteLimits.body) ? { heading: text(s.heading, websiteLimits.heading), body: text(s.body, websiteLimits.body) } : null;
  const email = text(c.email, 254); const phone = text(c.phone, 40);
  const policies = [["Shipping", p.shipping], ["Returns", p.returns], ["Custom orders", p.custom_orders]]
    .map(([label, value]) => ({ label: String(label), text: text(value, websiteLimits.policy) })).filter((item) => item.text);
  const social = Object.keys(socialHosts).map((key) => ({ label: socialHosts[key].label, href: safeSocialLink(key, so[key]) })).filter((item) => item.href);
  return {
    announcement, message, verse, story,
    hours: text(c.business_hours, websiteLimits.facts), pickup: text(c.pickup_details, websiteLimits.facts),
    phone: telHref(phone) ? phone : "", email: mailtoHref(email) ? email.toLowerCase() : "",
    policies, social,
  };
}

export const websiteHasTop = (w: StoreWebsite) => Boolean(w.message || w.verse);
export const websiteHasInfo = (w: StoreWebsite) => Boolean(w.story || w.hours || w.pickup || w.phone || w.email || w.policies.length || w.social.length);

// The older About block (migration 269) must not repeat what this content already says: blank out the parts the website content covers.
export function dedupeProfile<T extends { about: string; contactEmail: string; contactPhone: string; socialUrl: string }>(profile: T, w: StoreWebsite): T {
  return { ...profile, about: w.story ? "" : profile.about, contactEmail: w.email ? "" : profile.contactEmail, contactPhone: w.phone ? "" : profile.contactPhone, socialUrl: w.social.length ? "" : profile.socialUrl };
}
