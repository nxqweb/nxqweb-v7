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
export const claimedReferralKey = (userId: string) => `nxq-referral-done-v1-${userId}`;

export function savePendingReferral(code: string): void {
  const clean = normalizeReferralCode(code);
  if (!clean) return;
  try { window.localStorage.setItem(pendingReferralKey, clean); } catch { /* private browsing: the code still travels in the account data */ }
}
export function readPendingReferral(): string {
  try { return normalizeReferralCode(window.localStorage.getItem(pendingReferralKey)); } catch { return ""; }
}
export function clearPendingReferral(): void {
  try { window.localStorage.removeItem(pendingReferralKey); } catch { /* nothing to clear */ }
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
