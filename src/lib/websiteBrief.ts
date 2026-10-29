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

// Color theme and background: two easy taps instead of a blank box. They sit beside the light/dark choice and are written into the same report.
export type ColourTheme = "recommend" | "classic_navy" | "warm_earth" | "fresh_green" | "bold_red" | "soft_pastel" | "ocean_blue";
export const colourThemeOptions: { value: ColourTheme; label: string; swatches: string[] }[] = [
  { value: "recommend", label: "NXQX picks for me", swatches: [] },
  { value: "classic_navy", label: "Classic navy and gold", swatches: ["#1d2f4f", "#c9a24a", "#fdf9f6"] },
  { value: "warm_earth", label: "Warm earth", swatches: ["#8a5a3c", "#d9b99b", "#faf6ef"] },
  { value: "fresh_green", label: "Fresh green", swatches: ["#2f6f4f", "#9bd3a8", "#f4faf5"] },
  { value: "bold_red", label: "Bold black and red", swatches: ["#111111", "#c4122f", "#ffffff"] },
  { value: "soft_pastel", label: "Soft pastel", swatches: ["#f4b6c2", "#b8d8e8", "#fffaf5"] },
  { value: "ocean_blue", label: "Ocean blue", swatches: ["#0b4f8a", "#6bb7e0", "#f3f9fd"] },
];
export type BackgroundStyle = "recommend" | "clean_white" | "soft_cream" | "dark" | "gradient" | "photo";
export const backgroundOptions: { value: BackgroundStyle; label: string; hint: string }[] = [
  { value: "recommend", label: "NXQX picks for me", hint: "We choose what suits your business." },
  { value: "clean_white", label: "Clean white", hint: "Bright and simple." },
  { value: "soft_cream", label: "Soft cream", hint: "Warm and gentle." },
  { value: "dark", label: "Dark", hint: "Rich and bold." },
  { value: "gradient", label: "Soft gradient", hint: "A smooth blend of your colors." },
  { value: "photo", label: "A photo background", hint: "Add the photo in the photos box below." },
];
const themeValues = colourThemeOptions.map((o) => o.value as string);
const backgroundValues = backgroundOptions.map((o) => o.value as string);
export function normalizeColourTheme(value: unknown): ColourTheme { return typeof value === "string" && themeValues.includes(value) ? (value as ColourTheme) : "recommend"; }
export function normalizeBackground(value: unknown): BackgroundStyle { return typeof value === "string" && backgroundValues.includes(value) ? (value as BackgroundStyle) : "recommend"; }
const themeLabel = (v: unknown) => colourThemeOptions.find((o) => o.value === normalizeColourTheme(v))?.label ?? "NXQX picks for me";
const backgroundLabel = (v: unknown) => backgroundOptions.find((o) => o.value === normalizeBackground(v))?.label ?? "NXQX picks for me";
const themeFromLabel = (label: unknown): ColourTheme => colourThemeOptions.find((o) => o.label.toLowerCase() === String(label ?? "").trim().toLowerCase())?.value ?? "recommend";
const backgroundFromLabel = (label: unknown): BackgroundStyle => backgroundOptions.find((o) => o.label.toLowerCase() === String(label ?? "").trim().toLowerCase())?.value ?? "recommend";
export const COLOUR_NOTES_MAX = 160;
export function cleanColourNotes(value: unknown) { return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, COLOUR_NOTES_MAX); }

export type BriefOptions = { colourMode: ColourMode; seo: boolean; smoothScroll: boolean; colourTheme: ColourTheme; background: BackgroundStyle; colourNotes: string };

export const defaultBriefOptions: BriefOptions = { colourMode: "recommend", seo: true, smoothScroll: true, colourTheme: "recommend", background: "recommend", colourNotes: "" };

// One line each, "Label: value", so the owner screen and the build-plan worker already know how to read them.
export function briefOptionLines(options: BriefOptions) {
  const notes = cleanColourNotes(options.colourNotes);
  return [
    `Website colour mode: ${colourModeLabel(options.colourMode)}`,
    ...(options.colourTheme && options.colourTheme !== "recommend" ? [`Website colour theme: ${themeLabel(options.colourTheme)}`] : []),
    ...(notes ? [`Own colours: ${safeReportText(notes)}`] : []),
    ...(options.background && options.background !== "recommend" ? [`Website background: ${backgroundLabel(options.background)}`] : []),
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
    colourTheme: themeFromLabel(read("Website colour theme")),
    background: backgroundFromLabel(read("Website background")),
    colourNotes: cleanColourNotes(read("Own colours")),
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
export type BriefDraft = Partial<Record<DraftTextKey, string>> & { colourMode?: ColourMode; seo?: boolean; smoothScroll?: boolean; colourTheme?: ColourTheme; background?: BackgroundStyle; colourNotes?: string };

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
  if (typeof source.colourTheme === "string") draft.colourTheme = normalizeColourTheme(source.colourTheme);
  if (typeof source.background === "string") draft.background = normalizeBackground(source.background);
  if (typeof source.colourNotes === "string" && source.colourNotes) draft.colourNotes = cleanColourNotes(source.colourNotes);
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
  const part = (label: string, value: string, max: number) => (value.trim() ? `${label}: ${safeReportText(value.trim()).slice(0, max)}` : "");
  const changed = input.options.colourMode !== defaultBriefOptions.colourMode || input.options.seo !== defaultBriefOptions.seo || input.options.smoothScroll !== defaultBriefOptions.smoothScroll || (input.options.colourTheme ?? "recommend") !== defaultBriefOptions.colourTheme || (input.options.background ?? "recommend") !== defaultBriefOptions.background || cleanColourNotes(input.options.colourNotes) !== "";
  // Look options are only listed when the client actually changed them: "NXQX recommends / SEO yes / smooth yes" is just the default, not a request.
  return [
    part("What to change", input.whatToChange, 1500),
    part("New style direction", input.styleDirection, 1200),
    part("Pages or sections wanted", input.pagesNeeded, 800),
    ...(changed ? briefOptionLines(input.options) : []),
    part("Anything else", input.extra, 1000),
  ].filter(Boolean).join("\n").slice(0, 6000);
}

export function redesignProblem(input: RedesignInput) {
  if (input.whatToChange.trim().length < 5) return "Tell us what you would like to change.";
  return "";
}

// ---- Free text inside the signed setup report ----
// The report is plain "Label: value" lines, read later by the build-plan worker and the owner screen. A client's own text must never be able to look like one of OUR
// lines: a line "Industry: Casino" inside "Services" would override the real Industry for the worker, "Website colour mode: Light" would override a real choice, and the
// words "NXQ MORE INFO REQUEST" would make every reader cut the report off at that point. So reserved labels at the start of a line get a "- " in front (the text stays
// readable, it just stops being a field), and the report markers are removed.
export const RESERVED_REPORT_LABELS = [
  "Client", "Selected package", "Package badge", "Selected package capabilities", "Package AI/service rules", "Company scale", "Location setup", "Locations",
  "Business phone", "Business email", "Business address", "Business hours", "Emergency / after-hours availability", "Industry", "Services / products",
  "Pages / sections needed", "Style direction", "Brand difference / positioning", "Competitors / examples", "Lead handling rules", "Preferred contact method",
  "Urgent lead rules", "Jobs / customers to reject", "Areas not served", "Website assistant rules", "Assistant can answer", "Assistant should never promise",
  "Escalation rules", "Agreement accepted", "Typed signature", "Signature date", "Payment note", "Agreement evidence", "Targeted more info response", "Requested field",
  "Requested info", "Client answer", "Response date", "Website colour mode", "Website colour theme", "Own colours", "Website background", "Search-engine setup (SEO)", "Smooth scrolling", "Best customers", "Main visitor action",
  "Proof to build around", "Primary website goal", "First-version priority",
];

const reservedLine = new RegExp(`^\\s*(?:${RESERVED_REPORT_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})\\s*:`, "i");
const reportMarkers = /NXQ\s+(?:WEB\s+WEBSITE\s+SETUP\s+REPORT|TARGETED\s+MORE\s+INFO\s+REQUEST|MORE\s+INFO\s+REQUEST)/gi;

export function safeReportText(value: string) {
  return String(value ?? "")
    .replace(reportMarkers, "")
    .split("\n")
    .map((line) => (reservedLine.test(line) ? `- ${line.trim()}` : line))
    .join("\n");
}

// The whole report must fit the server's 30000-character limit; leave room for the fixed lines.
export const REPORT_SOFT_LIMIT = 29000;
