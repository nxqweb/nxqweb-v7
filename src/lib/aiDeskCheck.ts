// AI Desk checker: the same rules the live pipeline applies to a build-plan request and to the AI answer. One copy, used by the owner screen
// (paste box) and by the command line (scripts/validate-ai-output.mjs, via scripts/lib/ai-desk.mjs). Mirrors supabase/functions/
// generate-business-build-plan (request rules) and prepare-build-plan (answer rules); scripts/test-ai-desk.mjs fails on drift. No network, no secrets.
import { findUnsupportedMarketingClaims } from "../../supabase/functions/_shared/ai-grounding.mjs";

// The AI's answer is untrusted JSON of any shape; every field is checked before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export const DESK_SCHEMA_VERSION = "nxq-business-build-plan-v1";
export const DESK_MINIMUM_CONFIDENCE = 0.82;
export const DESK_THEMES = ["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"];
export const DESK_TOP_LEVEL_KEYS = "confidence,request_fingerprint,risk_flags,schema_version,strategy";

// [path, min, max] for text, [path, minItems, maxItems, itemMax] for lists. Same numbers as the aiText/aiTextList calls in prepare-build-plan.
export const TEXT_LIMITS: [string, number, number][] = [
  ["positioning", 20, 300], ["value_proposition", 25, 320], ["voice", 10, 180],
  ["hero.eyebrow", 3, 80], ["hero.headline", 12, 110], ["hero.subheadline", 35, 260],
  ["about_summary", 60, 600], ["seo.title", 12, 60], ["seo.description", 50, 160],
  ["design.mood", 10, 180], ["design.typography_guidance", 10, 180], ["design.motion_guidance", 10, 180],
];
export const LIST_LIMITS: [string, number, number, number][] = [
  ["audiences", 1, 5, 120], ["trust_points", 3, 6, 100], ["seo.keywords", 3, 10, 80],
  ["design.palette_guidance", 2, 6, 100],
];
export const SERVICE_DESCRIPTION_LIMITS: [number, number] = [30, 280];
export const PAGE_OBJECTIVE_LIMITS: [number, number] = [20, 240];
export const PAGE_SECTION_LIMITS: [number, number, number] = [2, 8, 100];

const isRecord = (v: unknown): v is Record<string, Loose> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

function unsafeText(value: string) {
  const control = Array.from(value).some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
  });
  return control || /[<>]|(?:https?:\/\/|javascript:|data:|mailto:|tel:)/i.test(value);
}

function pick(obj: Loose, path: string) {
  return path.split(".").reduce((acc: Loose, key: string) => (isRecord(acc) ? acc[key] : undefined), obj);
}

// Takes the raw reply the AI Desk chat gave back. Tolerates a code fence or a sentence before/after the JSON, and says so.
export function parseDeskReply(raw: unknown): { ok: true; value: Loose; notes: string[] } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "The reply is empty." };
  try { return { ok: true, value: JSON.parse(text), notes: [] }; } catch { /* fall through to tolerant parse */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return { ok: true, value: JSON.parse(candidate), notes: ["The reply had extra text or a code fence around the JSON. Ask the AI Desk for the JSON only."] };
  } catch {
    return { ok: false, error: "The reply is not valid JSON." };
  }
}

export function validateDeskRequest(root: Loose): string[] {
  const errors: string[] = [];
  if (!isRecord(root)) return ["The request is not a JSON object."];
  if (root.task !== "enrich_business_build_plan_v1" || root.schema_version !== DESK_SCHEMA_VERSION) errors.push("Unsupported task or schema version.");
  if (typeof root.request_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(root.request_fingerprint)) errors.push("request_fingerprint must be 64 lowercase hex characters.");
  const input = isRecord(root.input) ? root.input : {};
  const allowedInput = ["business_name", "business_type", "service_area", "services", "goals", "desired_style", "approved_pages", "product_tier_key"];
  for (const key of Object.keys(input)) if (!allowedInput.includes(key)) errors.push(`input has an unsupported field: ${key}.`);
  const textRule = (label: string, value: Loose, min: number, max: number) => {
    if (typeof value !== "string") return errors.push(`${label} must be text.`);
    const n = collapse(value).length;
    if (n < min || n > max) errors.push(`${label} must be ${min}-${max} characters.`);
  };
  textRule("input.business_name", input.business_name, 2, 160);
  textRule("input.business_type", input.business_type, 2, 160);
  textRule("input.goals", input.goals, 10, 2500);
  textRule("input.desired_style", input.desired_style, 5, 1800);
  textRule("input.product_tier_key", input.product_tier_key, 2, 80);
  const listRule = (label: string, value: Loose, min: number, max: number, itemMax: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) return errors.push(`${label} must have ${min}-${max} items.`);
    const clean = value.map((x) => (typeof x === "string" ? collapse(x) : ""));
    if (clean.some((x) => x.length < 2 || x.length > itemMax)) errors.push(`${label} items must be text of 2-${itemMax} characters.`);
    if (new Set(clean.map((x) => x.toLowerCase())).size !== clean.length) errors.push(`${label} has duplicates.`);
  };
  listRule("input.services", input.services, 1, 8, 120);
  listRule("input.approved_pages", input.approved_pages, 4, 8, 80);
  const contract = isRecord(root.contract) ? root.contract : {};
  listRule("contract.allowed_services", contract.allowed_services, 1, 8, 120);
  listRule("contract.allowed_pages", contract.allowed_pages, 4, 8, 80);
  listRule("contract.allowed_theme_keys", contract.allowed_theme_keys, 1, 4, 80);
  const same = (a: Loose, b: Loose) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(input.services, contract.allowed_services) || !same(input.approved_pages, contract.allowed_pages)) errors.push("The contract lists must match the input services and pages exactly.");
  if (Array.isArray(contract.allowed_theme_keys) && contract.allowed_theme_keys.some((t) => !DESK_THEMES.includes(t))) errors.push("The contract asks for a theme outside the NXQX list.");
  const conf = Number(contract.minimum_confidence);
  if (!Number.isFinite(conf) || conf < DESK_MINIMUM_CONFIDENCE || conf > 1) errors.push("minimum_confidence must be 0.82-1.");
  for (const flag of ["plain_text_only", "no_links_or_markup", "production_or_provider_actions_forbidden", "legal_financial_medical_guarantees_forbidden"]) {
    if (contract[flag] !== true) errors.push(`contract.${flag} must be true.`);
  }
  return errors;
}

// Returns a list of plain-word problems; an empty list means the answer would pass the live pipeline's checks.
export function validateDeskResult(result: Loose, request: Loose): string[] {
  const problems: string[] = [];
  if (!isRecord(result)) return ["The answer is not a JSON object."];
  const keys = Object.keys(result).sort().join(",");
  if (keys !== DESK_TOP_LEVEL_KEYS) problems.push(`Top-level keys must be exactly: ${DESK_TOP_LEVEL_KEYS}. Got: ${keys || "(none)"}.`);
  if (result.schema_version !== DESK_SCHEMA_VERSION) problems.push("schema_version was changed or is missing.");
  if (result.request_fingerprint !== request.request_fingerprint) problems.push("request_fingerprint does not match the task. Copy it back exactly.");
  const confidence = Number(result.confidence);
  if (typeof result.confidence !== "number" || !Number.isFinite(confidence) || confidence < DESK_MINIMUM_CONFIDENCE || confidence > 1) problems.push("confidence must be a number from 0.82 to 1.");
  if (!Array.isArray(result.risk_flags)) problems.push("risk_flags must be a list (use [] when there are none).");
  else if (result.risk_flags.map((x) => String(x ?? "").trim()).filter(Boolean).length > 0) problems.push("risk_flags is not empty, so the pipeline would stop. Re-ask for a plan that stays inside the facts.");
  const strategy = result.strategy;
  if (!isRecord(strategy)) return [...problems, "strategy is missing."];

  const text = (label: string, value: Loose, min: number, max: number) => {
    if (typeof value !== "string") { problems.push(`${label} must be text.`); return; }
    const clean = collapse(value);
    if (clean.length < min || clean.length > max) problems.push(`${label} must be ${min}-${max} characters (it is ${clean.length}).`);
    else if (unsafeText(clean)) problems.push(`${label} contains a link, markup or odd characters.`);
  };
  const list = (label: string, value: Loose, min: number, max: number, itemMax: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) { problems.push(`${label} must have ${min}-${max} items.`); return []; }
    const clean = value.map((x) => (typeof x === "string" ? collapse(x) : ""));
    clean.forEach((item, i) => text(`${label}[${i}]`, item, 2, itemMax));
    if (new Set(clean.map((x) => x.toLowerCase())).size !== clean.length) problems.push(`${label} has duplicates.`);
    return clean;
  };

  for (const [path, min, max] of TEXT_LIMITS) text(path, pick(strategy, path), min, max);
  for (const [path, min, max, itemMax] of LIST_LIMITS) list(path, pick(strategy, path), min, max, itemMax);

  const services = request.contract.allowed_services;
  const rawServices = Array.isArray(strategy.service_descriptions) ? strategy.service_descriptions : [];
  if (rawServices.length !== services.length) problems.push("service_descriptions must cover every service exactly once.");
  const seenServices = new Set();
  rawServices.forEach((item, i) => {
    const name = isRecord(item) && typeof item.service === "string" ? collapse(item.service) : "";
    const canonical = services.find((s: string) => s.trim().toLowerCase() === name.toLowerCase());
    if (!canonical) problems.push(`service_descriptions[${i}] names a service that is not on the approved list.`);
    else seenServices.add(canonical.toLowerCase());
    text(`service_descriptions[${i}].description`, isRecord(item) ? item.description : undefined, ...SERVICE_DESCRIPTION_LIMITS);
  });
  if (rawServices.length === services.length && seenServices.size !== services.length) problems.push("service_descriptions repeats a service or leaves one out.");

  const pages = request.contract.allowed_pages;
  const rawPages = Array.isArray(strategy.page_strategy) ? strategy.page_strategy : [];
  if (rawPages.length !== pages.length) problems.push("page_strategy must cover every approved page exactly once.");
  const seenPages = new Set();
  rawPages.forEach((item, i) => {
    const name = isRecord(item) && typeof item.page === "string" ? collapse(item.page) : "";
    const canonical = pages.find((p: string) => p.trim().toLowerCase() === name.toLowerCase());
    if (!canonical) problems.push(`page_strategy[${i}] names a page that is not approved.`);
    else seenPages.add(canonical.toLowerCase());
    text(`page_strategy[${i}].objective`, isRecord(item) ? item.objective : undefined, ...PAGE_OBJECTIVE_LIMITS);
    list(`page_strategy[${i}].sections`, isRecord(item) ? item.sections : undefined, ...PAGE_SECTION_LIMITS);
  });
  if (rawPages.length === pages.length && seenPages.size !== pages.length) problems.push("page_strategy repeats a page or leaves one out.");

  const theme = pick(strategy, "design.theme_key");
  if (typeof theme !== "string" || !request.contract.allowed_theme_keys.includes(theme.trim().toLowerCase())) problems.push("design.theme_key must be one of the allowed themes.");

  // Always run, so one reply with several kinds of problem lists them all at once (fewer round trips with the chat).
  const claims = findUnsupportedMarketingClaims(strategy, request.input);
  if (claims.length > 0) problems.push(`Unsupported marketing claims (the intake never said these): ${claims.join(", ")}. Re-ask without them.`);
  return problems;
}
