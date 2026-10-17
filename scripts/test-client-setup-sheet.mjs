// Offline test: the website setup sheet starts from the client's signup answers (no typing the same things twice), marks what is
// required, and hides the optional rules block until needed. A client had to retype everything after creating the account.
import fs from "node:fs";
import { signupPrefillForSetup } from "../src/lib/signupPrefill.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const meta = { business_name: "Light Co", intake_family_answers: { services: "  Candles and soap ", best_customers: "x" }, intake_family_details: "details text", intake_service_area: " Sacramento CA " };
const p = signupPrefillForSetup(meta, " a@b.co ");
check("services come from the signup services answer, trimmed", p.services === "Candles and soap");
check("service area and email are carried over, trimmed", p.locations === "Sacramento CA" && p.businessEmail === "a@b.co");
check("falls back to the signup details when there is no services answer", signupPrefillForSetup({ intake_family_details: "  Handmade  " }, "").services === "Handmade");
check("missing, null or wrong-typed data gives empty strings, never a crash", JSON.stringify(signupPrefillForSetup(null, undefined)) === JSON.stringify({ services: "", locations: "", businessEmail: "" })
  && signupPrefillForSetup({ intake_family_answers: "nope", intake_service_area: 5 }, 7).locations === "");
check("very long text is cut to a safe length", signupPrefillForSetup({ intake_family_details: "x".repeat(9000) }, "").services.length === 2000);

const page = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
check("the sheet applies the prefill only on a first visit and never overwrites typing", /\} else \{[\s\S]{0,260}signupPrefillForSetup\(session\.user\.user_metadata, session\.user\.email\)/.test(page)
  && /setServices\(\(current\) => current \|\| prefill\.services\)/.test(page) && /setLocations\(\(current\) => current \|\| prefill\.locations\)/.test(page) && /setBusinessEmail\(\(current\) => current \|\| prefill\.businessEmail\)/.test(page));
check("a quick-start note says only (required) fields are needed", /Only the fields marked \(required\) are needed/.test(page) && /We filled in what you told us at signup/.test(page));
const required = ["industry", "services", "pages-needed", "style-direction", "brand-notes", "typed-signature"];
check("the six required inputs and the agreement are marked (required)", required.every((id) => new RegExp(`htmlFor="${id}">[^<]*<em className="required-mark">\\(required\\)`).test(page)) && /<em className="required-mark">\(required\)<\/em> I acknowledge and agree/.test(page));
check("the marks match what submit really requires", ["Enter the client's industry before submitting.", "Enter the services/products this website needs to explain.", "Enter the pages or sections the website needs.", "Enter the style direction for the website.", "Enter what makes this business different.", "You must accept the website agreement acknowledgment before submitting.", "Type your full name as your signature before submitting."].every((m) => page.includes(m)));
check("lead and assistant rules are one collapsed optional block that opens when already filled", /<OptionalSection defaultOpen=\{leadAndAssistantHaveContent\} title="Lead handling and website assistant rules"/.test(page) && /leadAndAssistantHaveContent = \[preferredContactMethod, urgentLeadRules, rejectedJobs, areasNotServed, aiCanAnswer, aiNeverPromise, escalationRules\]/.test(page));
const inside = page.slice(page.indexOf("<OptionalSection defaultOpen={leadAndAssistantHaveContent}"), page.indexOf('<div className="agreement-box">'));
check("all seven optional inputs stay inside that block and the block closes before the agreement", ["preferred-contact-method", "urgent-lead-rules", "rejected-jobs", "areas-not-served", "ai-can-answer", "ai-never-promise", "escalation-rules"].every((id) => inside.includes(`id="${id}"`)) && inside.includes("</OptionalSection>"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll client-setup-sheet checks passed (offline).");
process.exit(failures ? 1 : 0);
