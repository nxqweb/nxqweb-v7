// Offline test: the "Get paid" helper on the client's Live store page (src/lib/getPaidHelp.ts, src/components/GetPaidHelper.tsx).
import fs from "node:fs";
import { payGuides, testablePayLink } from "../src/lib/getPaidHelp.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

// ---- the "Get paid" helper: plain steps, and a link can only be tested when it is really on that company's own site
{
  const helper = fs.readFileSync("src/components/GetPaidHelper.tsx", "utf8");
  const livePage = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
  check("there is a short guide for each of the three payment boxes", payGuides.map((g) => g.provider).join() === "paypal,venmo,stripe" && payGuides.every((g) => g.steps.length === 3 && g.steps.every((line) => line.length <= 140) && /Save private draft/.test(g.steps[2])));
  check("the guides never ask for a password, a secret key or a bank login", !/password|secret key|bank login|routing number/i.test(JSON.stringify(payGuides)));
  check("a real link on the right site can be tested", testablePayLink("paypal", " https://paypal.me/candleshop ").ok === true && testablePayLink("venmo", "https://venmo.com/u/candleshop").ok === true && testablePayLink("stripe", "https://buy.stripe.com/abc123").ok === true);
  const refused = [["paypal", ""], ["paypal", null], ["paypal", "paypal.me/x"], ["paypal", "http://paypal.me/x"], ["paypal", "https://paypal.me.evil.com/x"], ["paypal", "https://evil.com/paypal.me/x"], ["paypal", "javascript:alert(1)"],
    ["venmo", "https://paypal.me/x"], ["stripe", "https://stripe.com.evil.io/pay"], ["stripe", "data:text/html,hi"], ["bogus", "https://paypal.me/x"]];
  check("anything else is refused with a plain reason and no link: empty, wrong site, look-alike sites, http, script links, the wrong box", refused.every(([provider, typed]) => { const r = testablePayLink(provider, typed); return r.ok === false && r.reason.length > 10 && !("url" in r); }));
  check("the helper opens a test link in a new tab without handing the page over, saves nothing and never talks to the server", /target="_blank" rel="noopener noreferrer"/.test(helper) && /href=\{test\.url\}/.test(helper) && !/supabase|fetch\(|dangerouslySetInnerHTML/.test(helper));
  check("the helper only shows for online ordering and reads the three boxes on the page", /orderMode === "email" \|\| orderMode === "menu" \? null : <GetPaidHelper links=\{\{ stripe: stripePaymentLink, paypal: paypalUrl, venmo: venmoUrl \}\} \/>/.test(livePage));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll get-paid-helper checks passed (offline).");
process.exit(failures ? 1 : 0);
