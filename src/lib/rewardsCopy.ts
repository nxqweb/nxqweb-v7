// Plain words for the client Rewards page. The database speaks in statuses and rule names; clients should read sentences. Nothing here touches the
// network. Fraud and risk details are deliberately never shown to clients.
export const referralStatusSentence = (status: string, holdUntil?: string | null): string => {
  switch (status) {
    case "pending_payment": return "Signed up. Waiting for their first payment.";
    case "holding": {
      const date = holdUntil ? new Date(holdUntil) : null;
      return date && !Number.isNaN(date.getTime()) ? `Paid. Your reward is on a short review and will be ready after ${date.toLocaleDateString()}.` : "Paid. Your reward is on a short review.";
    }
    case "qualified": return "Done. You earned your reward.";
    case "reversed": return "Reversed because the payment was refunded or disputed.";
    case "blocked": return "Not eligible. Contact us if you think this is a mistake.";
    default: return "In progress.";
  }
};

export const creditEntryLabel = (description: string, status: string): string => {
  if (status === "reversed") return `${description} (reversed)`;
  return description;
};

// Only sentences the database raises on purpose are shown; everything else becomes one calm line. Internal details never reach the client.
const safeMessages: Record<string, string> = {
  "The referral program is not open yet.": "Referrals are not open yet. Please check back soon.",
  "Referral code not found.": "That referral code was not found. Please check it and try again.",
  "Self-referrals are not allowed.": "You cannot use your own referral code.",
  "This client already has a referral attribution.": "A referral code is already applied to your account.",
  "Referral attribution must be completed before the first verified payment.": "A referral code can only be added before your first payment.",
  "QA-only clients cannot participate in referrals.": "This account cannot take part in referrals.",
  "Founding Grant applications are not open yet.": "Founding Grant applications are not open yet.",
  "This account is outside the founding cohort.": "This account is not part of the Founding Grant group.",
  "Please provide at least 30 characters.": "Please write at least 30 characters so we understand your business.",
};
export const genericRewardsError = "Something went wrong. Nothing was changed. Please try again in a moment.";
export function friendlyRewardsError(message: string | null | undefined): string {
  const text = String(message ?? "").trim();
  return Object.prototype.hasOwnProperty.call(safeMessages, text) ? safeMessages[text] : genericRewardsError;
}

export const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`;
export const wholeDollars = (value: unknown, fallback: number): string => `$${(Number(value) > 0 ? Number(value) : fallback).toFixed(0)}`;

export function shareText(link: string, businessHint = ""): string {
  const who = businessHint.trim() ? ` for ${businessHint.trim()}` : "";
  return `I use NXQX-Web${who}. Sign up with my link and you get a discount on your first invoice: ${link}`;
}

export function grantStatusSentence(status: string | undefined, position?: number): string {
  const labels: Record<string, string> = { draft: "Draft saved.", submitted: "Submitted. We will review it.", eligible: "Eligible. Waiting for the owner's decision.", selected: "Selected!", not_selected: "Not selected this time.", revoked: "No longer active." };
  const base = labels[String(status)] ?? "In progress.";
  return Number.isFinite(position) && Number(position) > 0 ? `${base} You are number ${position} in the group.` : base;
}
