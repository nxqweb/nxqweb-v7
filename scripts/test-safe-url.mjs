// Offline tests for src/lib/safeUrl.ts (link safety for data-driven links).
import { safeHttpUrl, safePaymentUrl } from "../src/lib/safeUrl.ts";
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures += 1; };
check("https and http web links are allowed", safeHttpUrl("https://example.com/a") === "https://example.com/a" && safeHttpUrl("http://example.com/") === "http://example.com/");
check("script, data, file and mailto schemes are refused", ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "vbscript:x", "mailto:a@b.c"].every((v) => safeHttpUrl(v) === null));
check("links with embedded credentials are refused", safeHttpUrl("https://user:pass@example.com") === null);
check("non-strings, empty and oversized values are refused", [null, undefined, 42, "", "not a url", `https://x.com/${"a".repeat(3000)}`].every((v) => safeHttpUrl(v) === null));
check("Stripe payment links only on Stripe hosts", safePaymentUrl("stripe", "https://buy.stripe.com/abc") !== null && safePaymentUrl("stripe", "https://buy.stripe.com.evil.com/abc") === null && safePaymentUrl("stripe", "https://evil.com/buy.stripe.com") === null);
check("PayPal and Venmo links only on their own hosts", safePaymentUrl("paypal", "https://paypal.me/shop") !== null && safePaymentUrl("venmo", "https://venmo.com/u/shop") !== null && safePaymentUrl("paypal", "https://paypa1.me/shop") === null && safePaymentUrl("venmo", "https://venmo.co/shop") === null);
check("payment links must be https", safePaymentUrl("paypal", "http://paypal.me/shop") === null);
check("cross-provider hosts are refused", safePaymentUrl("stripe", "https://paypal.me/shop") === null);
console.log(failures ? `\n${failures} link-safety check(s) FAILED.` : "\nAll link-safety checks passed.");
process.exit(failures ? 1 : 0);
