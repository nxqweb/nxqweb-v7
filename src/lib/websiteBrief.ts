// The "Request your website" brief for NXQX-Business: the pieces that are pure logic (so they can be tested without a browser).
// Fill-out-once rules: whatever the client typed at signup is reused, what they type in the brief is kept as a draft on this device
// until it is submitted, and the website look options are written into the same signed setup report the owner already reviews.

export type ColourMode = "recommend" | "dark" | "light" | "both";

export const colourModeOptions: { value: ColourMode; label: string; hint: string }[] = [
  { value: "recommend", label: "NXQX recommends", hint: "We pick what suits your business (a dark look today)." },
  { value: "dark", label: "Dark", hint: "A dark look." },
  { value: "light", label: "Light", hint: "A light look." },
  { value: "both", label: "Both (visitors can switch)", hint: "Visitors get a button to switch between light and dark." },
];

const colourModeValues = colourModeOptions.map((option) => option.value);

export function normalizeColourMode(value: unknown): ColourMode {
  return typeof value === "string" && (colourModeValues as string[]).includes(value) ? (value as ColourMode) : "recommend";
}

export function colourModeLabel(value: unknown) {
  const mode = normalizeColourMode(value);
  return colourModeOptions.find((option) => option.value === mode)?.label ?? "NXQX recommends";
}

// Reads a saved report value (for example "Both (visitors can switch)") back into the option.
export function colourModeFromLabel(label: unknown): ColourMode {
  const text = typeof label === "string" ? label.trim().toLowerCase() : "";
  return colourModeOptions.find((option) => option.label.toLowerCase() === text)?.value ?? "recommend";
}

export type BriefOptions = { colourMode: ColourMode; seo: boolean; smoothScroll: boolean };

export const defaultBriefOptions: BriefOptions = { colourMode: "recommend", seo: true, smoothScroll: true };

// One line each, "Label: value", so the owner screen and the build-plan worker already know how to read them.
export function briefOptionLines(options: BriefOptions) {
  return [
    `Website colour mode: ${colourModeLabel(options.colourMode)}`,
    `Search-engine setup (SEO): ${options.seo ? "Yes" : "No"}`,
    `Smooth scrolling: ${options.smoothScroll ? "Yes" : "No"}`,
  ];
}

export function briefOptionsFromReport(read: (label: string) => string): BriefOptions {
  const seo = read("Search-engine setup (SEO)").trim().toLowerCase();
  const smooth = read("Smooth scrolling").trim().toLowerCase();
  return {
    colourMode: colourModeFromLabel(read("Website colour mode")),
    seo: seo ? seo !== "no" : defaultBriefOptions.seo,
    smoothScroll: smooth ? smooth !== "no" : defaultBriefOptions.smoothScroll,
  };
}

// What the client typed at signup, reused in the brief instead of being asked a second time.
export type SignupAnswers = { bestCustomers: string; mainAction: string; proof: string; goal: string; firstPriority: string };

function clip(value: unknown, max = 600) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function signupAnswersFromMetadata(metadata: unknown): SignupAnswers {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const answers = meta.intake_family_answers && typeof meta.intake_family_answers === "object" && !Array.isArray(meta.intake_family_answers)
    ? (meta.intake_family_answers as Record<string, unknown>)
    : {};
  return {
    bestCustomers: clip(answers.best_customers),
    mainAction: clip(answers.conversion_action),
    proof: clip(answers.proof_assets),
    goal: clip(meta.intake_primary_goal),
    firstPriority: clip(meta.intake_tier_goal),
  };
}

export function hasSignupAnswers(answers: SignupAnswers) {
  return Object.values(answers).some(Boolean);
}

// "Label: value" lines for the report; empty answers are left out (never "Not provided" noise for something they were never asked).
export function signupAnswerLines(answers: SignupAnswers) {
  const rows: [string, string][] = [
    ["Best customers", answers.bestCustomers],
    ["Main visitor action", answers.mainAction],
    ["Proof to build around", answers.proof],
    ["Primary website goal", answers.goal],
    ["First-version priority", answers.firstPriority],
  ];
  return rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
}

// Payment is confirmed by NXQX by hand for now (Stripe is not switched on): the billing flag the owner sets.
export function paymentConfirmed(billingStatus: unknown) {
  return typeof billingStatus === "string" && ["active", "past_due"].includes(billingStatus.trim().toLowerCase());
}

// ---- Draft kept on this device so a long brief is never lost (signature and agreement are never stored) ----
export const DRAFT_TEXT_KEYS = [
  "companyScale", "locationType", "locations", "businessPhone", "businessEmail", "businessAddress", "businessHours", "emergencyAvailability",
  "industry", "services", "pagesNeeded", "styleDirection", "brandNotes", "competitors", "preferredContactMethod", "urgentLeadRules",
  "rejectedJobs", "areasNotServed", "aiCanAnswer", "aiNeverPromise", "escalationRules",
] as const;
export type DraftTextKey = (typeof DRAFT_TEXT_KEYS)[number];
export type BriefDraft = Partial<Record<DraftTextKey, string>> & { colourMode?: ColourMode; seo?: boolean; smoothScroll?: boolean };

const DRAFT_TEXT_MAX = 5000;

export function draftStorageKey(clientId: string) {
  return `nxq-brief-draft-v1:${clientId}`;
}

export function serializeDraft(draft: BriefDraft) {
  return JSON.stringify(parseDraft(JSON.stringify(draft)));
}

// Only known keys, only the right types, capped length. Anything else in storage is ignored.
export function parseDraft(raw: unknown): BriefDraft {
  let value: unknown;
  try { value = typeof raw === "string" ? JSON.parse(raw) : null; } catch { return {}; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const draft: BriefDraft = {};
  for (const key of DRAFT_TEXT_KEYS) {
    const item = source[key];
    if (typeof item === "string" && item.length > 0) draft[key] = item.slice(0, DRAFT_TEXT_MAX);
  }
  if (typeof source.colourMode === "string") draft.colourMode = normalizeColourMode(source.colourMode);
  if (typeof source.seo === "boolean") draft.seo = source.seo;
  if (typeof source.smoothScroll === "boolean") draft.smoothScroll = source.smoothScroll;
  return draft;
}

export function loadDraft(clientId: string): BriefDraft {
  try { return parseDraft(window.localStorage.getItem(draftStorageKey(clientId))); } catch { return {}; }
}

export function saveDraft(clientId: string, draft: BriefDraft) {
  try {
    const serialized = serializeDraft(draft);
    if (serialized === "{}") window.localStorage.removeItem(draftStorageKey(clientId));
    else window.localStorage.setItem(draftStorageKey(clientId), serialized);
  } catch { /* private window or blocked storage: the brief still works, it just is not kept */ }
}

export function clearDraft(clientId: string) {
  try { window.localStorage.removeItem(draftStorageKey(clientId)); } catch { /* ignore */ }
}

// ---- "Redesign my website" (after the first build): becomes a design change request with everything in the description ----
export type RedesignInput = { whatToChange: string; styleDirection: string; pagesNeeded: string; options: BriefOptions; extra: string };

export function redesignDescription(input: RedesignInput) {
  const part = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}` : "");
  return [
    part("What to change", input.whatToChange),
    part("New style direction", input.styleDirection),
    part("Pages or sections wanted", input.pagesNeeded),
    ...briefOptionLines(input.options),
    part("Anything else", input.extra),
  ].filter(Boolean).join("\n").slice(0, 6000);
}

export function redesignProblem(input: RedesignInput) {
  if (input.whatToChange.trim().length < 5) return "Tell us what you would like to change.";
  return "";
}
