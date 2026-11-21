// Offline test: "NXQX Web Pro" is offered BY REQUEST (arranged by hand as an owner-approved Enterprise package) and can never be chosen, requested through the tier dropdown or charged.
// Owner decisions 2026-10-18: "C: sell it as an Enterprise package", "Pro v1 first, phone features later", "From $300/mo", "show it as available by request".
import fs from "node:fs";
import { byRequestTiers, productTiers } from "../src/lib/productCatalog.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const catalog = read("src/lib/productCatalog.ts");
const plans = read("src/pages/PublicPlans.tsx");
const signup = read("src/pages/PortalSignup.tsx");
const manage = read("src/components/ClientPlanManagement.tsx");
const home = read("src/pages/PublicHome.tsx");
const owner = read("src/pages/OwnerPlanChanges.tsx");
const pro = byRequestTiers[0];

const rules = (cat, pl, su, mg, hm, tiersData, data) => ({
  separateFromBuyable: tiersData.length === 4 && !tiersData.some((t) => /pro/i.test(t.key) || /500/.test(t.priceLabel)) && data.length === 1,
  notInSelectors: !/byRequestTiers/.test(su) && !/byRequestTiers/.test(hm) && !/BY_REQUEST_TIERS\.map\(\(tier\) => \(\s*<option/.test(mg),
  noBuyPath: !/signup\?[^"]*web-pro/.test(pl + su + mg) && /href="\/contact">\{tier\.ctaLabel\} \{tier\.name\}/.test(pl) && !/Choose \$\{tier\.name\}[\s\S]{0,60}byRequest/.test(pl),
  priceHonest: data[0].priceLabel === "From $300/mo" && /Not a checkout price/.test(data[0].priceNote) && /planned/.test(data[0].laterPriceNote) && /may change/.test(data[0].laterPriceNote) && /\$500/.test(data[0].laterPriceNote),
  v1OnlyWhatExists: data[0].availableNow.length === 3 && data[0].availableNow.join("|").includes("Everything in Intelligence") && data[0].availableNow.join("|").includes("Lead dashboard and monthly report") && data[0].availableNow.join("|").includes("Review link, QR code and printable review card") && !/AI receptionist|text-back|Google Business|Booking/i.test(data[0].availableNow.join(" ")),
  laterListComplete: ["AI receptionist", "fair-use cap", "Missed-call text-back", "Automatic review requests", "Google Business Profile", "Booking requests"].every((f) => data[0].comingLater.join(" | ").includes(f)),
  handArranged: /arranged by hand/.test(data[0].honestNote) && /confirm what is included and the price/.test(data[0].honestNote) && /By request/.test(data[0].badge),
  noGrowthClash: data[0].name === "NXQX Web Pro" && tiersData.filter((t) => t.key === "growth").length === 1,
  pageSection: /id="by-request"/.test(pl) && /data-testid="by-request-now"/.test(pl) && /data-testid="by-request-later"/.test(pl) && /Coming later \(planned, not available yet\)/.test(pl),
  clientNote: /data-testid="by-request-note"/.test(mg) && /choose Enterprise, write/.test(mg) && /confirm what is included and the price before anything changes/.test(mg),
  ownerHint: /e\.g\. 300 for NXQX Web Pro v1/.test(owner),
  fourStillFour: /Four clear service levels/.test(pl),
  noDbOrBilling: !/rpc\(|supabase/.test(cat.slice(cat.indexOf("export type ByRequestTierDefinition"), cat.indexOf("export function getProductTier"))),
});
const good = rules(catalog, plans, signup, manage, home, productTiers, byRequestTiers);
check("Pro is a separate by-request list: the four buyable tiers are unchanged and none is named Pro or costs $500", good.separateFromBuyable);
check("Pro cannot be selected or requested through any tier selector (signup, home, the plan-change dropdown)", good.notInSelectors);
check("the plans page has no signup or 'Choose' path for it, only 'Talk to us about' to the contact page", good.noBuyPath);
check("price wording: 'From $300/mo', 'not a checkout price', and the later $500 is a plan that may change", good.priceHonest);
check("version 1 lists ONLY what exists today (Intelligence, lead dashboard + monthly report, review link/QR/card); no phone, Google or booking items", good.v1OnlyWhatExists);
check("the 'coming later' list holds every planned item from the owner's notes, incl. the AI receptionist's fair-use cap", good.laterListComplete);
check("it says it is arranged by hand and the price is confirmed before anything starts", good.handArranged);
check("it does not reuse the name 'Growth'", good.noGrowthClash);
check("the public page has the section with separate 'available now' and 'coming later' lists; the client screen explains how to ask (choose Enterprise, write Pro in the note)", good.pageSection && good.clientNote);
check("the owner's approve-price box hints at the Pro v1 price", good.ownerHint);
check("the plans page still says four service levels (four are for sale)", good.fourStillFour);
check("the catalog entry touches no database or billing code", good.noDbOrBilling);
check("PLANTED BUG caught: Pro slips into the buyable list", rules(catalog, plans, signup, manage, home, [...productTiers, { key: "web-pro", priceLabel: "$300/mo" }], byRequestTiers).separateFromBuyable === false);
check("PLANTED BUG caught: the plan-change dropdown offers it", rules(catalog, plans, signup, manage.replace("{BY_REQUEST_TIERS.map((tier) => (\n                  <small", "{BY_REQUEST_TIERS.map((tier) => (\n                  <option"), home, productTiers, byRequestTiers).notInSelectors === false);
check("PLANTED BUG caught: a signup link to Pro appears", rules(catalog, plans.replace('href="/contact">{tier.ctaLabel}', 'href="/portal/signup?family=business&tier=web-pro">{tier.ctaLabel}'), signup, manage, home, productTiers, byRequestTiers).noBuyPath === false);
check("PLANTED BUG caught: an unbuilt feature is listed as available now", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, availableNow: [...pro.availableNow, "AI receptionist"] }]).v1OnlyWhatExists === false);
check("PLANTED BUG caught: a planned feature is dropped from the later list", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, comingLater: pro.comingLater.filter((f) => !/Missed-call/.test(f)) }]).laterListComplete === false);
check("PLANTED BUG caught: the price loses 'from' and shows a flat $500", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, priceLabel: "$500/mo" }]).priceHonest === false);
check("PLANTED BUG caught: the hand-arranged wording is removed", rules(catalog, plans, signup, manage, home, productTiers, [{ ...pro, honestNote: "Great package." }]).handArranged === false);
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll by-request-tier checks passed (offline).");
process.exit(failures ? 1 : 0);
