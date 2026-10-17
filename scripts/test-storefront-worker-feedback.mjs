// Guards the owner storefront provisioning page: a failed worker call must stay visible (it used to be wiped by the reload that follows).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const page = fs.readFileSync("src/pages/OwnerStorefrontProvisioning.tsx", "utf8");
const start = page.indexOf("async function runWorker(");
const end = page.indexOf("async function retryJob", start);
const fn = page.slice(start, end);

check("loadJobs can keep the current message and error", page.includes("async function loadJobs(keepMessages = false)") && page.includes("if (!keepMessages) setError(\"\")"));
check("a failed worker call reloads the list without clearing its own error", /setError\(`Provisioning worker failed[^\n]*\n\s*await loadJobs\(true\)/.test(fn));
check("a finished worker call reloads the list without clearing its own message", /await loadJobs\(true\);\s*return true;/.test(fn));
check("the function's own error text is read from the response body on non-2xx replies", fn.includes("context?.json()") && fn.includes("body.error"));
check("the manual Refresh button still clears old messages", page.includes("onClick={() => void loadJobs()}"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll storefront worker feedback checks passed.");
process.exit(failures ? 1 : 0);
