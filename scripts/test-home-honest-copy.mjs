// The home page must not promise a "live" view the buyer may not get: the portal preview is sample data and shows the Growth plan view.
// (docs/PROMISE_AUDIT.md fix list item 1.) Static check, no network.
import fs from "node:fs";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }

const home = fs.readFileSync("src/pages/PublicHome.tsx", "utf8");
const demo = fs.readFileSync("src/components/PortalPreviewDemo.tsx", "utf8");

check("home page no longer promises a 'live view' of site performance", !/live view of how your site is performing/i.test(home));
check("home page says the preview is the Growth plan view with example data", /Growth plan view with example data/.test(home));
check("preview badge says Sample, not Live", demo.includes("<i />Sample</span>") && !demo.includes("<i />Live</span>"));
check("preview chart is labelled as sample data", demo.includes('aria-label="Example chart with sample data"') && !/aria-label="Live example chart"/.test(demo));
check("preview note names the Growth plan view and sample data", /Growth plan view, shown with illustrative sample data/.test(demo));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll home-page honesty checks passed.");
process.exit(failures ? 1 : 0);
