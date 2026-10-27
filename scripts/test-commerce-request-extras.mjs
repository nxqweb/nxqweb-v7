// Offline test for custom-order requests on a Commerce store: the optional inspiration-photo link (safe to accept, safe to show), the one-tap reply emails, the "View picture" rule, and
// that the store page only offers the request card when the shop switched requests on. Planted-bug controls prove each safety check can fail.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const libPath = "src/lib/commerceRequestExtras.ts";
const libSource = read(libPath);

async function load(source, tag) {
  const file = path.join(os.tmpdir(), `nxq-extras-${process.pid}-${tag}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(`${file}?${Date.now()}${tag}`); } finally { fs.rmSync(file, { force: true }); }
}
const lib = await load(libSource, "good");

function suite(m) {
  const n = m.normalizeInspirationLink;
  const good = ["https://www.pinterest.com/pin/123/", "pinterest.com/pin/123", "http://instagram.com/p/abc", "https://photos.app.goo.gl/AbC123"];
  const bad = ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x", "https://localhost/x", "http://127.0.0.1/x", "https://user:pass@example.com/", "https://nodots/x", "has space.com", "https://[::1]/x", "x".repeat(301), "https://evil.example/" + "a".repeat(300)];
  const ok = {
    empty: n("").ok === true && n("").url === "" && n("   ").url === "",
    accepts: good.every((u) => n(u).ok === true && /^https?:\/\//.test(n(u).url)),
    schemeAdded: n("pinterest.com/pin/123").url === "https://pinterest.com/pin/123",
    rejects: bad.every((u) => n(u).ok === false && typeof n(u).error === "string" && n(u).error.length > 5),
  };
  const withLink = m.descriptionWithLink("A candle like my grandmother's, lavender.", "https://pinterest.com/pin/1");
  const noLink = m.descriptionWithLink("  Just details  ", "");
  const tooLong = m.descriptionWithLink("x".repeat(4990), "https://pinterest.com/pin/1");
  ok.append = withLink.ok && withLink.text.endsWith("\n\nInspiration link: https://pinterest.com/pin/1") && noLink.ok && noLink.text === "Just details" && tooLong.ok === false;
  const split = m.splitInspirationLink(withLink.text);
  const elsewhere = m.splitInspirationLink("Inspiration link: https://pinterest.com/pin/1\n\nand more text after");
  const unsafe = m.splitInspirationLink("hello\n\nInspiration link: javascript:alert(1)");
  ok.split = split.url === "https://pinterest.com/pin/1" && split.text === "A candle like my grandmother's, lavender." && elsewhere.url === "" && unsafe.url === "" && unsafe.text.includes("javascript:") && m.splitInspirationLink("hello\n\nHello there frien!https://pinterest.com/pin/9").url === "" && m.splitInspirationLink("plain").url === "";
  const d = (status, over = {}) => m.requestReplyDraft({ status, customerName: "Jamie Rivera", productName: "Wedding favor candles", storeName: "Glow Candle Co", note: "", ...over });
  ok.replies = d("accepted").body.includes("I can make") && d("declined").body.includes("not able to make this one") && d("need_more_information").body.includes("more information") && d("quoted").body.includes("what I can offer") && d("completed").body.includes("Thanks for your request")
    && ["accepted", "declined", "need_more_information", "quoted", "reviewing"].every((s) => d(s).body.startsWith("Hi Jamie,") && d(s).body.includes("Glow Candle Co") && d(s).subject.includes("Wedding favor candles"));
  ok.noPromises = ["accepted", "declined", "need_more_information", "quoted", "in_progress"].every((s) => !/[$]|\b\d{1,2}\/\d{1,2}\b|\bby (monday|friday)\b/i.test(d(s).body));
  ok.noteAndSafety = d("accepted", { note: "Ready in 2 weeks." }).body.includes("Ready in 2 weeks.") && !d("accepted", { productName: "Line\nBreak\r\nName" }).subject.includes("\n") && d("declined", { storeName: "" }).body.includes("our shop") && d("accepted", { customerName: "" }).body.startsWith("Hi there,");
  const href = m.mailtoHref("jamie@example.com", "Your request: A&B", "Hi Jamie,\n\nThanks & bye");
  ok.mailto = href.startsWith("mailto:jamie@example.com?subject=") && href.includes("A%26B") && href.includes("%0A%0A") && !href.includes("\n");
  ok.mailtoRefuses = ["", "nope", "a@b", "jamie@example.com?cc=boss@x.com", "a b@x.com", "a@b.com&bcc=x@y.com", "<a>@b.co"].every((e) => m.mailtoHref(e, "s", "b") === "");
  const longHref = m.mailtoHref("jamie@example.com", "s", "word ".repeat(2000));
  ok.mailtoLong = longHref.length > 0 && longHref.length <= 1800;
  return ok;
}
const good = suite(lib);
for (const [k, label] of [["empty", "an empty link is fine (the field is optional)"], ["accepts", "normal photo links are accepted; a missing https:// is added"], ["schemeAdded", "https:// is added when the customer leaves it off"], ["rejects", "javascript:, data:, ftp:, localhost, bare IPs, logins in the link, no-dot hosts, spaces and very long links are refused with a plain message"], ["append", "the link is added as the LAST line of the details, nothing is added without a link, and too-long text is refused before sending"], ["split", "the owner's inbox reads the link back only from the final line, and an unsafe link stays plain text"], ["replies", "every status has a friendly draft that names the customer's first name, the item and the shop"], ["noPromises", "drafts never promise a price, date or deadline the owner did not write"], ["noteAndSafety", "the owner's note is included, line breaks cannot break the subject, and missing names fall back to calm defaults"], ["mailto", "the email link is properly encoded"], ["mailtoRefuses", "an address with extra mail headers or odd characters gets no email link"], ["mailtoLong", "a very long draft is shortened so the email link still works"]]) check(label, good[k] === true);

// Planted bugs: each safety rule is broken in a copy of the source and the suite must notice.
const plant = async (name, from, to, key) => {
  if (!libSource.includes(from)) { check(`PLANTED BUG could not be planted (source changed): ${name}`, false); return; }
  const bugged = suite(await load(libSource.replace(from, to), `bug${key}`));
  check(`PLANTED BUG caught: ${name}`, bugged[key] === false);
};
await plant("javascript: links accepted", 'parsed.protocol !== "https:" && parsed.protocol !== "http:"', 'false', "rejects");
await plant("logins inside a link accepted", "if (parsed.username || parsed.password)", "if (false)", "rejects");
await plant("an email address with extra headers accepted", '[^@\\s?&#%<>"]+@', '[^@\\s]+@', "mailtoRefuses");
await plant("the draft makes a price promise", "Good news: I can make", "Good news: I can make it for $20 and", "noPromises");
await plant("any line is read as the link", 'if (!last.startsWith(INSPIRATION_PREFIX)) return { text: full, url: "" };', "", "split");

// Wiring (text checks over the screens)
const form = read("src/pages/PublicCommerceRequest.tsx");
const inbox = read("src/pages/ClientCommerceRequests.tsx");
const store = read("src/pages/PublicCommerceStorefront.tsx");
const quick = read("src/lib/quickLinks.ts");
check("the link box is a plain text box (the browser's own URL check would block links typed without https:// before our friendlier message)", /<input className="auth-input" type="text" inputMode="url"[^>]*value=\{inspirationLink\}/.test(form) && !/type="url"/.test(form));
check("the public form: optional link box (not required), validated before sending, appended through descriptionWithLink, and the error is announced", /Link to a photo of what you want \(optional\)/.test(form) && !/<input[^>]*inspirationLink[^>]*required/.test(form) && /normalizeInspirationLink\(inspirationLink\)/.test(form) && /description: details\.text/.test(form) && /className="auth-error" role="alert"/.test(form));
check("the inbox shows the customer's link only as a plain https link that opens a new tab safely, with a warning", /splitInspirationLink\(request\.description\)/.test(inbox) && /target="_blank" rel="noopener noreferrer nofollow"/.test(inbox) && /Only open links you trust/.test(inbox) && !/dangerouslySetInnerHTML/.test(inbox + form + store));
check("View picture exists only for a picture that is clean AND released, and opens through the protected file link, never a raw address", /scan_status === "clean" && file\.quarantine_status === "released" \? <>/.test(inbox) && /secure-client-file-access/.test(inbox) && /download: false/.test(inbox) && /window\.open\(data\.signed_url, "_blank", "noopener,noreferrer"\)/.test(inbox));
check("each request has an Email button built from the chosen status and note, and a plain fallback when there is no usable email", /requestReplyDraft\(\{ status, customerName/.test(inbox) && /mailtoHref\(request\.customer_email/.test(inbox) && /data-testid="email-customer"/.test(inbox) && /No usable email address on this request/.test(inbox));
check("the store page offers the custom-order card only after the shop's own request form answers successfully, and never while an order is on screen", /get_public_commerce_request_form", \{ store_slug_input: slug \}/.test(store) && /if \(!result\.error && result\.data\) setCustomRequestsOpen\(true\)/.test(store) && /customRequestsOpen && !order \?/.test(store) && /href=\{`\/store\/request\?store=\$\{encodeURIComponent\(slug\)\}`\}/.test(store));
check("the portal card that opens this inbox is named Customer requests (it used to say Ask us for help)", /label: "Customer requests", hint: "Custom orders and questions from your customers"/.test(quick) && !/Ask us for help/.test(quick));
check("no database change was needed: nothing new is called in the database from the helpers", !/\.rpc\(|supabase/.test(libSource));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
