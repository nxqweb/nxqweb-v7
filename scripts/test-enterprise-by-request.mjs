// Offline test: Enterprise is arranged by hand. It stays in the public catalog (pricing, plan-change requests), but it cannot be chosen at signup, its card sends people to
// /contact, and the Request-your-website form refuses to submit for a client whose price is not Starter, Growth or Intelligence. Found in the 2026-10-25 live tier test: the form
// had no Enterprise card, fell back to starter, and submit_current_client_website_setup (migration 183) then rewrote the Enterprise client to Starter at $50.
import fs from "node:fs";
import { productTiers, selfServeProductTiers } from "../src/lib/productCatalog.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const signup = read("src/pages/PortalSignup.tsx");
const plans = read("src/pages/PublicPlans.tsx");
const home = read("src/pages/PublicHome.tsx");
const portal = read("src/pages/ClientPortal.tsx");
const migration183 = read("supabase/migrations/183_owner_decision_authority_and_domain_capture.sql");

check("the public catalog still has all four tiers with Enterprise at $300+", productTiers.map((t) => t.key).join(",") === "starter,growth,intelligence,enterprise" && productTiers[3].priceLabel === "$300+/mo");
check("self-serve tiers are exactly Starter, Growth and Intelligence", selfServeProductTiers.map((t) => t.key).join(",") === "starter,growth,intelligence");

check("signup picks its starting tier only from the self-serve list", /selfServeProductTiers\.some\(\(tier\) => tier\.key === initialTier\)/.test(signup));
check("signup tier buttons come from the self-serve list, not the full catalog", /selfServeProductTiers\.map\(\(item\) =>/.test(signup) && !/[^f]productTiers\.map\(/.test(signup));
check("signup tells people Enterprise is by hand and links to /contact", /data-testid="enterprise-by-request-note"/.test(signup) && /href="\/contact"/.test(signup) && /arranged by hand/.test(signup));

check("the plans page sends the Enterprise card to /contact and keeps the signup link for the rest", /tier\.key === "enterprise" \? "\/contact" : `\/portal\/signup\?family=business&tier=\$\{tier\.key\}`/.test(plans) && /"Talk to us about" : "Choose"/.test(plans));
check("the home page sends the Enterprise card to /contact and keeps the signup link for the rest", /tier\.key === "enterprise" \? "\/contact" : `\/portal\/signup\?family=business&tier=\$\{encodeURIComponent\(tier\.key\)\}`/.test(home) && /"Talk to us about" : "Choose"/.test(home));

check("the portal records whether the client's price is a standard package", /const \[standardPackage, setStandardPackage\] = useState\(true\)/.test(portal) && /setStandardPackage\(Object\.values\(packageOptions\)\.some\(\(option\) => option\.price === Number\(loadedClient\.monthly_price\)\)\)/.test(portal));

// Both submit paths must stop BEFORE they call the RPC that rewrites the client's tier and price.
const rpcCall = 'supabase.rpc("submit_current_client_website_setup"';
const rpcAt = [];
for (let i = portal.indexOf(rpcCall); i !== -1; i = portal.indexOf(rpcCall, i + 1)) rpcAt.push(i);
check("the portal calls the setup RPC from exactly two places (full request and targeted update)", rpcAt.length === 2);
const guardAt = [];
for (let i = portal.indexOf("if (!standardPackage)"); i !== -1; i = portal.indexOf("if (!standardPackage)", i + 1)) guardAt.push(i);
check("each RPC call has its own standardPackage guard before it (guard, call, guard, call)", rpcAt.length === 2 && guardAt.length === 2 && guardAt[0] < rpcAt[0] && rpcAt[0] < guardAt[1] && guardAt[1] < rpcAt[1]);
check("the guard message points to the assistant's send-to-team button and never says \"Message support\" (the portal has no direct message box)", (portal.match(/Your plan is arranged by hand, so this form cannot send it/g) || []).length === 2 && (portal.match(/Ask the NXQX assistant below and send your question to the team/g) || []).length === 2 && !/Message support/.test(portal));

// Why the guard exists: the server rewrites the tier and price from the tier the form sends and refuses enterprise.
check("migration 183 still rewrites tier and price from the submitted tier and refuses enterprise (so the guard is still needed)", /tier_key_value not in \('starter','growth','intelligence'\)/.test(migration183) && /monthly_price=tier_row\.monthly_price/.test(migration183));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
