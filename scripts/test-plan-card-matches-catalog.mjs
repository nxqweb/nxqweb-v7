// Offline test: what the request form's plan cards (and the setup report's "Selected package" lines) say about a plan must be what the PUBLIC catalog says, and nothing the product does
// not do. Found in the 2026-10-25/26 tier test and audit: the form typed the plans out a second time and drifted. It promised "AI-powered website optimization", "Layout improvement
// suggestions" and "Conversion-focused optimization notes" (no AI key exists; any such work is done by hand through the owner's AI Desk) and told Growth clients click and scroll
// reporting was not included while /plans and the live Analytics page said it was.
import fs from "node:fs";
import { productTiers } from "../src/lib/productCatalog.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const portal = read("src/pages/ClientPortal.tsx");
const catalogSrc = read("src/lib/productCatalog.ts");
const home = read("src/pages/PublicHome.tsx");
const plans = read("src/pages/PublicPlans.tsx");
const tier = (key) => productTiers.find((t) => t.key === key);

for (const key of ["starter", "growth", "intelligence"]) {
  check(`the ${key} card takes its description and capability lines from the public catalog`, new RegExp(`description: catalogTier\\("${key}"\\)\\.description`).test(portal) && new RegExp(`capabilities: \\[\\.\\.\\.catalogTier\\("${key}"\\)\\.features\\]`).test(portal));
}
check("the card file no longer types out its own capability lists", !/capabilities: \[\s*"/.test(portal));
check("the card prices (what the form matches the client's price against) equal the public prices", [["starter", 50], ["growth", 100], ["intelligence", 150]].every(([key, price]) => new RegExp(`${key}: \\{\\s*label: "[A-Za-z]+",\\s*price: ${price},`).test(portal) && Number(/\d+/.exec(tier(key).priceLabel)[0]) === price));

const overclaims = ["AI-powered", "Layout improvement suggestions", "Conversion-focused optimization notes", "AI-assisted SEO/content suggestions", "Review and testimonial sections", "Page interaction review"];
check("none of the over-claims are in the portal form, the catalog, the home page or the plans page", overclaims.every((phrase) => ![portal, catalogSrc, home, plans].some((text) => text.includes(phrase))));
check("no public plan description or feature promises AI (there is no AI key; AI work is manual)", productTiers.every((t) => !/\bAI\b|artificial|machine learning/i.test([t.description, t.outcome, ...t.features].join(" "))));
check("Intelligence still says plainly that the heat-map view is coming", tier("intelligence").features.some((f) => /heat-map view is coming/.test(f)));
check("Growth is told it gets page, click and scroll summaries (as the live Analytics page shows)", tier("growth").features.some((f) => /page, click and scroll summaries/i.test(f)) && !/click\/scroll reporting are not included/.test(portal));
check("Enterprise is not offered as a card in the request form (it is by request)", !/enterprise: \{\s*label/.test(portal));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
