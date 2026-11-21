// Guards the TEMPORARY owner "Activate billing (no charge)" test helper on /owner/billing.
// DELETE this script (and its npm script) together with the helper when testing is finished.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const page = fs.readFileSync("src/pages/OwnerBillingLifecycle.tsx", "utf8");
const checklist = fs.readFileSync("docs/LAUNCH_HARDENING_CHECKLIST.md", "utf8");
const start = page.indexOf("TEMPORARY-TEST-ACTIVATION (start)");
const end = page.indexOf("TEMPORARY-TEST-ACTIVATION (end)");
const section = start >= 0 && end > start ? page.slice(start, end) : "";
const change = page.slice(page.indexOf("async function changeBillingState"), page.indexOf("async function recordPayment"));

check("the helper is fenced by one start and one end marker so it can be removed cleanly", start >= 0 && end > start && page.split("TEMPORARY-TEST-ACTIVATION (start)").length === 2 && page.split("TEMPORARY-TEST-ACTIVATION (end)").length === 2);
check("only clients with billing not configured or activation pending are listed", /\["not_configured", "activation_pending"\]\.includes\(client\.billing_status\)/.test(page));
check("QA-only clients get an explanation and no button", section.includes("client.qa_only ?") && section.indexOf("client.qa_only ?") < section.indexOf("<button") && /permanently non-billable/.test(section));
check("the only action is the existing guarded billing change to active, labeled complimentary", (section.match(/changeBillingState\(client, "active", "complimentary"\)/g) || []).length === 1 && (section.match(/changeBillingState\(/g) || []).length === 1 && (section.match(/<button/g) || []).length === 1);
check("a free test activation is labeled complimentary (so the revenue numbers can leave it out), and no other action changes a client's provider", /next_billing_provider: provider \|\| client\.billing_provider \|\| "manual"/.test(change) && (page.match(/"complimentary"/g) || []).length >= 3 && !/changeBillingState\(client, "(past_due|freeze_review|frozen)", /.test(page));
check("the confirm box tells the owner the test client is labeled complimentary, not a paying customer", /labeled complimentary: a free test client, not a paying customer/.test(change));
check("that action goes through the guarded owner function with a confirm and a note", change.includes('rpc("owner_set_client_billing_state"') && change.includes("window.confirm") && change.includes("does not charge money"));
check("the helper never touches payment providers or recorded payments", !/stripe|paypal|recordPayment|payment_intent/i.test(section));
check("the helper says plainly that it does not approve the client", /does not approve the client/.test(section) && /Uploads also need this client to be approved/.test(section));
check("the helper only loads status and qa_only to decide what to show", /billing_frozen_at, status, qa_only/.test(page));
check("the launch checklist carries a removal reminder", checklist.includes("Remove the owner \"Activate billing (no charge)\" test button") && checklist.includes("TEMPORARY-TEST-ACTIVATION"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll temporary owner activation checks passed.");
process.exit(failures ? 1 : 0);
