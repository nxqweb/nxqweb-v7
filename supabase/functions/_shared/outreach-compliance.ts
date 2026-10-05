// Outreach compliance helpers for NXQ sales email.
// Pure functions only: no network, no database, no environment reads, no secrets.
// They add conservative checks on top of the database rules (channel permissions, suppression,
// sender identity, owner review). They reduce risk; they do not make outreach legally risk-free.

export type DraftCheck = { ok: boolean; reasons: string[] };

const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN_PATTERN = /\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|co|us|biz|info|app|dev|ai|me|site|online|store|shop|xyz)\b/i;
const MARKUP_PATTERN = /<\/?[a-z][^>]*>|\]\(|`|\*\*|^#{1,6}\s/m;
const GUARANTEE_PATTERN = /\bguarantee[sd]?\b|\bwarrant(y|ies)\b|\brisk[- ]free\b|\b100\s?%\b|\b#\s?1\b|\bnumber one\b|\btop[- ]ranked\b|\bfirst page of google\b/i;
const URGENCY_PATTERN = /\bact now\b|\blast chance\b|\blimited[- ]time\b|\burgent(ly)?\b|\bexpires? (today|soon|tonight)\b|\bonly \d+ (spots?|slots?|left)\b/i;
const FALSE_FAMILIARITY_PATTERN = /\bas we discussed\b|\bfollowing up on our (call|conversation|chat)\b|\bper our (call|conversation|chat)\b|\byou (asked|requested|contacted|reached out)\b/i;
const UNVERIFIABLE_CLAIM_PATTERN = /\baward[- ]winning\b|\bbest in (town|class|the (area|business))\b|\bvoted\b|\bcustomers love\b/i;
const SENSITIVE_PATTERN = /\b(ssn|social security|password|credit card|wire transfer|gift card|bitcoin|crypto(currency)?)\b/i;
const MODEL_LEAK_PATTERN = /\bas an ai\b|\blanguage model\b|\bsystem prompt\b|ignore (all |any )?(previous|prior|above) (instructions|messages)/i;

function stripAllowed(value: string, allowedLiterals: string[]) {
  let output = value;
  for (const literal of allowedLiterals) {
    const trimmed = literal.trim();
    if (trimmed) output = output.split(trimmed).join(" ");
  }
  return output;
}

// Validates an outreach email draft. `allowedLiterals` are strings (for example the prospect's
// business name) that may legitimately look like domains and are ignored by the link checks.
export function validateOutreachDraft(
  draft: { subject: string; body: string },
  options: { allowedLiterals?: string[] } = {},
): DraftCheck {
  const reasons: string[] = [];
  const subject = String(draft.subject ?? "").trim();
  const body = String(draft.body ?? "").trim();
  const allowed = options.allowedLiterals ?? [];
  const subjectScan = stripAllowed(subject, allowed);
  const bodyScan = stripAllowed(body, allowed);
  const combined = `${subjectScan}\n${bodyScan}`;

  if (subject.length < 3 || subject.length > 120) reasons.push("subject_length");
  if (body.length < 40 || body.length > 2000) reasons.push("body_length");
  if (URL_PATTERN.test(combined) || BARE_DOMAIN_PATTERN.test(combined)) reasons.push("contains_link_or_domain");
  if (MARKUP_PATTERN.test(subject) || MARKUP_PATTERN.test(body)) reasons.push("contains_markup");
  if (/^(re|fwd?):/i.test(subject)) reasons.push("deceptive_reply_subject");
  const letters = subject.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 8 && letters === letters.toUpperCase()) reasons.push("all_caps_subject");
  if ((combined.match(/!/g) || []).length > 1) reasons.push("too_many_exclamation_marks");
  if (GUARANTEE_PATTERN.test(combined)) reasons.push("guarantee_or_ranking_claim");
  if (URGENCY_PATTERN.test(combined)) reasons.push("false_urgency");
  if (FALSE_FAMILIARITY_PATTERN.test(combined)) reasons.push("claims_prior_relationship");
  if (UNVERIFIABLE_CLAIM_PATTERN.test(combined)) reasons.push("unverifiable_claim");
  if (SENSITIVE_PATTERN.test(combined)) reasons.push("sensitive_or_payment_terms");
  if (MODEL_LEAK_PATTERN.test(combined)) reasons.push("model_or_prompt_leak");
  return { ok: reasons.length === 0, reasons };
}

// Cleans one audit finding before it is placed in a prompt or draft. Findings come from the
// prospect's own website, which is untrusted input. Returns "" when nothing safe remains.
export function sanitizeAuditFinding(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/(https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|co|us|biz|info|app|dev|ai|me|site|online|store|shop|xyz)\b/gi, " ")
    .replace(/[`*#[\]{}|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (MODEL_LEAK_PATTERN.test(text) || /\b(ignore|disregard|override|forget)\b.{0,40}\b(instructions?|rules?|prompt)\b/i.test(text)) return "";
  if (SENSITIVE_PATTERN.test(text)) return "";
  text = text.slice(0, 200).replace(/[.!?:;,\s]+$/, "");
  return text.length >= 10 ? text : "";
}

export type ReplyIntent = "unsubscribe" | "complaint" | "auto_reply" | "other";

// Deterministic reply triage. Over-suppresses on purpose: a wrongly suppressed prospect costs
// little, a missed opt-out is a compliance failure. No AI is involved.
export function classifyReplyIntent(text: unknown): ReplyIntent {
  const value = String(text ?? "").toLowerCase().slice(0, 4000);
  if (/\b(spam|report(ed|ing)? you|attorney|lawyer|lawsuit|sue you|cease and desist|illegal|harass)/.test(value)) return "complaint";
  if (/\bunsubscrib|\bopt[- ]?out\b|\bremove (me|us|my)\b|\btake (me|us) off\b|\bstop (emailing|contacting|sending|messaging)\b|\bdo not (contact|email|call|message)\b|\bdon'?t (contact|email|message)\b|\bno more (emails?|messages?)\b|\bleave me alone\b|^\s*stop\s*[.!]?\s*$/m.test(value)) return "unsubscribe";
  if (/\bout of (the )?office\b|\bautomatic reply\b|\bauto[- ]?reply\b|\bautoreply\b|\bi am (currently )?away\b/.test(value)) return "auto_reply";
  return "other";
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

// First-release region rule: United States only. Consent-based regimes (EU, UK, Canada, others)
// are excluded until they have been reviewed.
export function isAllowedRegion(input: { country?: string | null; stateRegion?: string | null }): boolean {
  const country = String(input.country ?? "").trim().toUpperCase();
  if (country && country !== "US" && country !== "USA" && country !== "UNITED STATES") return false;
  const state = String(input.stateRegion ?? "").trim().toUpperCase();
  return US_STATE_CODES.has(state);
}

export type SendSettings = {
  automation_mode: string;
  emergency_stop: boolean;
  external_delivery_enabled: boolean;
  daily_email_limit: number;
  business_timezone: string;
  send_window_start: string; // "HH:MM" or "HH:MM:SS"
  send_window_end: string;
  sender_email?: string | null;
  postal_address?: string | null;
};

function minutesOfDay(value: string) {
  const [hours, minutes] = String(value).split(":");
  return Number(hours) * 60 + Number(minutes || 0);
}

function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

// Decides whether one approved email may be sent right now. Every reason is reported so the
// caller can log why a send was held. The database remains the authority on permissions.
export function evaluateSendEligibility(input: {
  settings: SendSettings;
  draft: { status: string; channel: string };
  permission: { status: string; basis: string; revoked_at?: string | null } | null;
  suppressed: boolean;
  doNotContact: boolean;
  sentToday: number;
  now: Date;
  region: { country?: string | null; stateRegion?: string | null };
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { settings, draft, permission } = input;
  if (settings.emergency_stop) reasons.push("emergency_stop_on");
  if (settings.automation_mode !== "guarded") reasons.push("automation_mode_not_guarded");
  if (!settings.external_delivery_enabled) reasons.push("external_delivery_disabled");
  if (draft.channel !== "email") reasons.push("channel_not_email");
  if (draft.status !== "approved") reasons.push("draft_not_approved");
  if (!permission || permission.status !== "allowed" || permission.basis === "none" || permission.revoked_at) reasons.push("no_active_permission");
  if (input.suppressed) reasons.push("suppressed");
  if (input.doNotContact) reasons.push("do_not_contact");
  if (!isAllowedRegion(input.region)) reasons.push("region_not_allowed");
  if (!settings.sender_email || !settings.postal_address) reasons.push("sender_identity_incomplete");
  const cap = Math.min(Math.max(Number(settings.daily_email_limit) || 0, 0), 50);
  if (input.sentToday >= cap) reasons.push("daily_cap_reached");
  try {
    const clock = localClock(input.now, settings.business_timezone);
    const weekday = !["Sat", "Sun"].includes(clock.weekday);
    if (!weekday || clock.minutes < minutesOfDay(settings.send_window_start) || clock.minutes >= minutesOfDay(settings.send_window_end)) {
      reasons.push("outside_send_window");
    }
  } catch {
    reasons.push("invalid_timezone");
  }
  return { allowed: reasons.length === 0, reasons };
}
