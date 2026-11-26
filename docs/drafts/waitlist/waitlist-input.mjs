// Pre-launch waitlist: the pure rules and the whole request handler. DRAFT (docs/drafts/waitlist/); the final home is supabase/functions/_shared/waitlist-input.mjs.
// Pure logic: every outside thing (settings, hashing, the rate limiter, the database write) is passed in as `deps`, so this runs the same in the Edge function and in
// the Node tests. See docs/drafts/waitlist/README.md and docs/LAUNCH_PLAN_JUNE16.md.
//
// Rules this file enforces (each one has a planted-bug test in test-waitlist.mjs):
//  * OFF by default. Unless NXQ_WAITLIST_ENABLED is exactly "true" AND the caller's origin is one of NXQ_WAITLIST_ALLOWED_ORIGINS, every caller gets the same 404, before
//    the body is even read, so nothing reveals whether the list exists or what origin it expects.
//  * The same answer for a new address and one already listed (no probing for who signed up).
//  * A hidden "company_website" field is a bot trap: it looks like success and does no database work.
//  * Rate limits first (per visitor, then for the whole list), then the write. Limits are in WAITLIST_LIMITS and mirrored in docs/drafts/waitlist/README.md.
//  * Collect the minimum: an email address, a short source tag (which creator link they came from) and the consent wording version. Nothing else, no free text.
export const WAITLIST_LIMITS = Object.freeze({
  maxRequestBytes: 2048,
  emailMax: 254,
  sourceMax: 60,
  hourlyPerVisitor: 5,
  hourlyTotal: 1000,
  removePerVisitor: 10,
  windowSeconds: 3600,
});

// Bump the version whenever the consent sentence changes, so each row records exactly which wording the person saw.
// DRAFT wording: not legal advice, needs a lawyer's read before the list goes public (the owner has parked the legal review).
export const WAITLIST_CONSENT_VERSION = "draft-1";
export const WAITLIST_CONSENT_TEXT = "I agree that NXQX Web may email me when it is time to set up my site. I can ask to be removed at any time.";
export const WAITLIST_OK_MESSAGE = "Thanks! You are on the waiting list. We will email you when it is time to set up your site.";
// True whether or not the link matched anyone, so the answer never reveals who was on the list.
export const WAITLIST_REMOVED_MESSAGE = "Done. You are no longer on the waiting list, and we will not email you about it.";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

// Same rule as the database check on nxq_waitlist_signups.email (docs/drafts/migrations/03_prelaunch_waitlist.sql).
export function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.length < 5 || value.length > WAITLIST_LIMITS.emailMax) return null;
  if (CONTROL_CHARACTERS.test(value) || !EMAIL_PATTERN.test(value)) return null;
  return value;
}

// A creator link looks like /waitlist?ref=creator_name. Anything that is not a short plain tag falls back to "direct".
export function normalizeSource(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return value.length >= 1 && value.length <= WAITLIST_LIMITS.sourceMax && /^[a-z0-9_-]+$/.test(value) ? value : "direct";
}

// The removal token in an email link is a plain UUID. Anything else is refused before any database work.
export function normalizeToken(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : null;
}

export function parseWaitlistBody(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return { kind: "bad_json" }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "bad_json" };
  if (typeof data.company_website === "string" && data.company_website.trim()) return { kind: "bot" };
  if (data.action === "remove") {
    const token = normalizeToken(data.token);
    return token ? { kind: "remove", token } : { kind: "bad_token" };
  }
  const email = normalizeEmail(data.email);
  if (!email) return { kind: "bad_email" };
  return { kind: "ok", email, source: normalizeSource(data.source) };
}

const UNAVAILABLE = { ok: false, error: "Unavailable." };

// input: { method, origin, ip, agent, readBody() }  (readBody returns the text, or null when it is over WAITLIST_LIMITS.maxRequestBytes)
// deps:  { env(name), sha256(text), reserve({ scope, operation, identity, limit }) -> { allowed }, join({ email, source, consentVersion }), remove({ token }) }
// Returns { status, body }; body is null for a bare 204. Never throws: any failure after the cheap checks becomes one generic 500.
export async function handleWaitlist(input, deps) {
  if (deps.env("NXQ_WAITLIST_ENABLED") !== "true") return { status: 404, body: UNAVAILABLE };
  const allowedOrigins = String(deps.env("NXQ_WAITLIST_ALLOWED_ORIGINS") || "").split(",").map((o) => o.trim()).filter((o) => /^https:\/\/[^\s/]+$/.test(o));
  if (!allowedOrigins.length || !allowedOrigins.includes(input.origin)) return { status: 404, body: UNAVAILABLE };
  if (input.method === "OPTIONS") return { status: 204, body: null };
  if (input.method !== "POST") return { status: 405, body: { ok: false, error: "Method not allowed." } };

  let bodyText;
  try { bodyText = await input.readBody(); } catch { return { status: 400, body: { ok: false, error: "Request body could not be read." } }; }
  if (bodyText === null) return { status: 413, body: { ok: false, error: "Request body is too large." } };
  const parsed = parseWaitlistBody(bodyText);
  if (parsed.kind === "bad_json") return { status: 400, body: { ok: false, error: "Request body must be a JSON object." } };
  if (parsed.kind === "bot") return { status: 200, body: { ok: true, message: WAITLIST_OK_MESSAGE } };
  if (parsed.kind === "bad_email") return { status: 400, body: { ok: false, error: "Please enter a valid email address." } };
  if (parsed.kind === "bad_token") return { status: 400, body: { ok: false, error: "That removal link is not valid." } };

  try {
    const salt = deps.env("NXQ_LEAD_FINGERPRINT_SALT");
    if (!salt) throw new Error("fingerprint salt missing");
    const visitor = await deps.sha256(`${salt}|${input.ip || ""}|${input.agent || ""}`);
    const limited = { status: 429, body: { ok: false, error: "Too many sign-ups right now. Please try again later." } };
    // Removal: its own per-visitor limit, one write, and one answer whether or not the token matched anyone (the SQL function does the same).
    if (parsed.kind === "remove") {
      const removals = await deps.reserve({ scope: "waitlist", operation: "waitlist_remove_visitor_hourly", identity: visitor, limit: WAITLIST_LIMITS.removePerVisitor });
      if (!removals.allowed) return limited;
      await deps.remove({ token: parsed.token });
      return { status: 200, body: { ok: true, message: WAITLIST_REMOVED_MESSAGE } };
    }
    // The per-visitor limit first, so one visitor cannot use up the whole list's hourly total for everyone else.
    const perVisitor = await deps.reserve({ scope: "waitlist", operation: "waitlist_visitor_hourly", identity: visitor, limit: WAITLIST_LIMITS.hourlyPerVisitor });
    if (!perVisitor.allowed) return limited;
    const total = await deps.reserve({ scope: "waitlist", operation: "waitlist_total_hourly", identity: await deps.sha256("waitlist"), limit: WAITLIST_LIMITS.hourlyTotal });
    if (!total.allowed) return limited;
    await deps.join({ email: parsed.email, source: parsed.source, consentVersion: WAITLIST_CONSENT_VERSION });
    return { status: 200, body: { ok: true, message: WAITLIST_OK_MESSAGE } };
  } catch {
    return { status: 500, body: { ok: false, error: "The waiting list is unavailable right now." } };
  }
}
