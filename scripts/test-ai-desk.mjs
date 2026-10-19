// AI Desk kit: the "Copy AI task" text, the answer checker, and a drift guard against the Edge functions.
// Offline, no network, no secrets. Node >= 22.18 imports the .ts helper directly.
// Planted-bug controls: every bad answer below must be REJECTED, or the checker is not really checking.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildDeskRequest, deskTaskText, DESK_RULES, listFromText, suggestedPages } from "../src/lib/aiDesk.ts";
import {
  parseDeskReply, validateDeskRequest, validateDeskResult, TEXT_LIMITS, LIST_LIMITS, SERVICE_DESCRIPTION_LIMITS,
  PAGE_OBJECTIVE_LIMITS, PAGE_SECTION_LIMITS, DESK_THEMES, DESK_TOP_LEVEL_KEYS, DESK_MINIMUM_CONFIDENCE,
} from "./lib/ai-desk.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));

const fields = [
  { label: "Business phone", value: "555-0100" },
  { label: "Business email", value: "owner@example.com" },
  { label: "Industry", value: "Candles and soap" },
  { label: "Services / products", value: "Soy candles\nHandmade soap\nGift sets" },
  { label: "Brand difference / positioning", value: "Small-batch candles and soap made by hand in Chico." },
  { label: "Style direction", value: "Warm, simple, cream and gold" },
  { label: "Locations", value: "Chico, California" },
];
const built = await buildDeskRequest({ fields, businessName: "Light of the world candles and soap", tierKey: "starter" });
check("builds a request from a complete setup sheet", built.ok === true);
const request = built.request;
check("the built request passes the request checker", validateDeskRequest(request).length === 0, validateDeskRequest(request).join("; "));
check("service area falls back to the Locations field", request.input.service_area === "Chico, California");
check("services come from the setup sheet, in order", request.input.services.join("|") === "Soy candles|Handmade soap|Gift sets");
check("fingerprint is 64 hex and stable", /^[a-f0-9]{64}$/.test(request.request_fingerprint)
  && (await buildDeskRequest({ fields, businessName: "Light of the world candles and soap", tierKey: "starter" })).request.request_fingerprint === request.request_fingerprint);
const other = await buildDeskRequest({ fields: fields.map((f) => f.label === "Style direction" ? { ...f, value: "Bold and dark" } : f), businessName: "Light of the world candles and soap" });
check("a different sheet gives a different fingerprint", other.request.request_fingerprint !== request.request_fingerprint);

const taskText = deskTaskText(request);
check("task text never contains contact details", !/555-0100|owner@example\.com/.test(taskText));
check("task text has the request markers the checker reads", taskText.includes("REQUEST_JSON_START") && taskText.includes("REQUEST_JSON_END"));
check("task text tells the AI to reply with JSON only", /ONLY the JSON/.test(taskText));

const missing = await buildDeskRequest({ fields: fields.filter((f) => f.label !== "Style direction" && f.label !== "Services / products"), businessName: "X Co" });
check("missing sheet fields are named, not guessed", missing.ok === false && missing.missing.includes("Style direction") && missing.missing.includes("Services / products"));
check("page rule: four base pages", suggestedPages(["a", "b"], "candles").join() === "Home,About,Services,Contact");
check("page rule: trades get Reviews, big menus get Service Areas", suggestedPages(["a", "b", "c", "d"], "roofing").join() === "Home,About,Services,Reviews,Service Areas,Contact");
check("list splitting handles commas, newlines and bullets", listFromText("a, b\nc•d|e;f").length === 6);

// A good, grounded answer for this request (no banned claim words).
const good = {
  schema_version: "nxq-business-build-plan-v1",
  request_fingerprint: request.request_fingerprint,
  confidence: 0.9,
  risk_flags: [],
  strategy: {
    positioning: "Hand-poured soy candles and handmade soap from Chico, California.",
    audiences: ["Gift shoppers", "People who like handmade home goods"],
    value_proposition: "Candles and soap made by hand in small batches, with simple gift sets for any occasion.",
    voice: "Warm, simple and friendly.",
    hero: { eyebrow: "Made in Chico", headline: "Handmade candles and soap", subheadline: "Soy candles, handmade soap and gift sets, made by hand in Chico, California." },
    service_descriptions: [
      { service: "Soy candles", description: "Hand-poured soy candles made in small batches in Chico, California." },
      { service: "Handmade soap", description: "Soap made by hand in small batches, in a range of simple scents." },
      { service: "Gift sets", description: "Candle and soap gift sets put together by hand for birthdays and holidays." },
    ],
    trust_points: ["Made by hand", "Small batches", "Based in Chico, California"],
    about_summary: "Light of the world candles and soap makes soy candles, handmade soap and gift sets by hand in small batches in Chico, California.",
    seo: { title: "Handmade candles and soap in Chico", description: "Soy candles, handmade soap and gift sets made by hand in small batches in Chico, California.", keywords: ["handmade candles", "handmade soap", "gift sets"] },
    page_strategy: request.contract.allowed_pages.map((page) => ({ page, objective: `Help visitors understand the ${page} page of the shop quickly.`, sections: ["Short introduction", "Main content"] })),
    design: { theme_key: "charcoal_gold", mood: "Warm and simple with a cream and gold feel.", palette_guidance: ["Cream background", "Gold accents"], typography_guidance: "Clean serif headings with simple body text.", motion_guidance: "Gentle fades only." },
  },
};
const goodProblems = validateDeskResult(good, request);
check("a grounded, correctly shaped answer passes", goodProblems.length === 0, goodProblems.join("; "));

const bad = (name, mutate) => {
  const copy = clone(good); mutate(copy);
  const problems = validateDeskResult(copy, request);
  check(`planted bug rejected: ${name}`, problems.length > 0);
};
bad("wrong fingerprint", (r) => { r.request_fingerprint = "0".repeat(64); });
bad("extra top-level key", (r) => { r.notes = "hi"; });
bad("missing top-level key", (r) => { delete r.risk_flags; });
bad("schema version changed", (r) => { r.schema_version = "v2"; });
bad("confidence below 0.82", (r) => { r.confidence = 0.5; });
bad("confidence as text", (r) => { r.confidence = "0.9"; });
bad("risk flag present", (r) => { r.risk_flags = ["unsure about hours"]; });
bad("service renamed", (r) => { r.strategy.service_descriptions[0].service = "Luxury candles"; });
bad("service left out", (r) => { r.strategy.service_descriptions.pop(); });
bad("service repeated", (r) => { r.strategy.service_descriptions[2].service = "Soy candles"; });
bad("page added", (r) => { r.strategy.page_strategy.push({ page: "Blog", objective: "Share news with visitors every week.", sections: ["One", "Two"] }); });
bad("page left out", (r) => { r.strategy.page_strategy.pop(); });
bad("theme outside the list", (r) => { r.strategy.design.theme_key = "hot_pink"; });
bad("link inside copy", (r) => { r.strategy.about_summary += " Visit https://example.com for more about the shop."; });
bad("markup inside copy", (r) => { r.strategy.hero.headline = "Handmade <b>candles</b> and soap"; });
bad("headline too short", (r) => { r.strategy.hero.headline = "Candles"; });
bad("too few trust points", (r) => { r.strategy.trust_points = ["Made by hand"]; });
bad("duplicate keywords", (r) => { r.strategy.seo.keywords = ["candles", "candles", "soap"]; });
bad("strategy missing", (r) => { delete r.strategy; });
bad("banned claim word (premium)", (r) => { r.strategy.positioning = "Premium hand-poured soy candles from Chico, California."; });
bad("invented guarantee", (r) => { r.strategy.value_proposition = "Candles and soap made by hand, and every order is guaranteed to arrive."; });
bad("invented years in business", (r) => { r.strategy.about_summary = "Light of the world candles and soap has 20 years of experience making candles by hand in Chico."; });
check("claims the sheet itself uses are allowed", (() => {
  const r2 = clone(request); r2.input.goals = "Premium small-batch candles made by hand in Chico.";
  const g = clone(good); g.strategy.positioning = "Premium hand-poured soy candles from Chico, California.";
  return validateDeskResult(g, r2).length === 0;
})());

const badRequest = (name, mutate) => { const c = clone(request); mutate(c); check(`planted bug rejected (request): ${name}`, validateDeskRequest(c).length > 0); };
badRequest("contract list differs from input", (r) => { r.contract.allowed_services = ["Something else"]; });
badRequest("safety flag off", (r) => { r.contract.no_links_or_markup = false; });
badRequest("confidence floor lowered", (r) => { r.contract.minimum_confidence = 0.1; });
badRequest("unsupported input field (contact leaked in)", (r) => { r.input.contact_email = "a@b.com"; });
badRequest("bad fingerprint", (r) => { r.request_fingerprint = "nope"; });

check("several kinds of problem are all reported in one pass", (() => {
  const c = clone(good); c.request_fingerprint = "0".repeat(64); c.strategy.positioning = "Premium hand-poured soy candles from Chico, California."; c.confidence = 0.1;
  const text = validateDeskResult(c, request).join(" | ");
  return /fingerprint/.test(text) && /confidence/.test(text) && /premium business claim/.test(text);
})());
check("a malformed strategy does not crash the claim scan", (() => { const c = clone(good); c.strategy.hero = "oops"; c.strategy.audiences = 5; c.strategy.service_descriptions = null; try { return validateDeskResult(c, request).length > 0; } catch { return false; } })());

// Reply parsing
check("reply parsing: plain JSON", parseDeskReply(JSON.stringify(good)).ok === true && parseDeskReply(JSON.stringify(good)).notes.length === 0);
const fenced = parseDeskReply("Here you go:\n```json\n" + JSON.stringify(good) + "\n```\nHope that helps!");
check("reply parsing: tolerates a fence but flags it", fenced.ok === true && fenced.notes.length === 1);
check("reply parsing: rejects empty and garbage", parseDeskReply("").ok === false && parseDeskReply("sorry I cannot").ok === false);

// The command-line checker, end to end, on the exact text the Copy button produces.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-desk-"));
  const taskFile = path.join(dir, "task.txt");
  fs.writeFileSync(taskFile, taskText);
  const run = (answer) => {
    const answerFile = path.join(dir, "answer.txt");
    fs.writeFileSync(answerFile, answer);
    return spawnSync("node", ["scripts/validate-ai-output.mjs", "build-plan", taskFile, answerFile], { encoding: "utf8" });
  };
  const ok = run(JSON.stringify(good));
  check("CLI: a good answer exits 0 and says PASS", ok.status === 0 && /^PASS/m.test(ok.stdout), ok.stdout);
  const wrong = clone(good); wrong.strategy.positioning = "Premium hand-poured soy candles from Chico, California.";
  const rejected = run(JSON.stringify(wrong));
  check("CLI: a claim the sheet never made exits 1 and names it", rejected.status === 1 && /premium business claim/.test(rejected.stdout), rejected.stdout);
  check("CLI: garbage exits 1", run("no thanks").status === 1);
  check("CLI: wrong usage exits 2", spawnSync("node", ["scripts/validate-ai-output.mjs"], { encoding: "utf8" }).status === 2);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Drift guard: the checker must say the same things the Edge functions say.
const gen = fs.readFileSync("supabase/functions/generate-business-build-plan/index.ts", "utf8");
const prep = fs.readFileSync("supabase/functions/prepare-build-plan/index.ts", "utf8");
for (const [i, rule] of DESK_RULES.entries()) check(`drift: rule ${i + 1} is word-for-word in generate-business-build-plan`, gen.includes(JSON.stringify(rule)));
check("drift: top-level keys match", gen.includes(`"${DESK_TOP_LEVEL_KEYS}"`));
check("drift: minimum confidence matches", prep.includes(`minimumConfidence = ${DESK_MINIMUM_CONFIDENCE}`));
check("drift: themes match", gen.includes(`new Set(${JSON.stringify(DESK_THEMES).replace(/,/g, ", ")})`) && prep.includes(`new Set(${JSON.stringify(DESK_THEMES).replace(/,/g, ", ")})`));
const textCalls = new Map([...prep.matchAll(/aiText\(\w+(?:\.\w+)?, "([\w.]+)", (\d+), (\d+)\)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
const listCalls = new Map([...prep.matchAll(/aiTextList\(\w+(?:\.\w+)?, "([\w.]+)", (\d+), (\d+), (\d+)\)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4])]]));
for (const [path, min, max] of TEXT_LIMITS) {
  const got = textCalls.get(path);
  check(`drift: text limit ${path}`, Boolean(got) && got[0] === min && got[1] === max, got ? `worker says ${got}` : "not found in worker");
}
for (const [path, a, b, c] of LIST_LIMITS) {
  const got = listCalls.get(path);
  check(`drift: list limit ${path}`, Boolean(got) && got[0] === a && got[1] === b && got[2] === c, got ? `worker says ${got}` : "not found in worker");
}
check("drift: service description and page objective limits", prep.includes(`\`service_descriptions[\${index}].description\`, ${SERVICE_DESCRIPTION_LIMITS.join(", ")})`)
  && prep.includes(`\`page_strategy[\${index}].objective\`, ${PAGE_OBJECTIVE_LIMITS.join(", ")})`)
  && prep.includes(`\`page_strategy[\${index}].sections\`, ${PAGE_SECTION_LIMITS.join(", ")})`));
check("drift: page rule and list splitting match the worker", prep.includes('const pages = ["Home", "About", "Services", "Contact"];')
  && prep.includes("if (services.length >= 4) pages.splice(3, 0, \"Service Areas\");")
  && prep.includes("/roof|tree|hvac|plumb|electric|contract|detail|auto|landscap|clean/i")
  && prep.includes(".split(/\\n|,|;|\\u2022|\\|/g)"));
// Control: the drift guard really notices a changed limit.
check("control: drift guard notices a changed limit", !prep.includes('"positioning", 20, 301)') && textCalls.get("positioning")[1] === 300);

// Front-end wiring
const portal = fs.readFileSync("src/pages/OwnerPortal.tsx", "utf8");
const lib = fs.readFileSync("src/lib/aiDesk.ts", "utf8");
check("the old per-approval Copy button is gone (the panel is the one place to copy from)", !portal.includes("copyAiTask") && !portal.includes("Copy AI task"));
check("Copy AI task only builds text (no network, no database)", !/fetch\(|supabase|\.rpc\(|XMLHttpRequest/.test(lib));
check("builder never reads contact fields", !/Business phone|Business email|contact_email|contact_phone|contact_name/.test(lib));

const panel = fs.readFileSync("src/components/OwnerAiDesk.tsx", "utf8");
check("owner screen shows the AI Desk panel with the checker", portal.includes("<OwnerAiDesk clients={deskClients}") && panel.includes("validateDeskResult") && panel.includes("parseDeskReply"));
check("approving a client preselects them in the AI Desk", /setActionMessage\([\s\S]{0,200}?\);\s*setDeskClientId\(client\.id\)/.test(portal));
check("the panel never touches the network or database", !/fetch\(|supabase|\.rpc\(|XMLHttpRequest/.test(panel));
check("the panel is honest that saving is not connected", panel.includes("not connected yet"));
check("the browser and command-line checker are the same file", fs.readFileSync("scripts/lib/ai-desk.mjs", "utf8").includes("src/lib/aiDeskCheck.ts"));

check("the task tells the AI that any risk flag stops the plan (the shared rule says to add one, the pipeline refuses it)", taskText.includes("risk_flags must be an empty list []") && taskText.includes("instead of flagging it"));
check("control: a task without that line would be noticed", !taskText.replace(/- risk_flags must be an empty list \[\][^\n]*\n/, "").includes("risk_flags must be an empty list []"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll AI Desk checks passed.");
process.exit(failures ? 1 : 0);
