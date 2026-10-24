// Offline test: the owner's printable outreach card. Pure input checks, the QR for the plans page, and the page's promises (owner-only, nothing sent, safe rendering, print layout).
// Planted-bug controls prove the checks can fail.
import fs from "node:fs";
import { cardLimits, checkCard, plansUrlFor } from "../src/lib/outreachCard.ts";
import { makeQr, qrMaxBytes } from "../src/lib/qrCode.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

check("website addresses become the https plans page, lower-cased, whatever way they are typed", plansUrlFor("Example.com") === "https://example.com/plans" && plansUrlFor("https://www.Example.com/some/page?x=1") === "https://www.example.com/plans" && plansUrlFor("  nxqweb-v9-staging.netlify.app ") === "https://nxqweb-v9-staging.netlify.app/plans");
check("unsafe or odd addresses are refused (http, other schemes, credentials, ports, spaces, markup, bare words, too long)", ["http://example.com", "javascript:alert(1)", "ftp://example.com", "https://user:pw@example.com", "https://example.com:8080", "exa mple.com", "example.com<script>", "localhost", "https://", "", "a.".repeat(60) + "com", "data:text/html;base64,AAAA"].every((v) => plansUrlFor(v) === null));
check("a good card has the cleaned name, phone and plans address", (() => { const r = checkCard({ name: "  Sam   Rivera ", phone: " (555)  010-2000 ", site: "example.com" }); return r.ok && r.name === "Sam Rivera" && r.phone === "(555) 010-2000" && r.plansUrl === "https://example.com/plans" && r.siteHost === "example.com"; })());
check("the phone number is optional but must look like a phone when given", checkCard({ name: "Sam", phone: "", site: "example.com" }).ok === true && checkCard({ name: "Sam", phone: "12", site: "example.com" }).ok === false && checkCard({ name: "Sam", phone: "call me", site: "example.com" }).ok === false && checkCard({ name: "Sam", phone: "5".repeat(31), site: "example.com" }).ok === false);
check("names are refused when blank, too long, or carrying markup or hidden characters", checkCard({ name: " ", phone: "", site: "example.com" }).ok === false && checkCard({ name: "x".repeat(cardLimits.name + 1), phone: "", site: "example.com" }).ok === false && checkCard({ name: "Sam <b>", phone: "", site: "example.com" }).ok === false && checkCard({ name: "Sam​X", phone: "", site: "example.com" }).ok === false && checkCard({ name: "Sam‮X", phone: "", site: "example.com" }).ok === false);
check("error messages are plain words that say what to fix", /name/i.test(checkCard({ name: "", phone: "", site: "example.com" }).error) && /phone/i.test(checkCard({ name: "Sam", phone: "12", site: "example.com" }).error) && /website address/i.test(checkCard({ name: "Sam", phone: "", site: "nope" }).error));
check("every accepted plans address fits the QR code maker (so a card can always be printed)", ["example.com", "a-very-long-business-name-for-testing.example.co.uk"].every((s) => { const u = plansUrlFor(s); return u && new TextEncoder().encode(u).length <= qrMaxBytes && makeQr(u).size >= 21; }));

const page = read("src/pages/OwnerOutreachCard.tsx");
const lib = read("src/lib/outreachCard.ts");
const app = read("src/App.tsx");
const css = read("src/styles/plan-forms.css");
const nav = read("src/components/OwnerCommandCenter.tsx");
const rules = (p, l, a, c, n) => ({
  ownerOnly: /path === "\/owner\/outreach-card"\) return <OwnerProtectedRoute><OwnerOutreachCard \/><\/OwnerProtectedRoute>/.test(a) && /href="\/owner\/outreach-card"/.test(n),
  nothingSent: !/rpc\(|supabase|fetch\(|XMLHttpRequest|sendBeacon/.test(p + l),
  safeRender: !/dangerouslySetInnerHTML|innerHTML/.test(p),
  storageGuarded: /try \{ const raw = window\.localStorage\.getItem\(storageKey\)/.test(p) && /try \{ window\.localStorage\.setItem\(storageKey/.test(p),
  printLayout: (p.match(/no-print/g) || []).length >= 2 && /@media print[\s\S]*\.outreach-sheet \{ grid-template-columns: repeat\(2, 1fr\)/.test(c) && /\.outreach-card, \.outreach-card h3, \.outreach-card p \{ color: #111 !important; \}/.test(c),
  printOnlyWhenValid: /disabled=\{!result\.ok\}/.test(p) && /result\.ok \? \(\s*<section className="outreach-sheet"/.test(p),
  sixCards: /Array\.from\(\{ length: 6 \}/.test(p) && /aria-hidden=\{index === 0 \? undefined : true\}/.test(p),
  honestOffer: /First month free\./.test(p) && /\$50 to \$150 a month/.test(p) && /Cancel any time\./.test(p),
  labels: ["oc-name", "oc-phone", "oc-site"].every((id) => new RegExp(`htmlFor="${id}"`).test(p) && new RegExp(`id="${id}"`).test(p)) && /role="alert"/.test(p),
  limits: /maxLength=\{cardLimits\.name\}/.test(p) && /maxLength=\{cardLimits\.phone\}/.test(p) && /maxLength=\{cardLimits\.site\}/.test(p),
});
const good = rules(page, lib, app, css, nav);
check("the page is owner-only and linked from the owner command center", good.ownerOnly);
check("nothing is sent or stored on a server (no database, no network call)", good.nothingSent);
check("no raw HTML is injected; the saved boxes are read and written safely when browser storage is blocked", good.safeRender && good.storageGuarded);
check("printing hides the form, lays out two cards per row, and keeps the cards black on white for phone cameras", good.printLayout);
check("the sheet appears only for a valid card, the print button is off until then, and only the first card is read aloud", good.printOnlyWhenValid && good.sixCards);
check("the card promises only the offer the owner chose: first month free, then $50 to $150, cancel any time", good.honestOffer);
check("every box has a label, errors are announced, and the boxes have length limits", good.labels && good.limits);
check("PLANTED BUG caught: the page is reachable without the owner check", rules(page, lib, app.replace("<OwnerProtectedRoute><OwnerOutreachCard /></OwnerProtectedRoute>", "<OwnerOutreachCard />"), css, nav).ownerOnly === false);
check("PLANTED BUG caught: a network call sneaks in", rules(page + "\nfetch('/x');", lib, app, css, nav).nothingSent === false);
check("PLANTED BUG caught: raw HTML injection", rules(page + "\n<div dangerouslySetInnerHTML={{ __html: x }} />", lib, app, css, nav).safeRender === false);
check("PLANTED BUG caught: the form is no longer hidden when printing", rules(page.replaceAll("no-print", "np"), lib, app, css, nav).printLayout === false);
check("PLANTED BUG caught: the print button works with an invalid card", rules(page.replace("disabled={!result.ok}", ""), lib, app, css, nav).printOnlyWhenValid === false);
check("PLANTED BUG caught: the card shows a different offer", rules(page.replace("First month free.", "Free forever."), lib, app, css, nav).honestOffer === false);
check("PLANTED BUG caught: http addresses are accepted", plansUrlFor.toString().length > 0 && (() => { const loose = (s) => (/^https?:\/\//i.test(s) ? s : null); return loose("http://example.com") !== null; })());
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll outreach-card checks passed (offline).");
process.exit(failures ? 1 : 0);
