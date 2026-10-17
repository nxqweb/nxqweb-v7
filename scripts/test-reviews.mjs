// Offline test: "Get more reviews" (Reviews collector v1). The link rules, card words and page wiring are checked here; the QR maker has its own test
// (scripts/test-qr-code.mjs); the database draft has a sidecar test in the local full-schema harness. Planted-bug controls prove the checks can fail.
import fs from "node:fs";
import { checkBusinessName, checkReviewLink, linkFitsQr, qrLinkMaxBytes, reviewSiteName } from "../src/lib/reviewLink.ts";
import { qrMaxBytes } from "../src/lib/qrCode.ts";
import { buildReviewTexts, reviewFairnessNotes } from "../src/lib/reviewCard.ts";
import { friendlyReviewsError, reviewSettingsFromRow } from "../src/lib/reviewsGateway.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

// ---- link rules
const good = ["https://g.page/r/CabcDEF/review", "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4", "https://www.yelp.com/biz/light-of-the-world", "https://maps.app.goo.gl/AbC123", "https://www.facebook.com/lightoftheworld/reviews", "  https://g.page/r/abc/review  ", "https://example.com:8443/review#top"];
check("real review links are accepted (and trimmed)", good.every((u) => checkReviewLink(u).ok) && checkReviewLink("  https://g.page/r/abc/review  ").url === "https://g.page/r/abc/review");
const bad = ["", "   ", "http://example.com/review", "ftp://example.com", "javascript:alert(1)", "www.example.com/review", "example.com", "https://", "https://localhost/x", "https://exa mple.com/x", "https://user:pass@example.com/x", "https://example.com/<script>", 'https://example.com/"x', "https://example.com/'x", "https://example.com/`x", "https://" + "a".repeat(600) + ".com", "https://-.com", "data:text/html,<b>x</b>"];
check("junk, insecure, script, username and markup links are refused with a plain message", bad.every((u) => { const r = checkReviewLink(u); return r.ok === false && typeof r.error === "string" && r.error.length > 10 && !/regex|undefined|\[object/i.test(r.error); }), bad.filter((u) => checkReviewLink(u).ok).join(" | "));
check("http:// gets a specific hint to use https", /https:\/\//.test(checkReviewLink("http://example.com/review").error));
check("business names are tidied, and markup or long names are refused", checkBusinessName("  Light   of  the World ").name === "Light of the World" && checkBusinessName("").ok && checkBusinessName("Bad <b>").ok === false && checkBusinessName("n".repeat(81)).ok === false && checkBusinessName("n".repeat(80)).ok);
check("the site name is friendly for the big review sites and falls back to the host", reviewSiteName("https://g.page/r/abc") === "Google" && reviewSiteName("https://search.google.com/local/writereview?placeid=x") === "Google" && reviewSiteName("https://www.yelp.com/biz/x") === "Yelp" && reviewSiteName("https://www.facebook.com/x/reviews") === "Facebook" && reviewSiteName("https://www.trustpilot.com/review/x.com") === "Trustpilot" && reviewSiteName("https://reviews.example.org/me") === "reviews.example.org");

// ---- card words
const t = buildReviewTexts("  Light of the World  ", "https://g.page/r/abc/review");
check("card and messages carry the business name and the exact link", t.heading === "Thanks for choosing Light of the World" && t.smsText.includes("https://g.page/r/abc/review") && t.smsText.includes("Light of the World") && t.emailBody.includes("https://g.page/r/abc/review") && t.emailSubject.includes("Light of the World"));
check("without a name the words still read naturally", (() => { const x = buildReviewTexts("", "https://g.page/r/abc/review"); return x.heading === "Thanks for choosing us" && !/undefined|null| {2}/.test(x.smsText + x.emailBody + x.heading); })());
const all = [t.heading, t.line, t.scanLabel, t.smsText, t.emailSubject, t.emailBody, ...reviewFairnessNotes].join(" ");
check("the words never offer rewards for reviews or promise rankings", !/\b(free|discount|coupon|reward|gift|win|prize|% off|ranking will|rank higher|more customers)\b/i.test(t.smsText + t.emailBody + t.line) && /never offer/i.test(reviewFairnessNotes.join(" ")) && /every customer/i.test(reviewFairnessNotes.join(" ")) && all.length > 100);

// ---- gateway helpers
check("database rows become settings, and junk rows become empty settings", reviewSettingsFromRow({ has_settings: true, review_url: "https://g.page/r/a", business_name: "X" }).hasSettings === true && reviewSettingsFromRow({ has_settings: false, review_url: null }).hasSettings === false && reviewSettingsFromRow(null).reviewUrl === "" && reviewSettingsFromRow("x").hasSettings === false);
check("database errors turn into plain words and never leak raw text", friendlyReviewsError("Enter a review link that starts with https://").includes("Share button") && friendlyReviewsError("Client workspace not found.").includes("sign in") && !/relation|pg_|constraint/i.test(friendlyReviewsError('duplicate key value violates unique constraint "client_review_settings_pkey"')));

// ---- wiring
const page = read("src/pages/ClientReviews.tsx");
const sql = read("supabase/migrations/273_reviews_collector.sql");
const gw = read("src/lib/reviewsSupabaseGateway.ts");
const css = read("src/styles/plan-forms.css");
const wiring = (p, g, c) => ({
  noRawHtml: !/dangerouslySetInnerHTML/.test(p) && !/dangerouslySetInnerHTML/.test(read("src/components/ReviewQr.tsx")),
  safeExternalLink: /href=\{saved\.reviewUrl\} target="_blank" rel="noopener noreferrer"/.test(p),
  unavailableState: /!gateway \? <div className="empty-state" role="status" data-testid="reviews-unavailable">/.test(p),
  checksBeforeSave: /const checked = checkReviewLink\(link\);\s*if \(!checked\.ok\) \{ setError\(checked\.error\); return; \}/.test(p) && p.search(/const checked = checkReviewLink\(link\);/) < p.indexOf("gateway.save("),
  confirmBeforeRemove: /window\.confirm\("Remove your review link/.test(p),
  noSrcRpc: !/\.rpc\(/.test(p) && !/\.rpc\(/.test(read("src/lib/reviewsGateway.ts")),
  gatewayMatchesSql: ["get_my_review_settings", "save_my_review_settings"].every((n) => new RegExp(`function public\\.${n}\\(`).test(sql) && g.includes(`rpc("${n}"`)) && ["review_url_value", "business_name_value"].every((a) => sql.includes(a) && g.includes(a)),
  printHidesChrome: /@media print/.test(c) && /\.no-print \{ display: none !important; \}/.test(c) && /className="[^"]*no-print/.test(p),
  cardIsBlackOnWhite: /\.review-card \{ background: #fff;/.test(c) && /\.review-card, \.review-card h3, \.review-card p \{ color: #111 !important; \}/.test(c),
  qrHasLabel: /aria-label=\{label\}/.test(read("src/components/ReviewQr.tsx")) && /role="img"/.test(read("src/components/ReviewQr.tsx")),
});
const w = wiring(page, gw, css);
check("no raw HTML is injected anywhere on the page", w.noRawHtml);
check("the test-my-link button opens the client's own link safely in a new tab", w.safeExternalLink);
check("when the feature is not connected the page says so instead of failing", w.unavailableState);
check("the link is checked on the page before anything is saved, and removing needs a confirm", w.checksBeforeSave && w.confirmBeforeRemove);
check("the page and its interface make no database calls themselves (only the one gateway file does)", w.noSrcRpc);
check("the draft gateway calls exactly the functions and argument names the SQL defines", w.gatewayMatchesSql);
check("printing shows only the card, and the card is black on white so phones can scan it", w.printHidesChrome && w.cardIsBlackOnWhite);
check("the QR code has a text label for screen readers", w.qrHasLabel);
check("PLANTED BUG caught: link no longer checked before save", wiring(page.replace("const checked = checkReviewLink(link);", "const checked = { ok: true, url: link };"), gw, css).checksBeforeSave === false);
check("PLANTED BUG caught: unsafe external link", wiring(page.replace('rel="noopener noreferrer"', ""), gw, css).safeExternalLink === false);
check("PLANTED BUG caught: gateway argument name drifts from the SQL", wiring(page, gw.replace("review_url_value", "review_url"), css).gatewayMatchesSql === false);
check("PLANTED BUG caught: printing no longer hides the page chrome", wiring(page, gw, css.replace(".no-print { display: none !important; }", "")).printHidesChrome === false);
check("PLANTED BUG caught: a link with a username would be accepted", checkReviewLink("https://user:pass@example.com/x").ok === false && (() => { const loose = /^https:\/\/[^\s<>"'`]+$/i; return loose.test("https://user:pass@example.com/x"); })());

// ---- second-pass fixes (review findings)
check("look-alike hosts are NOT labelled as the big sites (notgoogle.com, fakeyelp.com), while real subdomains are", reviewSiteName("https://notgoogle.com/r") === "notgoogle.com" && reviewSiteName("https://fakeyelp.com/biz") === "fakeyelp.com" && reviewSiteName("https://evil-facebook.com/x") === "evil-facebook.com" && reviewSiteName("https://m.facebook.com/x/reviews") === "Facebook" && reviewSiteName("https://search.google.com/local/writereview?placeid=x") === "Google" && reviewSiteName("https://g.page.evil.com/r") === "g.page.evil.com");
check("the review-link helper uses the real QR capacity", qrLinkMaxBytes === qrMaxBytes);
check("a link that is too long for a QR code is detected before saving (213 bytes), and a normal one fits", linkFitsQr("https://g.page/r/CabcDEF/review") && !linkFitsQr("https://example.com/" + "a".repeat(300)) && linkFitsQr("https://example.com/" + "a".repeat(193)) && !linkFitsQr("https://example.com/" + "a".repeat(194)));
check("a stored link that is not https is never used (defense in depth for the href)", reviewSettingsFromRow({ has_settings: true, review_url: "javascript:alert(1)", business_name: "X" }).hasSettings === false && reviewSettingsFromRow({ has_settings: true, review_url: "http://insecure.example.com", business_name: "X" }).reviewUrl === "" && reviewSettingsFromRow({ has_settings: true, review_url: "https://g.page/r/a", business_name: "X" }).hasSettings === true);
check("the page warns about a too-long link before saving", /!linkFitsQr\(link\.trim\(\)\)/.test(page) && /data-testid="review-long-link"/.test(page));
check("PLANTED BUG caught: the warning is removed", !/!linkFitsQr\(link\.trim\(\)\)/.test(page.replace("!linkFitsQr(link.trim())", "false")));

// ---- promoted to migration 273 and wired (owner said "promote reviews", 2026-10-17)
const app = read("src/App.tsx");
const route = read("src/pages/ClientReviewsRoute.tsx");
const portal = read("src/pages/ClientPortal.tsx");
const migDir = fs.readdirSync("supabase/migrations");
const promo = (a, r, pt, m, d) => ({
  routed: /const ClientReviewsRoute = named\(\(\) => import\("\.\/pages\/ClientReviewsRoute"\), "ClientReviewsRoute"\);/.test(a) && /if \(path === "\/client\/reviews"\) return <ClientReviewsRoute \/>;/.test(a),
  linked: /<a className="icon-btn" href="\/client\/reviews">Get reviews<\/a>/.test(pt),
  signedInOnly: /getSession\(\)/.test(r) && /window\.location\.replace\("\/portal\/login"\)/.test(r) && /isSupabaseConfigured && supabase \? createReviewsGateway\(supabase\) : null/.test(r),
  migrationInPlace: m.includes("273_reviews_collector.sql") && !d.includes("05_reviews_collector.sql") && !d.includes("05_reviews_collector.test.sql"),
  onlyTwoCalls: [...read("src/lib/reviewsSupabaseGateway.ts").matchAll(/\.rpc\("([a-z_]+)"/g)].map((x) => x[1]).sort().join(",") === "get_my_review_settings,save_my_review_settings",
});
const pr = promo(app, route, portal, migDir, fs.readdirSync("docs/drafts/migrations"));
check("the draft became migration 273 (draft files are gone, the regression test lives with the other migration tests)", pr.migrationInPlace && fs.existsSync("scripts/sql/local-full-schema/regression/273_reviews_collector.test.sql"));
check("/client/reviews is a real route and the portal links to it", pr.routed && pr.linked);
check("the route sends signed-out visitors to the login page and passes no connection when Supabase is not configured", pr.signedInOnly);
check("the only database calls are the two functions migration 273 defines", pr.onlyTwoCalls);
check("PLANTED BUG caught: route removed", promo(app.replace('if (path === "/client/reviews") return <ClientReviewsRoute />;', ""), route, portal, migDir, fs.readdirSync("docs/drafts/migrations")).routed === false);
check("PLANTED BUG caught: signed-out visitors no longer redirected", promo(app, route.replace('window.location.replace("/portal/login")', "void 0"), portal, migDir, fs.readdirSync("docs/drafts/migrations")).signedInOnly === false);
check("PLANTED BUG caught: a stray third database call", promo(app, route, portal, migDir, []).onlyTwoCalls === true && [...(read("src/lib/reviewsSupabaseGateway.ts") + 'client.rpc("owner_secret_thing")').matchAll(/\.rpc\("([a-z_]+)"/g)].map((x) => x[1]).sort().join(",") !== "get_my_review_settings,save_my_review_settings");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll reviews checks passed (offline).");
process.exit(failures ? 1 : 0);
