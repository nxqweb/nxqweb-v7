// Offline test for the owner's "Website content" on her PUBLIC store page: only what is switched on and non-empty is shown, social links must be the real https site for their label,
// phone/email become links only when they pass the shop-profile checks, the older About block never repeats it, and the page reads it with a failure-tolerant public call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const libSource = read("src/lib/storeWebsiteContent.ts");

// the lib imports ./storeProfile.ts; a mutated copy must sit next to it, so plant copies in src/lib itself under a throwaway name and always remove them
async function load(source, tag) {
  const file = path.join("src/lib", `__tmp_${process.pid}_${tag}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(`${path.resolve(file)}?${Date.now()}${tag}`); } finally { fs.rmSync(file, { force: true }); }
}
const base = (over = {}) => ({
  announcement: { enabled: true, text: "Free local pickup this week!" },
  homepage_message: { enabled: true, heading: "Welcome", body: "Small-batch candles and soap." },
  verse: { enabled: true, text: "Let your light shine before others.", reference: "Matthew 5:16", message: "Blessings!" },
  story: { heading: "Our story", body: "Hand poured in small batches." },
  contact: { phone: "(555) 123-4567", email: "Shop@Example.com", business_hours: "Sat 9-3", pickup_details: "Porch pickup" },
  policies: { shipping: "Ships in 3 days", returns: "No returns on candles", custom_orders: "Ask first" },
  social: { instagram: "https://www.instagram.com/glow", facebook: "https://facebook.com/glow", tiktok: "https://tiktok.com/@glow", youtube: "https://youtu.be/abc" },
  custom_page: { enabled: false }, ...over,
});

function suite(m) {
  const w = m.websiteFromRow(base());
  const ok = {};
  ok.full = w.announcement.includes("Free local pickup") && w.message?.heading === "Welcome" && w.verse?.reference === "Matthew 5:16" && w.story?.body.startsWith("Hand poured") && w.hours === "Sat 9-3" && w.pickup === "Porch pickup" && w.policies.length === 3 && w.social.length === 4 && w.email === "shop@example.com" && w.phone === "(555) 123-4567";
  const off = m.websiteFromRow(base({ announcement: { enabled: false, text: "hidden" }, homepage_message: { enabled: false, heading: "h", body: "hidden body" }, verse: { enabled: false, text: "hidden verse" } }));
  ok.switchedOff = off.announcement === "" && off.message === null && off.verse === null;
  const blank = m.websiteFromRow(base({ announcement: { enabled: true, text: "   " }, homepage_message: { enabled: true, heading: "Only a heading", body: "" }, verse: { enabled: true, text: "" }, story: { heading: "Only heading", body: "" }, contact: {}, policies: { shipping: " ", returns: "", custom_orders: "" }, social: {} }));
  ok.blank = blank.announcement === "" && blank.message === null && blank.verse === null && blank.story === null && !m.websiteHasTop(blank) && !m.websiteHasInfo(blank);
  const evil = m.websiteFromRow(base({ social: { instagram: "javascript:alert(1)", facebook: "https://evil.example.com/glow", tiktok: "http://tiktok.com/@glow", youtube: "https://user:pw@youtube.com/x", } }));
  ok.badSocial = evil.social.length === 0;
  ok.lookalike = m.safeSocialLink("instagram", "https://notinstagram.com/x") === "" && m.safeSocialLink("instagram", "https://instagram.com.evil.io/x") === "" && m.safeSocialLink("instagram", "https://m.instagram.com/glow").startsWith("https://m.instagram.com") && m.safeSocialLink("facebook", "https://instagram.com/x") === "";
  const oddContact = m.websiteFromRow(base({ contact: { phone: "call me", email: "a@b.com?bcc=x@y.com", business_hours: "", pickup_details: "" } }));
  ok.oddContact = oddContact.phone === "" && oddContact.email === "";
  const trash = [null, undefined, 5, "x", [], { announcement: "oops", story: 5, social: [] }].map((r) => m.websiteFromRow(r));
  ok.trash = trash.every((t) => t.announcement === "" && t.message === null && t.story === null && t.social.length === 0 && !m.websiteHasInfo(t));
  const long = m.websiteFromRow(base({ announcement: { enabled: true, text: "a".repeat(900) }, story: { heading: "h".repeat(400), body: "b".repeat(9000) } }));
  ok.limits = long.announcement.length === 300 && long.story.body.length === 2000 && long.story.heading.length === 120;
  const profile = { about: "Old about", contactEmail: "old@x.com", contactPhone: "555 555 5555", socialUrl: "https://instagram.com/old" };
  const d1 = m.dedupeProfile(profile, w);
  const d2 = m.dedupeProfile(profile, m.emptyWebsite);
  ok.dedupe = d1.about === "" && d1.contactEmail === "" && d1.contactPhone === "" && d1.socialUrl === "" && d2.about === "Old about" && d2.contactEmail === "old@x.com" && d2.socialUrl === "https://instagram.com/old";
  return ok;
}
const good = suite(await load(libSource, "good"));
for (const [k, label] of [["full", "everything that is switched on and filled in is read, tidied (email lower-cased) and kept"], ["switchedOff", "a switched-off announcement, message or verse is never shown, even if text was saved"], ["blank", "blank or heading-only sections show nothing"], ["badSocial", "javascript:, the wrong website for a label, http:// and links with a login inside are all dropped"], ["lookalike", "look-alike domains are refused; a real mobile subdomain is fine"], ["oddContact", "an email with extra mail headers, or words in the phone box, never become links"], ["trash", "unexpected data (null, numbers, lists) gives an empty page, never an error"], ["limits", "very long text is cut to the same limits as the editor"], ["dedupe", "the older About block drops exactly the parts the website content already covers"]]) check(label, good[k] === true);

const plant = async (name, from, to, key) => {
  if (!libSource.includes(from)) { check(`PLANTED BUG could not be planted (source changed): ${name}`, false); return; }
  const bugged = suite(await load(libSource.replace(from, to), `bug${key}${name.length}`));
  check(`PLANTED BUG caught: ${name}`, bugged[key] === false);
};
await plant("the announcement shows even when switched off", 'a.enabled === true ? text(a.text, websiteLimits.announcement) : ""', 'text(a.text, websiteLimits.announcement)', "switchedOff");
await plant("any website is accepted for a social label", "return rule.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.href : \"\";", "return url.href;", "badSocial");
await plant("look-alike domains accepted", "host === domain || host.endsWith(`.${domain}`)", "host.endsWith(domain)", "lookalike");
await plant("http links accepted", 'url.protocol !== "https:" || url.username || url.password', "url.username || url.password", "badSocial");
await plant("the About block repeats the story", "about: w.story ? \"\" : profile.about", "about: profile.about", "dedupe");

const store = read("src/pages/PublicCommerceStorefront.tsx");
const parts = read("src/components/StoreWebsiteSections.tsx");
check("the store page reads the content with the public function, ignores any failure, and shows nothing when the store has none", /get_public_commerce_website_content", \{ store_slug_value: slug \}/.test(store) && /if \(result\.error \|\| !result\.data\) return;/.test(store) && /catch \{ \/\* the store works without it \*\/ \}/.test(store) && /if \(next\.announcement \|\| websiteHasTop\(next\) \|\| websiteHasInfo\(next\)\) setWebsite\(next\)/.test(store));
check("the announcement sits above the shop header; message, verse and info are hidden while an order is on screen", /<StoreAnnouncement website=\{website\} \/>\n      <div className="panel-title panel-title-row store-header">/.test(store) && /!order \? <StoreMessageAndVerse website=\{website\} \/>/.test(store) && /!order \? <StoreInfo website=\{website\} storeName=\{data\.store\.name\} \/>/.test(store));
check("the older About block is deduplicated against it", /dedupeProfile\(profile, website \?\? emptyWebsite\)/.test(store));
check("text is rendered as plain text and links only come from the checked helpers (no raw HTML anywhere)", !/dangerouslySetInnerHTML/.test(store + parts) && /target="_blank" rel="noopener noreferrer"/.test(parts) && /mailtoHref\(website\.email\)/.test(parts) && /telHref\(website\.phone\)/.test(parts));
check("policies are collapsible sections with a tappable summary", /<details key=\{policy\.label\}><summary>/.test(parts) && /min-height: 44px/.test(read("src/styles/storefront-theme.css")));
check("no database change: only the existing public function from migration 108 is called, and it is open to visitors", /grant execute on function public\.get_public_commerce_website_content\(text\) to anon, authenticated;/.test(read("supabase/migrations/108_commerce_website_content_and_custom_page.sql")));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
