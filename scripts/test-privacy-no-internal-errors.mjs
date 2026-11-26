// Guards the client Security & privacy page: it must never ask the API for data_subject_requests.last_error (internal worker error text).
// Why: the database will stop granting clients that one column (draft migration 05); a page that still asked for it would fail to load entirely.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const page = fs.readFileSync("src/pages/ClientSecurityPrivacy.tsx", "utf8");
const selectLine = page.split("\n").find((line) => line.includes('from("data_subject_requests")')) || "";

check("the requests query names its columns explicitly (no select *)", /\.select\("[a-z_,]+"\)/.test(selectLine) && !selectLine.includes('select("*")'));
check("the requests query does not ask for last_error", selectLine.length > 0 && !selectLine.includes("last_error"));
check("last_error appears nowhere in the page (type, query or render)", !page.includes("last_error"));
check("a failed request still shows the generic 'needs another review' notice (driven by status)", page.includes('requestRow.status === "failed"') && page.includes("This request needs another review."));
check("the notice still says internal error details are not exposed", page.includes("Detailed internal error information is not exposed in the client portal."));
check("requests are still created through the database function, not a direct insert", page.includes('rpc("submit_current_account_data_request"') && !/from\("data_subject_requests"\)\.insert/.test(page));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll privacy internal-error checks passed.");
process.exit(failures ? 1 : 0);
