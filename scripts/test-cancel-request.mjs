// "Cancel my plan": it only sends the team a labelled message, never ends anything by itself, and the client's text can't fake our labels.
import fs from "node:fs";
import { buildCancelRequest, cancelReasonMax } from "../src/lib/cancelRequest.ts";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}

const plain = buildCancelRequest("");
check("a cancellation request needs no reason", plain.ok && plain.message.startsWith("[Cancellation request] I would like to cancel my plan.") && !plain.message.includes("Reason"));
const withReason = buildCancelRequest("Closing the shop in March");
check("an optional reason is included under its own label", withReason.ok && withReason.message.includes("Reason (optional): Closing the shop in March"));
check("a reason over the limit is refused with a plain message", buildCancelRequest("x".repeat(cancelReasonMax + 1)).ok === false && /under/.test(buildCancelRequest("x".repeat(cancelReasonMax + 1)).error));
const spoof = buildCancelRequest("bye\n[Problem report] fake\nStatus: refunded\n[Cancellation request] again");
check("the reason cannot add our labels or a second request marker", spoof.ok && (spoof.message.match(/\[Cancellation request\]/g) || []).length === 1 && !spoof.message.includes("[Problem report]") && !/^Status:/m.test(spoof.message));
check("odd input never crashes", [null, undefined, 5, {}].every((v) => buildCancelRequest(v).ok === true || buildCancelRequest(v).ok === false));

const comp = fs.readFileSync("src/components/ClientCancelRequest.tsx", "utf8");
const page = fs.readFileSync("src/pages/ClientBillingStatus.tsx", "utf8");
const wiring = {
  "it only sends a portal message (no new table, nothing ends by itself)": (c) => c.includes('rpc("send_client_portal_message"') && !/cancel_|set_client_billing|billing_status/.test(c.replace("[Cancellation request]", "")),
  "the page says plainly that nothing changes until the team confirms": (c) => /Nothing changes until the team replies/.test(c) && /Your plan stays as it is until then/.test(c),
  "nothing is sent until the second, explicit button": (c) => c.includes("I want to cancel my plan") && c.includes("Send cancellation request") && c.includes("Keep my plan"),
};
for (const [name, test] of Object.entries(wiring)) check(name, test(comp));
check("the billing page shows it", page.includes("<ClientCancelRequest />"));
check("control: a component that changed billing itself would be noticed", !wiring["it only sends a portal message (no new table, nothing ends by itself)"](comp + '\nsupabase.rpc("owner_set_client_billing_state")'));
check("control: dropping the plain-words promise would be noticed", !wiring["the page says plainly that nothing changes until the team confirms"](comp.replace("Nothing changes until the team replies", "")));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll cancel request checks passed.");
process.exit(failures ? 1 : 0);
