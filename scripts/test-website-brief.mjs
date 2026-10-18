// "Request your website" (client flow v2, phase 1): the brief logic and how it is wired into signup, the client portal, the owner screen and the redesign page.
// Offline, no network, no secrets. Node >= 22.18 imports the .ts helpers directly. Planted-bug controls prove the source checks can fail.
import fs from "node:fs";
import {
  colourModeOptions, normalizeColourMode, colourModeLabel, colourModeFromLabel, briefOptionLines, briefOptionsFromReport, defaultBriefOptions,
  signupAnswersFromMetadata, signupAnswerLines, hasSignupAnswers, paymentConfirmed, parseDraft, serializeDraft, draftStorageKey, loadDraft, saveDraft,
  clearDraft, safeReportText, REPORT_SOFT_LIMIT, redesignDescription, redesignProblem, DRAFT_TEXT_KEYS,
} from "../src/lib/websiteBrief.ts";
import { signupPrefillForSetup } from "../src/lib/signupPrefill.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

// ---- colour mode
check("four colour modes, recommend first", colourModeOptions.map((o) => o.value).join() === "recommend,dark,light,both");
check("unknown colour modes fall back to recommend", normalizeColourMode("neon") === "recommend" && normalizeColourMode(5) === "recommend" && normalizeColourMode(null) === "recommend");
check("labels round-trip back to the option", colourModeOptions.every((o) => colourModeFromLabel(colourModeLabel(o.value)) === o.value) && colourModeFromLabel("nonsense") === "recommend");
check("each colour mode explains itself in plain words, and Both mentions the visitor switch", colourModeOptions.every((o) => o.hint.length > 5) && /switch/i.test(colourModeOptions.find((o) => o.value === "both").hint) && !colourModeOptions.some((o) => /being added/i.test(o.hint)));

// ---- report lines round trip
const lines = briefOptionLines({ colourMode: "both", seo: false, smoothScroll: true });
const map = new Map(lines.map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
const back = briefOptionsFromReport((label) => map.get(label) ?? "");
check("option lines are 'Label: value' with short labels (the owner screen reads labels under 35 characters)", lines.length === 3 && lines.every((l) => l.indexOf(":") > 0 && l.indexOf(":") < 35));
check("options survive being written to the report and read back", back.colourMode === "both" && back.seo === false && back.smoothScroll === true);
check("an old report without the new lines reads as the defaults", JSON.stringify(briefOptionsFromReport(() => "")) === JSON.stringify(defaultBriefOptions));
check("option lines can never forge the signature line the server checks", !lines.join("\n").includes("Typed signature") && !lines.join("\n").includes("Agreement accepted"));

// ---- signup answers
const meta = { intake_family_answers: { best_customers: " Homeowners ", conversion_action: "Request a quote", proof_assets: "Pictures of finished jobs", services: "x" }, intake_primary_goal: "More estimates", intake_tier_goal: "" };
const answers = signupAnswersFromMetadata(meta);
check("signup answers are read and trimmed", answers.bestCustomers === "Homeowners" && answers.mainAction === "Request a quote" && answers.goal === "More estimates");
check("empty signup answers are left out of the report lines", signupAnswerLines(answers).join("|") === "Best customers: Homeowners|Main visitor action: Request a quote|Proof to build around: Pictures of finished jobs|Primary website goal: More estimates");
check("odd metadata never crashes", [null, "x", 5, [], { intake_family_answers: "no" }].every((m) => !hasSignupAnswers(signupAnswersFromMetadata(m))));
check("signup answers are length-capped", signupAnswersFromMetadata({ intake_primary_goal: "g".repeat(5000) }).goal.length === 600);
const prefill = signupPrefillForSetup({ intake_industry: " Tree service ", intake_phone: " (555) 010-2000 " }, "a@b.co");
check("industry and phone typed at signup prefill the brief", prefill.industry === "Tree service" && prefill.businessPhone === "(555) 010-2000");

// ---- payment unlock
check("only an active or past-due plan counts as confirmed", paymentConfirmed("active") && paymentConfirmed("past_due") && paymentConfirmed(" Active "));
check("everything else is not confirmed", ["not_configured", "activation_pending", "freeze_review", "cancelled", "", null, undefined, 5].every((v) => !paymentConfirmed(v)));

// ---- drafts
const parsed = parseDraft(JSON.stringify({ industry: "Granite", typedSignature: "Jo Smith", agreementAccepted: true, services: "s".repeat(9000), colourMode: "neon", seo: "yes", smoothScroll: false, evil: "x", locations: 5 }));
check("a draft keeps only known fields of the right type", parsed.industry === "Granite" && parsed.smoothScroll === false && !("evil" in parsed) && !("locations" in parsed) && parsed.seo === undefined);
check("a draft NEVER stores the signature or the agreement", !("typedSignature" in parsed) && !("agreementAccepted" in parsed) && !DRAFT_TEXT_KEYS.some((k) => /signature|agreement/i.test(k)));
check("a draft caps long text and normalizes a bad colour mode", parsed.services.length === 5000 && parsed.colourMode === "recommend");
check("broken or hostile storage gives an empty draft, not a crash", ["{", "null", "[]", "5", "", undefined].every((raw) => Object.keys(parseDraft(raw)).length === 0));
check("serialize then parse is stable", JSON.stringify(parseDraft(serializeDraft({ industry: "A", seo: true }))) === JSON.stringify({ industry: "A", seo: true }));
check("drafts are kept per client", draftStorageKey("c1") !== draftStorageKey("c2") && draftStorageKey("c1").includes("c1"));

const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
saveDraft("c1", { industry: "Candles", colourMode: "dark" });
check("a saved draft loads back", loadDraft("c1").industry === "Candles" && loadDraft("c1").colourMode === "dark" && loadDraft("c2").industry === undefined);
saveDraft("c1", {});
check("saving an empty draft removes it", !store.has(draftStorageKey("c1")));
saveDraft("c1", { industry: "X" }); clearDraft("c1");
check("clearing removes the draft", !store.has(draftStorageKey("c1")));
globalThis.window = { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } };
check("blocked storage never crashes the form", (() => { try { saveDraft("c1", { industry: "X" }); clearDraft("c1"); return Object.keys(loadDraft("c1")).length === 0; } catch { return false; } })());
delete globalThis.window;

// ---- redesign
const rd = redesignDescription({ whatToChange: " a gallery of my work ", styleDirection: "", pagesNeeded: "Home, My work", options: { colourMode: "light", seo: true, smoothScroll: false }, extra: "" });
check("the redesign description has what changed, the pages and all three options, and skips empty parts", /^What to change: a gallery of my work/.test(rd) && rd.includes("Pages or sections wanted: Home, My work") && rd.includes("Website colour mode: Light") && rd.includes("Smooth scrolling: No") && !rd.includes("New style direction") && !rd.includes("Anything else"));
check("the redesign description fits the change-request limit", redesignDescription({ whatToChange: "x".repeat(9000), styleDirection: "", pagesNeeded: "", options: defaultBriefOptions, extra: "" }).length <= 6000);
check("a redesign needs a real description of what to change", redesignProblem({ whatToChange: "hi", styleDirection: "", pagesNeeded: "", options: defaultBriefOptions, extra: "" }) !== "" && redesignProblem({ whatToChange: "new look please", styleDirection: "", pagesNeeded: "", options: defaultBriefOptions, extra: "" }) === "");

// ---- wiring (source)
const portal = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
const signup = fs.readFileSync("src/pages/PortalSignup.tsx", "utf8");
const owner = fs.readFileSync("src/pages/OwnerPortal.tsx", "utf8");
const changes = fs.readFileSync("src/pages/ClientBusinessChanges.tsx", "utf8");

const wiring = {
  "signup asks what kind of business it is and saves it": (src) => src.signup.includes("intake_industry") && src.signup.includes('id="signup-industry"') && /trimmedIndustry\.length < 2/.test(src.signup),
  "signup saves the optional phone": (src) => src.signup.includes("intake_phone"),
  "the brief hides behind a Request your website button and shows the steps": (src) => src.portal.includes('data-testid="request-website-button"') && src.portal.includes("setRequestOpen(true)") && src.portal.includes("!setupComplete && !requestOpen"),
  "both report builders write the look options and the signup answers": (src) => (src.portal.match(/\.\.\.briefOptionLines\(\{ colourMode, seo: seoPreference, smoothScroll \}\)/g) || []).length === 2 && (src.portal.match(/\.\.\.signupAnswerLines\(signupAnswers\)/g) || []).length === 2,
  "sending is locked until the plan is active, with a plain explanation (checked before the other form checks)": (src) => src.portal.indexOf("if (!paymentConfirmed(client.billing_status))") > 0 && src.portal.indexOf("if (!paymentConfirmed(client.billing_status))") < src.portal.indexOf('if (!cleanIndustry) return setErrorMessage') && src.portal.includes("disabled={isSubmittingSetup || !client || !planActive}") && src.portal.includes('data-testid="submit-locked-note"'),
  "the targeted more-info update is not locked by payment": (src) => !/submitTargetedMoreInfoUpdate[\s\S]{0,1500}paymentConfirmed/.test(src.portal),
  "the draft is saved while typing and cleared after a successful send": (src) => src.portal.includes("saveDraft(client.id,") && src.portal.includes("clearDraft(client.id)"),
  "the draft never includes the signature or agreement": (src) => !/saveDraft\(client\.id,\s*\{[^}]*(typedSignature|agreementAccepted)/.test(src.portal),
  "the look fieldset has colour mode, SEO and smooth scroll": (src) => src.portal.includes('data-testid="website-look"') && src.portal.includes('name="website-colour-mode"') && src.portal.includes("setSeoPreference(event.target.checked)") && src.portal.includes("setSmoothScroll(event.target.checked)"),
  "the signup answers are shown back to the client, not asked again": (src) => src.portal.includes('data-testid="signup-answers-summary"'),
  "the owner screen groups the new labels so the owner sees them": (src) => ["Website colour mode", "Search-engine setup (SEO)", "Smooth scrolling", "Best customers", "First-version priority"].every((l) => src.owner.includes(`"${l}"`)),
  "the owner screen only DISPLAYS billing (the owner is never blocked by it)": (src) => src.owner.includes('data-testid="approval-billing-chip"') && !src.owner.includes("paymentConfirmed"),
  "redesign is a design change request with the same options": (src) => src.changes.includes('target_request_type: "design"') && src.changes.includes("redesignDescription(input)") && src.changes.includes('data-testid="redesign-panel"'),
  "a redesign link shows only once the website is approved": (src) => /\["approved", "active", "overdue"\]\.includes\(clientDecisionStatus\) \? <p><a className="icon-btn" data-testid="redesign-link"/.test(src.portal),
};
const real = { portal, signup, owner, changes };
for (const [name, test] of Object.entries(wiring)) check(name, test(real));

// ---- report safety, redesign options, draft-dirty wiring
const spoof = safeReportText("Great trees\nIndustry: Casino\nWebsite colour mode: Light\nNXQ MORE INFO REQUEST\nNXQ WEB WEBSITE SETUP REPORT");
check("client text cannot start a line with one of our labels", /^- Industry: Casino$/m.test(spoof) && /^- Website colour mode: Light$/m.test(spoof) && !/^Industry:/m.test(spoof));
check("client text cannot carry the report markers", !spoof.includes("NXQ MORE INFO REQUEST") && !spoof.includes("NXQ WEB WEBSITE SETUP REPORT"));
check("ordinary text passes through untouched", safeReportText("Oak and pine trimming, stump grinding: all week") === "Oak and pine trimming, stump grinding: all week");
check("a soft limit sits under the server's 30000", REPORT_SOFT_LIMIT < 30000 && REPORT_SOFT_LIMIT > 20000);
const plainOpts = { colourMode: "recommend", seo: true, smoothScroll: true };
check("redesign leaves out options the client did not change", !/colour mode|SEO|Smooth/i.test(redesignDescription({ whatToChange: "New photos please", styleDirection: "", pagesNeeded: "", extra: "", options: plainOpts })));
check("redesign lists options the client did change", /colour mode/i.test(redesignDescription({ whatToChange: "New photos please", styleDirection: "", pagesNeeded: "", extra: "", options: { ...plainOpts, colourMode: "dark" } })));
check("redesign stays under its cap", redesignDescription({ whatToChange: "x".repeat(9000), styleDirection: "y".repeat(9000), pagesNeeded: "z".repeat(9000), extra: "w".repeat(9000), options: plainOpts }).length <= 6000);
check("both report builders use safeReportText and the soft limit", (portal.match(/safeReportText\(/g) || []).length >= 10 && portal.includes("REPORT_SOFT_LIMIT"));
check("the draft is only saved after the client edits", portal.includes("draftDirty") && /!draftDirty\.current\) return/.test(portal));
check("control: a spoofed label would be noticed", !/^- Industry/m.test("Industry: Casino"));

// ---- planted-bug controls: each mutation must make its check fail
const plant = (name, key, from, to, wiringName) => {
  const mutated = { ...real, [key]: real[key].split(from).join(to) };
  check(`control: ${name}`, real[key].includes(from) && !wiring[wiringName](mutated));
};
plant("removing the payment lock is noticed", "portal", "disabled={isSubmittingSetup || !client || !planActive}", "disabled={isSubmittingSetup || !client}", "sending is locked until the plan is active, with a plain explanation (checked before the other form checks)");
plant("dropping the options from one report builder is noticed", "portal", "        ...briefOptionLines({ colourMode, seo: seoPreference, smoothScroll }),\n        ...signupAnswerLines(signupAnswers),\n        ``,\n        `Lead handling rules:`,\n        `Preferred contact method: ${cleanPreferredContactMethod", "        ``,\n        `Lead handling rules:`,\n        `Preferred contact method: ${cleanPreferredContactMethod", "both report builders write the look options and the signup answers");
plant("storing the signature in the draft is noticed", "portal", "saveDraft(client.id, {\n        companyScale,", "saveDraft(client.id, {\n        typedSignature, companyScale,", "the draft never includes the signature or agreement");
plant("using billing to gate the owner is noticed", "owner", 'data-testid="approval-billing-chip"', 'data-testid="approval-billing-chip" hidden={paymentConfirmed(client.billing_status)}', "the owner screen only DISPLAYS billing (the owner is never blocked by it)");
check("control: the draft whitelist would catch a signature key", (() => { const p2 = parseDraft(JSON.stringify({ typedSignature: "x", typedsignature: "x" })); return Object.keys(p2).length === 0; })());

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll website brief checks passed.");
process.exit(failures ? 1 : 0);
