// Offline test: the optional store profile (migration 269). The form checks match the database rules, the public block only shows safe
// links, every database call matches the real function (names and argument names), and nothing breaks when the function is missing.
import fs from "node:fs";
import { mailtoHref, metaDescription, normalizeStoreProfile, profileFromRow, profileHasContent, socialHref, storeProfileLimits, telHref } from "../src/lib/storeProfile.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const sql = fs.readFileSync("supabase/migrations/269_store_profile.sql", "utf8");
const live = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
const store = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
const reasons = fs.readFileSync("src/lib/commerceRpcReason.ts", "utf8");

// ---- form rules
const ok = normalizeStoreProfile({ about: "  Candles  ", contactEmail: " Hello@Example.COM ", contactPhone: " (555) 123-4567 ", socialUrl: " https://instagram.com/shop " });
check("a good profile is trimmed and the email is lower-cased", ok.ok && ok.args.about_value === "Candles" && ok.args.contact_email_value === "hello@example.com" && ok.args.contact_phone_value === "(555) 123-4567" && ok.args.social_url_value === "https://instagram.com/shop");
check("empty boxes are allowed and mean clear", normalizeStoreProfile({ about: "", contactEmail: "", contactPhone: "", socialUrl: "" }).ok);
const bad = (patch) => normalizeStoreProfile({ about: "", contactEmail: "", contactPhone: "", socialUrl: "", ...patch });
check("too-long About, bad email, letters in phone, non-https and markup links are refused", !bad({ about: "a".repeat(601) }).ok && !bad({ contactEmail: "nope" }).ok && !bad({ contactEmail: "a<b>@x.co" }).ok && !bad({ contactPhone: "call me" }).ok && !bad({ socialUrl: "http://x.co" }).ok && !bad({ socialUrl: 'https://x.co/"><script>' }).ok && bad({ about: "a".repeat(600) }).ok);
check("the form's messages are exactly the database messages", ["About text must be 600 characters or fewer.", "Enter a valid contact email.", "Enter a valid contact phone number.", "Enter a social link that starts with https://."].every((m) => sql.includes(`raise exception '${m}'`) && reasons.includes(`"${m}"`)));
check("the limits match the database (600 / 254 / 40 / 300)", storeProfileLimits.about === 600 && storeProfileLimits.email === 254 && storeProfileLimits.phone === 40 && storeProfileLimits.social === 300 && /length\(clean_about\) > 600/.test(sql) && /length\(clean_email\) > 254/.test(sql) && /length\(clean_phone\) > 40/.test(sql) && /length\(clean_social\) > 300/.test(sql));

// ---- public links are re-checked
check("only real emails, phones and https links become clickable", mailtoHref("a@b.co") === "mailto:a@b.co" && mailtoHref("javascript:alert(1)") === "" && telHref("(555) 123-4567") === "tel:5551234567" && telHref("+1 555 123 4567") === "tel:+15551234567" && telHref("12") === "" && telHref("x") === "" && socialHref("https://a.co/x") === "https://a.co/x" && socialHref("javascript:alert(1)") === "" && socialHref("http://a.co") === "");
check("rows from either function read safely, junk becomes empty text", JSON.stringify(profileFromRow(null)) === JSON.stringify({ about: "", contactEmail: "", contactPhone: "", socialUrl: "" }) && profileFromRow({ about: 5, contact_email: "a@b.co" }).about === "" && profileFromRow({ contact_email: "a@b.co" }).contactEmail === "a@b.co" && profileHasContent(profileFromRow({})) === false && profileHasContent(profileFromRow({ about: "x" })) === true);
check("link-preview text is short and cut on a word", metaDescription("short") === "short" && metaDescription("word ".repeat(80)).length <= 160 && metaDescription("word ".repeat(80)).endsWith("…") && !/\s…$/.test(metaDescription("word ".repeat(80))));

// ---- database calls match the real functions (names and argument names)
check("the owner form calls the two owner functions with the real argument names", /supabase\.rpc\("get_my_store_profile"\)/.test(live) && /supabase\.rpc\("save_my_store_profile", check\.args\)/.test(live) && /about_value text/.test(sql) && /contact_email_value text/.test(sql) && /contact_phone_value text/.test(sql) && /social_url_value text/.test(sql));
check("the normalized arguments use exactly those four names", ["about_value", "contact_email_value", "contact_phone_value", "social_url_value"].every((n) => fs.readFileSync("src/lib/storeProfile.ts", "utf8").includes(`${n}: string`)));
check("the public store calls the public function with the real argument name", /supabase\.rpc\("get_public_store_profile", \{ store_slug_value: slug \}\)/.test(store) && /get_public_store_profile\(store_slug_value text\)/.test(sql));
check("anon may read the public profile and not the owner functions (as granted by the migration)", /grant execute on function public\.get_public_store_profile\(text\) to anon, authenticated;/.test(sql) && /revoke all on function public\.get_my_store_profile\(\) from public, anon;/.test(sql) && /revoke all on function public\.save_my_store_profile\(text, text, text, text\) from public, anon;/.test(sql));

// ---- the pages stay safe and optional
check("a missing function or any failure only hides the About block (the store keeps working)", /async function loadProfile\(\)[\s\S]{0,500}catch \{ \/\* the store works without it \*\/ \}/.test(store) && /if \(result\.error \|\| !result\.data\) return;/.test(store));
check("the owner form only appears when the profile loaded, and a failed load never blocks the page", /\{profileLoaded \? <section[^>]*data-testid="store-profile-form"/.test(live) && /if \(!profileResult\.error && profileResult\.data\) \{ setProfile\(profileFromRow\(profileResult\.data\)\); setProfileLoaded\(true\); \} else \{ setProfileLoaded\(false\); \}/.test(live));
check("the form says it is public and optional", /shown publicly at the bottom of your store/.test(live) && /optional-tag">optional/.test(live));
check("the public block builds links only through the safe helpers and opens social links safely", /href=\{mailtoHref\(profile\.contactEmail\)\}/.test(store) && /href=\{telHref\(profile\.contactPhone\)\}/.test(store) && /href=\{socialHref\(profile\.socialUrl\)\} target="_blank" rel="noopener noreferrer"/.test(store) && !/dangerouslySetInnerHTML/.test(store));
check("the page title and link preview use the shop's own words and are restored when leaving", /metaDescription\(about\)/.test(store) && /if \(created\) tag\?\.remove\(\); else if \(previous !== null\) tag\?\.setAttribute\("content", previous\)/.test(store));
check("no NXQX wording was added to the public block", !/NXQ/.test(store.slice(store.indexOf('data-testid="store-about"'), store.indexOf("<StoreCredit />"))));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store-profile checks passed (offline).");
process.exit(failures ? 1 : 0);
