// Offline test: the Commerce setup form tells a first-time client what is required, hides the optional parts, and makes Save draft
// the main action (a client was confused by a 40-field form with Submit as the big button and no required/optional marks).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const page = fs.readFileSync("src/pages/ClientCommerceSetup.tsx", "utf8");
const css = fs.readFileSync("src/styles/plan-forms.css", "utf8");

check("a quick-start notice says only the store name is needed and everything else is optional", /Quick start: you only need the Store name/.test(page) && /Everything else on this page is optional/.test(page));
check("the notice says review is not needed to open the store", /do not need to send this to NXQX for review to open your store/.test(page));
check("only the two fields the server checks are marked required", (page.match(/required-mark/g) || []).length === 2 && /Store name <em className="required-mark">\(required\)/.test(page) && /only needed if you send this for review/.test(page));
check("the design/motion and policies sections are collapsed optional blocks", (page.match(/<details className="panel panel-wide optional-section"/g) || []).length === 2 && (page.match(/<\/details>/g) || []).length === 2 && (page.match(/<summary className="optional-summary">/g) || []).length === 2);
check("optional sections open by themselves when they already hold the client's answers (nothing is hidden that was filled in)", /open=\{designHasContent\}/.test(page) && /open=\{policiesHaveContent\}/.test(page) && /designHasContent = Boolean\(intake\.storefront_style/.test(page) && /policiesHaveContent = \[intake\.returns_policy/.test(page));
check("every optional field stays inside its details block so saving still sends it (no field removed)", ["storefront_style", "animation_notes", "inspiration_urls", "returns_policy", "refund_policy", "integrations", "brand_assets_notes", "required_pages", "special_features", "launch_priority", "additional_notes", "layout_style", "scroll_behavior"].every((f) => page.includes(`intake.${f}`)));
const saveIdx = page.indexOf('>{saving ? "Saving..." : "Save draft"}<');
const saveButtonTag = page.slice(page.lastIndexOf("<button", saveIdx), saveIdx);
const submitIdx = page.indexOf("Send to NXQX for review (optional)");
const submitButtonTag = page.slice(page.lastIndexOf("<button", submitIdx), submitIdx);
check("Save draft is the main (wide) button", /className="wide-btn"/.test(saveButtonTag) && /saveIntake\(false\)/.test(saveButtonTag));
check("Submit is the quiet secondary button and is labelled optional", /className="icon-btn"/.test(submitButtonTag) && /saveIntake\(true\)/.test(submitButtonTag));
check("a new client's website choice starts on the safest option instead of blocking submit", /website_transition_mode === "not_selected"\) loaded\.website_transition_mode = "nxq_review"/.test(page) && /\["nxq_review", "Let NXQX review and recommend the safest path"\]/.test(page));
check("the server rules did not change: submit still needs a store name", /Enter the store name before submitting for review/.test(page));
check("the collapsible styles exist", /\.optional-section/.test(css) && /\.optional-summary/.test(css) && /\.required-mark/.test(css));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll commerce-setup-form checks passed (offline).");
process.exit(failures ? 1 : 0);
