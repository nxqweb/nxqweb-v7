// Offline test: "Email the customer" on the Orders page (src/lib/orderCustomerEmail.ts). The store sends customers no email by itself
// yet, so the owner gets a one-tap link that opens their own mail app with the right words for the order's state. The app sends nothing.
import fs from "node:fs";
import { customerEmail, customerEmailText } from "../src/lib/orderCustomerEmail.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const base = { email: "shopper@example.com", customerName: "Pat Lee", orderNumber: "WICK-AB12CD34", status: "new", paid: false, tracking: null, pickup: false };
const text = (extra) => customerEmailText({ ...base, ...extra });

check("an unpaid order gets a gentle payment reminder", text({}).label === "Email: payment reminder" && /I have not seen the payment arrive yet/.test(text({}).body) && text({}).subject === "About your order WICK-AB12CD34");
check("a paid order says the payment arrived and what happens next", /I received your payment for order WICK-AB12CD34/.test(text({ paid: true }).body) && /when it is on its way/.test(text({ paid: true }).body) && /ready for pickup/.test(text({ paid: true, pickup: true }).body));
check("a shipped order carries the tracking number when there is one", text({ status: "shipped", paid: true, tracking: " 1Z999 " }).body.includes("Tracking number: 1Z999") && !text({ status: "shipped", paid: true }).body.includes("Tracking number") && text({ status: "shipped" }).subject === "Your order WICK-AB12CD34 has shipped");
check("pickup, delivered and cancelled each have their own words", /ready for you to pick up/.test(text({ status: "ready_for_pickup" }).body) && /has been delivered/.test(text({ status: "delivered" }).body) && text({ status: "cancelled" }).subject === "About your order WICK-AB12CD34" && text({ status: "refunded" }).label === "Email the customer");
check("the greeting uses the customer's name, or a plain Hi when there is none", text({}).body.startsWith("Hi Pat Lee,\n") && text({ customerName: "" }).body.startsWith("Hi,\n") && text({ customerName: "Customer" }).body.startsWith("Hi,\n") && text({ customerName: null }).body.startsWith("Hi,\n"));
check("a name with line breaks cannot add extra lines or headers to the email", (() => { const t = text({ customerName: "Pat\r\nBcc: someone@example.com" }); return t.body.split("\n")[0] === "Hi Pat Bcc: someone@example.com," && !/\r/.test(t.body); })());

const mail = customerEmail({ ...base, status: "shipped", paid: true, tracking: "1Z999" });
check("the link opens the owner's mail app, addressed to the customer, with everything encoded", mail && mail.href.startsWith("mailto:shopper@example.com?subject=Your%20order%20WICK-AB12CD34%20has%20shipped&body=Hi%20Pat%20Lee%2C%0A") && !/[\n\r <>]/.test(mail.href));
check("a customer name cannot smuggle a second recipient or a header into the link", (() => { const m = customerEmail({ ...base, customerName: "x&cc=evil@example.com&bcc=evil@example.com" }); return m && (m.href.match(/[?&](cc|bcc|to)=/gi) || []).length === 0; })());
check("no usable email address means no button", customerEmail({ ...base, email: "" }) === null && customerEmail({ ...base, email: null }) === null && customerEmail({ ...base, email: "not an email" }) === null && customerEmail({ ...base, email: "a@b.co?cc=evil@example.com" }) === null);

const page = fs.readFileSync("src/pages/ClientCommerceOrders.tsx", "utf8");
check("the button is a plain link built from the saved order, never for a practice order", page.includes("const mail = order.is_test ? null : customerEmail({") && page.includes("status: order.fulfillment_status") && page.includes('<a className="icon-btn" href={mail.href}>'));
check("the owner is told the email opens in their own mail app and is theirs to send", page.includes("Opens your own email with the message written for you. Read it, change anything you like, then send."));
const lib = fs.readFileSync("src/lib/orderCustomerEmail.ts", "utf8");
check("the helper sends nothing itself", !/fetch\(|supabase|XMLHttpRequest|\.rpc\(/.test(lib));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll order customer email checks passed (offline).");
process.exit(failures ? 1 : 0);
