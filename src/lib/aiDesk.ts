// "Copy AI task": turns a client's approved setup sheet into one block of text the owner pastes into the separate NXQX AI Desk chat.
// This builds text only. It calls nothing, stores nothing, and never includes the client's contact details.
// The rules text must stay identical to the Edge function (scripts/test-ai-desk.mjs checks that); the answer is checked with
// `node scripts/validate-ai-output.mjs build-plan <task-file> <answer-file>`.

export type SetupField = { label: string; value: string };

export type DeskRequest = {
  task: "enrich_business_build_plan_v1";
  schema_version: "nxq-business-build-plan-v1";
  request_fingerprint: string;
  input: {
    business_name: string;
    business_type: string;
    service_area: string;
    services: string[];
    goals: string;
    desired_style: string;
    approved_pages: string[];
    product_tier_key: string;
  };
  contract: {
    plain_text_only: true;
    no_links_or_markup: true;
    allowed_services: string[];
    allowed_pages: string[];
    allowed_theme_keys: string[];
    minimum_confidence: number;
    production_or_provider_actions_forbidden: true;
    legal_financial_medical_guarantees_forbidden: true;
  };
};

export const DESK_THEMES = ["midnight_blue", "charcoal_gold", "forest_emerald", "royal_violet"];

export const DESK_RULES = [
  "You are NXQX-Web's Business website strategy engine.",
  "Return only the requested structured result. Never include markdown, HTML, links, code, contact data, or instructions to call tools.",
  "Do not invent certifications, awards, reviews, statistics, guarantees, addresses, years in business, licensing, pricing, or medical, legal, or financial claims.",
  "NXQX rejects any plan that uses these words unless the intake itself uses them, so never write them: trusted, trustworthy, reliable, dependable, expert, expertise, skilled, professional, best, leading, leader, premier, fast, rapid, timely, prompt, responsive, safe, safety, quality, high-quality, premium, licensed, insured, certified, bonded, guarantee, award-winning, top-rated, experienced, sustainable, eco-friendly, same-day, 24/7, free quote, free estimate, customer satisfaction. Describe what the business does and where, in plain neutral words instead.",
  "Use every allowed service exactly once and every allowed page exactly once. Never rename, add, or remove either.",
  "Use plain persuasive copy grounded only in the supplied intake. If the intake cannot safely support a claim, keep it general and add a short risk flag.",
  "The result is a proposal only. It cannot change tiers, infrastructure, approvals, domains, payments, or production state.",
];

export const DESK_ANSWER_SHAPE = `{
  "schema_version": "nxq-business-build-plan-v1",
  "request_fingerprint": "<copy from the request exactly>",
  "confidence": 0.9,
  "risk_flags": [],
  "strategy": {
    "positioning": "20-300 characters",
    "audiences": ["1-5 items, each up to 120 characters"],
    "value_proposition": "25-320 characters",
    "voice": "10-180 characters",
    "hero": { "eyebrow": "3-80", "headline": "12-110", "subheadline": "35-260" },
    "service_descriptions": [{ "service": "<exactly one allowed service>", "description": "30-280 characters" }],
    "trust_points": ["3-6 items, each up to 100 characters"],
    "about_summary": "60-600 characters",
    "seo": { "title": "12-60", "description": "50-160", "keywords": ["3-10 items, each up to 80"] },
    "page_strategy": [{ "page": "<exactly one allowed page>", "objective": "20-240 characters", "sections": ["2-8 items, each up to 100"] }],
    "design": {
      "theme_key": "<one allowed theme>",
      "mood": "10-180",
      "palette_guidance": ["2-6 items, each up to 100"],
      "typography_guidance": "10-180",
      "motion_guidance": "10-180"
    }
  }
}`;

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

function field(fields: SetupField[], label: string) {
  const wanted = label.toLowerCase();
  return clean(fields.find((f) => f.label.toLowerCase() === wanted)?.value);
}

// The worker only trims this one (it keeps line breaks so a services list can be split on them).
function rawField(fields: SetupField[], label: string) {
  const wanted = label.toLowerCase();
  return (fields.find((f) => f.label.toLowerCase() === wanted)?.value ?? "").trim();
}

// Same splitting rule as the Edge worker (prepare-build-plan listFromText).
export function listFromText(value: string) {
  return value
    .split(/\n|,|;|•|\|/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

// Same page rule as the Edge worker (prepare-build-plan suggestedPages).
export function suggestedPages(services: string[], businessType: string) {
  const pages = ["Home", "About", "Services", "Contact"];
  if (services.length >= 4) pages.splice(3, 0, "Service Areas");
  if (/roof|tree|hvac|plumb|electric|contract|detail|auto|landscap|clean/i.test(businessType)) pages.splice(3, 0, "Reviews");
  return [...new Set(pages)];
}

export async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type DeskBuildResult = { ok: true; request: DeskRequest } | { ok: false; missing: string[] };

export async function buildDeskRequest(args: {
  fields: SetupField[];
  businessName: string;
  businessType?: string;
  serviceArea?: string;
  tierKey?: string;
}): Promise<DeskBuildResult> {
  const services = listFromText(rawField(args.fields, "Services / products")).slice(0, 8);
  const businessName = clean(args.businessName);
  const businessType = clean(args.businessType) || field(args.fields, "Industry");
  const goals = field(args.fields, "Brand difference / positioning");
  const desiredStyle = field(args.fields, "Style direction");
  const missing: string[] = [];
  if (businessName.length < 2) missing.push("Business name");
  if (businessType.length < 2) missing.push("Industry");
  if (services.length === 0) missing.push("Services / products");
  if (goals.length < 10) missing.push("Brand difference / positioning");
  if (desiredStyle.length < 5) missing.push("Style direction");
  if (missing.length) return { ok: false, missing };

  const input = {
    business_name: businessName,
    business_type: businessType,
    service_area: clean(args.serviceArea) || field(args.fields, "Locations"),
    services,
    goals,
    desired_style: desiredStyle,
    approved_pages: suggestedPages(services, businessType),
    product_tier_key: clean(args.tierKey) || "starter",
  };
  // Desk-phase fingerprint: ties the answer to exactly this task. The live pipeline computes its own when it is wired up.
  const request_fingerprint = await sha256Hex({ desk: 1, input });
  return {
    ok: true,
    request: {
      task: "enrich_business_build_plan_v1",
      schema_version: "nxq-business-build-plan-v1",
      request_fingerprint,
      input,
      contract: {
        plain_text_only: true,
        no_links_or_markup: true,
        allowed_services: services,
        allowed_pages: input.approved_pages,
        allowed_theme_keys: DESK_THEMES,
        minimum_confidence: 0.82,
        production_or_provider_actions_forbidden: true,
        legal_financial_medical_guarantees_forbidden: true,
      },
    },
  };
}

export function deskTaskText(request: DeskRequest) {
  return [
    "NXQX AI DESK TASK: build-plan v1",
    "",
    "Do this task and reply with ONLY the JSON answer (no explanation, no code fence).",
    "",
    "RULES",
    ...DESK_RULES.map((rule) => `- ${rule}`),
    `- Confidence must be ${request.contract.minimum_confidence} or higher only when the entire strategy is grounded and complete.`,
    `- Allowed themes: ${request.contract.allowed_theme_keys.join(", ")}.`,
    "",
    "ANSWER SHAPE (top-level keys exactly: confidence, request_fingerprint, risk_flags, schema_version, strategy)",
    DESK_ANSWER_SHAPE,
    "",
    "REQUEST_JSON_START",
    JSON.stringify(request, null, 2),
    "REQUEST_JSON_END",
  ].join("\n");
}

// Sent back to the AI Desk chat when its answer failed the checks.
export function fixRequestText(problems: string[]) {
  return [
    "NXQX AI DESK FIX REQUEST",
    "",
    "Your last answer failed NXQX's checks. Fix exactly these problems, keep everything else, and reply with ONLY the corrected JSON (same request_fingerprint, no explanation, no code fence):",
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n");
}

// The setup report lives in the client's notes; anything after a "more info request" marker is not part of it (same rule as the worker).
export function setupFieldsFromNotes(notes: string | null | undefined, parse: (report: string) => SetupField[]) {
  const text = typeof notes === "string" ? notes : "";
  if (!text.includes("NXQ WEB WEBSITE SETUP REPORT")) return [];
  return parse(text.split("NXQ MORE INFO REQUEST")[0] || text);
}
