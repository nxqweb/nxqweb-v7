// Offline test: the default Business template (what a brand-new client site shows before its first real build) makes no claim the grounding
// validator rejects. Scans the visible default copy in site.config.js, index.html and app.js against the real validator rules.
import fs from "node:fs";
import { unsupportedMarketingClaimRules } from "../supabase/functions/_shared/ai-grounding.mjs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const files = ["templates/business-v1/site.config.js", "templates/business-v1/index.html", "templates/business-v1/app.js"];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  // Strip code that is not visible copy: HTML tags/attributes other than meta description text, JS comments.
  const visible = file.endsWith(".html")
    ? source.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+content="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]+>/g, " ")
    : source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const hits = unsupportedMarketingClaimRules.filter(([, claimPattern]) => claimPattern.test(visible)).map(([label]) => label);
  check(`${file} default copy makes no unsupported claims`, hits.length === 0, hits.join(", "));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll Business template copy checks passed (offline).");
process.exit(failures ? 1 : 0);
