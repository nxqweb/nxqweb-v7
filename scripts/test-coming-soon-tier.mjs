// Offline test: the planned "NXQX Web Pro" ($500) tier is shown honestly as COMING SOON and can never be chosen, requested or charged.
// (Owner's notes 2026-10-16: "built after Web launches"; the owner chose "A: coming soon, not buyable" and the name "NXQX Web Pro" on 2026-10-18.)
import fs from "node:fs";
import { comingSoonTiers, productTiers } from "../src/lib/productCatalog.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const catalog = read("src/lib/productCatalog.ts");
const plans = read("src/pages/PublicPlans.tsx");
const signup = read("src/pages/PortalSignup.tsx");
const manage = read("src/components/ClientPlanManagement.tsx");
const home = read("src/pages/PublicHome.tsx");

const pro = comingSoonTiers[0];
const rules = (cat, pl, su, mg, hm, tiersData, soonData) => ({
  separateFromBuyable: !tiersData.some((t) => /pro/i.test(t.key) || /500/.test(t.priceLabel)) && tiersData.length === 4 && soonData.length === 1,
  notInSelectors: !/comingSoonTiers/.test(su) && !/comingSoonTiers/.test(hm) && !/COMING_SOON_TIERS\.map\(\(tier\) => \(\s*<option/.test(mg),
  noChooseButton: !/Choose \$\{tier\.name\}[\s\S]{0,40}comingSoon/.test(pl) && !/signup\?[^"]*web-pro/.test(pl + su + mg) && /href="\/contact">Ask about \{tier\.name\}/.test(pl),
  honestPriceAndNote: /planned/.test(soonData[0].priceLabel) && /may change/.test(soonData[0].priceNote) && /Not available to order yet/.test(soonData[0].honestNote) && /Coming soon/.test(soonData[0].badge),
  notesFeatures: ["AI receptionist", "fair-use cap", "Missed-call text-back", "Review requests", "Google Business Profile", "Local SEO", "Lead dashboard", "Booking and payments", "Monthly report"].every((f) => soonData[0].features.join(" | ").includes(f)),
  noGrowthClash: soonData[0].name === "NXQX Web Pro" && !/\bGrowth\b/.test(soonData[0].name) && tiersData.filter((t) => t.key === "growth").length === 1,
  sectionPresent: /id="coming-soon"/.test(pl) && /data-testid="coming-soon-tier"/.test(pl) && /comingSoonTiers\.map/.test(pl),
  clientNote: /data-testid="coming-soon-note"/.test(mg) && /not available to request yet/.test(mg),
  fourStillFour: /Four clear service levels/.test(pl),
  noDbOrBilling: !/rpc\(|supabase/.test(cat.slice(cat.indexOf("export type ComingSoonTierDefinition"), cat.indexOf("export function getProductTier"))),
});
const good = rules(catalog, plans, signup, manage, home, productTiers, comingSoonTiers);
check("the Pro tier is a separate 'coming soon' list: the four buyable tiers are unchanged and none costs $500", good.separateFromBuyable);
check("the Pro tier cannot be selected or requested anywhere (not in signup, home, or the plan-change dropdown)", good.notInSelectors);
check("the plans page has no 'Choose' or signup link for it, only 'Ask about' to the contact page", good.noChooseButton);
check("it says plainly that the price is planned, may change, and that it is not available to order yet", good.honestPriceAndNote);
check("its feature list is exactly the owner's list (incl. the AI receptionist fair-use cap)", good.notesFeatures);
check("it does not reuse the name 'Growth' (the $100 tier keeps it)", good.noGrowthClash);
check("the public plans page shows the section; the client plan screen shows an info line", good.sectionPresent && good.clientNote);
check("the plans page still says four service levels (four are for sale)", good.fourStillFour);
check("the catalog entry touches no database or billing code", good.noDbOrBilling);
check("PLANTED BUG caught: the Pro tier slips into the buyable list", rules(catalog, plans, signup, manage, home, [...productTiers, { key: "web-pro", priceLabel: "$500/mo" }], comingSoonTiers).separateFromBuyable === false);
check("PLANTED BUG caught: the plan-change dropdown offers it", rules(catalog, plans, signup, manage.replace("{COMING_SOON_TIERS.map((tier) => (\n                  <small", "{COMING_SOON_TIERS.map((tier) => (\n                  <option"), home, productTiers, comingSoonTiers).notInSelectors === false);
check("PLANTED BUG caught: a signup link to the Pro tier appears", rules(catalog, plans.replace('href="/contact">Ask about', 'href="/portal/signup?family=business&tier=web-pro">Ask about'), signup, manage, home, productTiers, comingSoonTiers).noChooseButton === false);
check("PLANTED BUG caught: the honest note is dropped", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, honestNote: "Great tier." }]).honestPriceAndNote === false);
check("PLANTED BUG caught: a feature from the notes is lost", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, features: pro.features.filter((f) => !/Local SEO/.test(f)) }]).notesFeatures === false);
check("PLANTED BUG caught: the new tier is named Growth", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, name: "NXQX Web Growth" }]).noGrowthClash === false);
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll coming-soon-tier checks passed (offline).");
process.exit(failures ? 1 : 0);
