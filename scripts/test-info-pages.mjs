// Offline test: the public Privacy, Terms, About and Contact pages. They must exist as real routes, tell the truth about what is collected (matched
// against the data inventory), carry a visible draft notice until a lawyer signs off, never ask for or promise anything the system does not do, and
// be reachable from the footers.
import fs from "node:fs";
import { aboutPage, contactPage, footerLinks, infoPages, legalReviewComplete, privacyPage, serviceProviders, termsPage } from "../src/lib/legalContent.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const app = read("src/App.tsx");
const page = read("src/pages/PublicInfoPage.tsx");
const inventory = read("docs/PRIVACY_DATA_INVENTORY.md");
const allText = (p) => [p.title, p.intro, ...p.sections.flatMap((s) => [s.heading, ...(s.paragraphs || []), ...(s.bullets || [])])].join("\n");

// ---- routes and links
check("all four pages are real routes before the home page fallback", ["about", "contact", "privacy", "terms"].every((s) => new RegExp(`path === "/${s}"\\) return <PublicInfoPage slug="${s}" />;`).test(app)) && app.indexOf('path === "/privacy"') < app.indexOf("return <PublicHome />;"));
check("the footer links point at exactly those four routes", footerLinks.map((l) => l.href).sort().join() === "/about,/contact,/privacy,/terms" && footerLinks.every((l) => app.includes(`path === "${l.href}"`)));
check("the home and plans footers show the links", /<PublicFooterLinks \/>/.test(read("src/pages/PublicHome.tsx")) && /<PublicFooterLinks \/>/.test(read("src/pages/PublicPlans.tsx")));
check("the page layout shows the footer links and the page title in the tab", /aria-label="Company and legal"/.test(page) && /document\.title = `\$\{page\.title\} \| NXQX-Web`/.test(page));

// ---- the draft notice
check("until a lawyer signs off, the privacy and terms pages show a visible draft notice, and About and Contact do not", legalReviewComplete === false && privacyPage.legal && termsPage.legal && !aboutPage.legal && !contactPage.legal && /page\.legal && !legalReviewComplete \? <div className="notice-card info-draft" role="note" data-testid="legal-draft-notice">/.test(page) && /Draft, pending legal review/.test(page));
check("every unfinished item is marked in square brackets so it cannot be mistaken for a promise", /\[To be confirmed/.test(allText(termsPage)) && !/\bTBD\b|lorem|placeholder|todo/i.test([privacyPage, termsPage, aboutPage, contactPage].map(allText).join("\n")));

// ---- honesty against the real system
check("every service provider in the privacy inventory is named on the privacy page", ["Supabase", "Netlify", "GitHub", "Cloudflare", "Resend", "Stripe"].every((n) => inventory.includes(n) && allText(privacyPage).includes(n)) && /Scanii/.test(allText(privacyPage)) && /Cloudmersive/.test(allText(privacyPage)));
check("the provider list on the page matches the shared list (no drift)", serviceProviders.every((p) => allText(privacyPage).includes(p)));
check("the page says what is NOT collected, and that card numbers are never stored by NXQX", /do not ask for card numbers/i.test(allText(privacyPage)) && /never store your card number/i.test(allText(privacyPage)));
check("retention figures match the inventory (messages 1,095 days, security and audit 2,555 days)", /1,095 days/.test(inventory) && /2,555 days/.test(inventory) && /about three years/.test(allText(privacyPage)) && /about seven years/.test(allText(privacyPage)));
check("it describes only data rights the system really offers (export and consent withdrawal in the portal)", /export/.test(inventory) && /consent withdrawal/.test(inventory) && /copy of your account data, or withdraw a consent/.test(allText(privacyPage)) && read("src/pages/ClientSecurityPrivacy.tsx").length > 0);
check("analytics is described as consent-based and not recording typed text, matching the inventory", /consent/.test(inventory) && /with the visitor's consent/.test(allText(privacyPage)) && /does not record what visitors type/.test(allText(privacyPage)));
check("no claim the system cannot back up (no 'we never', 'guarantee', 'secure 100%', 'we do not sell' only as written)", !/guarantee(?!s? (search|visitors))/i.test(allText(privacyPage)) && !/100%|military|unhackable|bank-level/i.test([privacyPage, termsPage, aboutPage].map(allText).join("\n")));
check("the terms promise no results (rankings, leads, sales) and put store duties on the store owner", /cannot promise search rankings, visitors, leads or sales/.test(allText(termsPage)) && /you are the seller/i.test(allText(termsPage)) && /responsible for your products, prices, orders, shipping, refunds, taxes/.test(allText(termsPage)));
check("the terms say domains stay the client's and we never need a registrar password (matches the domain flow)", /keep ownership of your domain name/.test(allText(termsPage)) && /never need your registrar password/.test(allText(termsPage)));
check("About and Contact promise nothing invented: no team size, address, phone, founding year or customer counts", ![aboutPage, contactPage].map(allText).join("\n").match(/\b(since \d{4}|founded|\d+ (clients|customers|employees|years)|our team of|headquarter|call us|phone number)\b/i));

// ---- contact
check("the contact page shows the support email from the app configuration, as a mail link", /appConfig\.supportEmail/.test(page) && /mailto:\$\{appConfig\.supportEmail\}/.test(page) && /data-testid="contact-email"/.test(page) && /supportEmail: import\.meta\.env\.VITE_SUPPORT_EMAIL/.test(read("src/lib/appConfig.ts")));
check("no sections are empty and every page has at least five", Object.values(infoPages).every((p) => p.sections.length >= 3 && p.sections.every((s) => s.heading && ((s.paragraphs || []).length || (s.bullets || []).length))) && privacyPage.sections.length >= 8 && termsPage.sections.length >= 8);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll info-page checks passed (offline).");
process.exit(failures ? 1 : 0);
