// Pre-launch waiting list: the rules the form and the owner screen share. DRAFT (docs/drafts/waitlist/); the final home is src/lib/waitlist.ts.
// Pure: no network and no React. The same wording and limits live in supabase/functions/_shared/waitlist-input.mjs; scripts/test-waitlist.mjs fails if they drift apart.
export const WAITLIST_CONSENT_VERSION = "draft-1";
// DRAFT wording: needs a lawyer's read before the list goes public.
export const WAITLIST_CONSENT_TEXT = "I agree that NXQX Web may email me when it is time to set up my site. I can ask to be removed at any time.";
export const WAITLIST_OK_MESSAGE = "Thanks! You are on the waiting list. We will email you when it is time to set up your site.";
export const WAITLIST_REMOVED_MESSAGE = "Done. You are no longer on the waiting list, and we will not email you about it.";
export const WAITLIST_EMAIL_MAX = 254;
export const WAITLIST_SOURCE_MAX = 60;
export const MAX_INVITES_PER_WAVE = 100;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A plain-words problem with what was typed, or null when it looks fine. The server checks again; this only saves a round trip.
export function emailProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Please enter your email address.";
  if (value.length > WAITLIST_EMAIL_MAX || !EMAIL_PATTERN.test(value)) return "That does not look like an email address.";
  return null;
}

// /waitlist?ref=creator_name records which creator's link brought someone. Anything that is not a short plain tag is "direct".
export function sourceFromSearch(search: string): string {
  const ref = new URLSearchParams(search).get("ref")?.trim().toLowerCase() ?? "";
  return ref.length >= 1 && ref.length <= WAITLIST_SOURCE_MAX && /^[a-z0-9_-]+$/.test(ref) ? ref : "direct";
}

// /waitlist/remove?token=... is the link in a waiting-list email. Only a plain UUID counts; anything else is "no link". (The token is never sent anywhere except the removal request.)
export function tokenFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("token")?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : null;
}

export type WaitlistJoinResult = { ok: true; message: string } | { ok: false; message: string };
export type WaitlistSummary = { byStatus: Record<string, number>; bySource: Record<string, number> };
export type WaitlistGateway = {
  join(input: { email: string; source: string; honeypot: string }): Promise<WaitlistJoinResult>;
  remove(token: string): Promise<WaitlistJoinResult>;
  summary(): Promise<WaitlistSummary>;
  inviteWave(wave: number, count: number): Promise<number>;
};

function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (value && typeof value === "object") for (const [key, n] of Object.entries(value as Record<string, unknown>)) if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[key] = n;
  return out;
}

// owner_waitlist_summary() returns { by_status: {...}, by_source: {...} } (counts only, never addresses).
export function summaryFromRpc(data: unknown): WaitlistSummary {
  const row = (data && typeof data === "object" ? data : {}) as { by_status?: unknown; by_source?: unknown };
  return { byStatus: counts(row.by_status), bySource: counts(row.by_source) };
}

export const waitlistStatusLabels: Record<string, string> = {
  pending: "Waiting to confirm",
  confirmed: "Confirmed, in line",
  invited: "Invited",
  joined: "Joined",
};

export function totalOnList(summary: WaitlistSummary): number {
  return Object.values(summary.byStatus).reduce((sum, n) => sum + n, 0);
}

// What the owner types for a wave. The database enforces the same limits (1 to 100 people per call, wave 1 or higher).
export function waveProblem(wave: number, count: number): string | null {
  if (!Number.isInteger(wave) || wave < 1) return "The wave number must be 1 or higher.";
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVITES_PER_WAVE) return `Invite between 1 and ${MAX_INVITES_PER_WAVE} people at a time.`;
  return null;
}

// The next wave number to suggest: one more than the highest wave already used (the summary has no wave numbers, so the owner keeps the count).
export function suggestedWave(lastWave: number | null): number {
  return lastWave && Number.isInteger(lastWave) && lastWave >= 1 ? lastWave + 1 : 1;
}

// A friendly answer for a failed sign-up. The status is the HTTP status the function returned (0 when the request never got an answer).
export function joinFailureMessage(status: number): string {
  if (status === 429) return "Too many sign-ups right now. Please try again in a little while.";
  if (status === 400 || status === 413) return "Please check your email address and try again.";
  return "The waiting list is not open right now. Please try again later.";
}
