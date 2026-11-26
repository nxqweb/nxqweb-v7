// Referral links look like /portal/signup?ref=NXQ1A2B3C4D5. The code is remembered through signup (stored on the new account itself, so it still
// works when the confirmation email is opened on another device) and applied automatically once after the new client first signs in.
// The database decides whether a code is valid, whether the program is open and whether the person already has a referral; this file only
// reads and tidies the code, and decides whether a failed attempt should be retried later or is finished for good.
const codePattern = /^[A-Z0-9]{8,20}$/;

export function normalizeReferralCode(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return codePattern.test(text) ? text : "";
}

export function referralCodeFromSearch(search: string): string {
  try { return normalizeReferralCode(new URLSearchParams(search).get("ref")); } catch { return ""; }
}

export function referralCodeFromUser(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): string {
  return normalizeReferralCode(user?.user_metadata?.referral_code);
}

export const pendingReferralKey = "nxq-pending-referral-v1";
export const pendingReferralAtKey = "nxq-pending-referral-at-v1";
export const claimedReferralKey = (userId: string) => `nxq-referral-done-v1-${userId}`;

// A code remembered in the browser (not in the account) is only trusted for a short time and only for a new account, so a link opened on a shared
// computer weeks ago can never be applied to whoever signs in next. A code stored in the account's own data has no such limit.
export const pendingReferralMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
export const newAccountMaxAgeMs = 14 * 24 * 60 * 60 * 1000;

export function isFreshStamp(stamp: unknown, nowMs: number, maxAgeMs = pendingReferralMaxAgeMs): boolean {
  const at = Number(stamp);
  return Number.isFinite(at) && at > 0 && nowMs - at >= -60_000 && nowMs - at <= maxAgeMs;
}
export function isNewAccount(createdAt: unknown, nowMs: number): boolean {
  const at = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  return Number.isFinite(at) && nowMs - at >= -60_000 && nowMs - at <= newAccountMaxAgeMs;
}

export function savePendingReferral(code: string): void {
  const clean = normalizeReferralCode(code);
  if (!clean) return;
  try {
    window.localStorage.setItem(pendingReferralKey, clean);
    window.localStorage.setItem(pendingReferralAtKey, String(Date.now()));
  } catch { /* private browsing: the code still travels in the account data */ }
}
export function readPendingReferral(nowMs: number = Date.now()): string {
  try {
    if (!isFreshStamp(window.localStorage.getItem(pendingReferralAtKey), nowMs)) return "";
    return normalizeReferralCode(window.localStorage.getItem(pendingReferralKey));
  } catch { return ""; }
}
export function clearPendingReferral(): void {
  try { window.localStorage.removeItem(pendingReferralKey); window.localStorage.removeItem(pendingReferralAtKey); } catch { /* nothing to clear */ }
}

// What a failed claim means. "retry" keeps the code for the next visit (the program may simply not be open yet, or the network failed);
// "done" means asking again can never work, so the code is dropped and nobody is nagged.
const finalReasons = [
  /^Referral code not found\.$/i,
  /^Self-referrals are not allowed\.$/i,
  /^QA-only clients cannot participate in referrals\.$/i,
  /^This client already has a referral attribution\.$/i,
  /^Referral attribution must be completed before the first verified payment\.?$/i,
];
export function claimOutcome(message: string | null | undefined): "retry" | "done" {
  const text = String(message ?? "").trim();
  return finalReasons.some((pattern) => pattern.test(text)) ? "done" : "retry";
}
