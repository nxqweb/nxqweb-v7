// The shared "Request your ..." front door: Business keeps the in-portal brief, Booking reuses it with its own words, Commerce goes to its own setup page.
import fs from "node:fs";
import { commerceSetupPrefill, familySlugFromMetadata, productFlowFor } from "../src/lib/productFlow.ts";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}

check("business opens the brief inside the portal", productFlowFor("business").setupHref === null && productFlowFor("business").title === "Request your website");
check("booking uses the same brief with booking words", productFlowFor("booking").setupHref === null && /booking/i.test(productFlowFor("booking").title));
check("commerce goes to its own setup page and says store", productFlowFor("commerce").setupHref === "/client/commerce/setup" && /store/i.test(productFlowFor("commerce").title));
check("unknown, empty or hostile families fall back to business", ["", "menu", "__proto__", "constructor", null, undefined, 5, {}].every((v) => productFlowFor(v).family === "business"));
check("family names are matched case-insensitively and trimmed", productFlowFor(" Commerce ").family === "commerce");
check("the family is read from account data, and odd data gives empty", familySlugFromMetadata({ product_family_slug: " Commerce " }) === "commerce" && [null, "x", 5, [], {}].every((m) => familySlugFromMetadata(m) === ""));
check("every flow names its three-step wording", ["business", "booking", "commerce"].every((f) => productFlowFor(f).requestStep.length > 20 && productFlowFor(f).buttonLabel.length > 5));

const pre = commerceSetupPrefill({ intake_family_answers: { products: " Candles and soap " } }, "  Wick & Wax ");
check("the store name and products come from signup, trimmed", pre.storeName === "Wick & Wax" && pre.productTypes === "Candles and soap");
check("products fall back to the services answer, then the details", commerceSetupPrefill({ intake_family_answers: { services: "Tees" } }, "A").productTypes === "Tees" && commerceSetupPrefill({ intake_family_details: "Hats" }, "A").productTypes === "Hats");
check("prefill is length-capped and never crashes on odd data", commerceSetupPrefill({ intake_family_details: "x".repeat(9000) }, "n".repeat(500)).productTypes.length === 2000 && commerceSetupPrefill(null, null).storeName === "" && commerceSetupPrefill("x", 5).productTypes === "");

// ---- wiring (source) with planted-bug controls
const portal = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
const setup = fs.readFileSync("src/pages/ClientCommerceSetup.tsx", "utf8");
const wiring = {
  "the portal card takes its words and button from the shared flow": (p) => p.includes("productFlowFor(flowFamily)") && p.includes("{flow.title}") && p.includes("{flow.requestStep}") && p.includes("flow.buttonLabel"),
  "a line with its own setup page links there and never opens the business brief": (p) => p.includes("flow.setupHref") && p.includes("!requestOpen || flow.setupHref") && /<a className="wide-btn" data-testid="request-website-button" href=\{flow\.setupHref\}/.test(p),
  "the family comes from the signed-in account data": (p) => p.includes("familySlugFromMetadata(session.user.user_metadata)"),
};
for (const [name, test] of Object.entries(wiring)) check(name, test(portal));
check("the store setup page prefills only a store that was never saved", setup.includes("!saved.store_name?.trim() && !saved.product_types?.trim()") && setup.includes("next.store_name || prefill.storeName"));
const planted = (name, from, to, wiringName) => check(`control: ${name}`, portal.includes(from) && !wiring[wiringName](portal.split(from).join(to)));
planted("the card ignoring the shared flow is noticed", "productFlowFor(flowFamily)", "productFlowFor('')", "the portal card takes its words and button from the shared flow");
planted("commerce opening the business brief is noticed", "!requestOpen || flow.setupHref", "!requestOpen", "a line with its own setup page links there and never opens the business brief");
check("control: prefill overwriting a saved store would be noticed", !setup.replace("!saved.store_name?.trim() && !saved.product_types?.trim()", "true").includes("!saved.store_name?.trim() && !saved.product_types?.trim()"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll product flow checks passed.");
process.exit(failures ? 1 : 0);
