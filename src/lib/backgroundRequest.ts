// Helpers for the client's "make me a background" card (parked patch 12_background_request_button.patch; database draft 11).
// Pure text and number work only: nothing here calls the database, so it is safe to live in the app before the backend exists.
export const MOODS = [
  { value: "calm", label: "Calm and soft" },
  { value: "warm", label: "Warm and cozy" },
  { value: "fresh", label: "Fresh and light" },
  { value: "elegant", label: "Elegant" },
  { value: "playful", label: "Playful" },
] as const;
export type Mood = (typeof MOODS)[number]["value"];
export const WHAT_I_SELL_MAX = 60;

export type RequestForm = { mood: string; whatISell: string };
export type BackgroundStatus = { enabled: boolean; allowance: number; used: number; remaining: number; canRequest: boolean; reason: string; inProgress: boolean; latestStatus: string };

const whole = (v: unknown, min: number, max: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : 0);
const isMood = (v: unknown): v is Mood => MOODS.some((m) => m.value === v);

// What the database says about this client's own allowance. Anything missing or odd means "not available" (the card stays hidden).
export function parseBackgroundStatus(raw: unknown): BackgroundStatus {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    enabled: r.enabled === true, allowance: whole(r.allowance, 0, 50), used: whole(r.used, 0, 1000000), remaining: whole(r.remaining, 0, 50),
    canRequest: r.can_request === true, reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : "", inProgress: r.in_progress === true,
    latestStatus: typeof r.latest_status === "string" ? r.latest_status.slice(0, 30) : "",
  };
}

// The first problem in plain words, or "" when the request can be sent.
export function requestProblem(form: RequestForm): string {
  if (!isMood(form.mood)) return "Please choose a mood.";
  if (form.whatISell.trim().length > WHAT_I_SELL_MAX) return `Please keep "What do you sell?" to ${WHAT_I_SELL_MAX} characters or fewer.`;
  return "";
}

// The exact arguments of the database's request function, or null when the form has a problem. Odd characters are removed (the server cleans again).
export function requestPayload(form: RequestForm): { mood_value: Mood; what_i_sell_value: string | null } | null {
  if (requestProblem(form)) return null;
  const cleaned = form.whatISell.replace(/[^\p{L}\p{N} ,.'&-]/gu, " ").replace(/\s+/g, " ").trim();
  return { mood_value: form.mood as Mood, what_i_sell_value: cleaned.length >= 2 ? cleaned : null };
}

const lines: Record<string, string> = {
  requested: "Your background request is in the queue.",
  generating: "Your background is being made right now.",
  pending_approval: "Your background is made and waiting for NXQX to approve it. It goes live once approved.",
  approved: "Your last background was approved and is on your store.",
  rejected: "NXQX did not approve your last background. You can ask for another if you have tries left.",
  failed: "The last try did not work. You can try again if you have tries left.",
};
export const statusLine = (status: string): string => lines[status] ?? "";

// The reply of the request function, in plain words. The server's own sentence is shown only for its known refusals.
export function requestResultMessage(raw: unknown): { ok: boolean; message: string } {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (r.ok === true) return { ok: true, message: "Your request is in. It usually takes a few minutes, and NXQX checks it before it goes live." };
  const reason = typeof r.reason === "string" ? r.reason : "";
  const known = [/switched off/i, /monthly limit/i, /used its background pictures/i, /Please wait \d+ second/i, /already have a background/i, /Create your store first/i];
  return { ok: false, message: known.some((rx) => rx.test(reason)) ? reason.slice(0, 200) : "We could not send your request this time. Please try again later." };
}
