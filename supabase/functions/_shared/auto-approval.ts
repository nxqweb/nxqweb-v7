// Rule-based client auto-approval for NXQX. NO AI and no free text are involved in the decision.
// Pure functions only: no network, no database, no environment reads. Nothing calls this yet.
// The owner's APPROVE/DENY decision stays the authority until the owner explicitly turns this on;
// the safe rollout is "shadow" mode (the engine records what it would decide while the owner still
// decides) and a measured comparison before "live". Putting it into the signup path needs a
// migration and a guarded deploy, both stop-and-ask gates.

export type BillingState = "none" | "active" | "past_due" | "unknown";

export type ApprovalFacts = {
  product_family: string;
  tier_key: string;
  monthly_price_cents: number;
  email_verified: boolean;
  challenge_passed: boolean; // bot check
  intake_complete: boolean;
  business_category: string; // an allowlisted key, never free text
  country: string; // ISO 3166-1 alpha-2, lower-case
  duplicate_signup_count: number; // other signups with the same email, phone or domain
  signups_from_fingerprint_24h: number;
  billing_state: BillingState;
  is_qa_client: boolean;
  on_blocklist: boolean;
};

export type ApprovalPolicy = {
  mode: "off" | "shadow" | "live";
  allowed_families: string[];
  allowed_tiers: string[];
  allowed_categories: string[];
  allowed_countries: string[];
  max_price_cents: number;
  max_auto_approvals_per_day: number;
  auto_approved_today: number;
  max_fingerprint_signups_24h: number;
  require_active_billing: boolean;
};

export type Decision = "auto_approve" | "queue_for_owner" | "auto_block";

export type ApprovalResult = {
  mode: ApprovalPolicy["mode"];
  engine_decision: Decision; // what the rules concluded
  effective_decision: Decision; // what actually happens (shadow mode never acts)
  reasons: string[];
};

// A safe key: lower-case letters, digits, underscore or hyphen, at most 40 characters. Anything else
// (spaces, sentences, instructions, markup) becomes "unknown", which can never be on an allowlist.
const SAFE_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BILLING: BillingState[] = ["none", "active", "past_due", "unknown"];

function key(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SAFE_KEY.test(text) ? text : "unknown";
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

// Copies only the known keys, type-checks them, and reports anything malformed. Unknown extra
// properties (for example a stray free-text "notes" field) are dropped and never read.
export function normalizeFacts(raw: unknown): { facts: ApprovalFacts | null; problems: string[] } {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const problems: string[] = [];
  const bool = (name: string) => { if (typeof input[name] !== "boolean") problems.push(`not_boolean:${name}`); return input[name] === true; };
  const price = count(input.monthly_price_cents);
  const duplicates = count(input.duplicate_signup_count);
  const fingerprint = count(input.signups_from_fingerprint_24h);
  if (price === null) problems.push("bad_number:monthly_price_cents");
  if (duplicates === null) problems.push("bad_number:duplicate_signup_count");
  if (fingerprint === null) problems.push("bad_number:signups_from_fingerprint_24h");
  const billing = BILLING.includes(input.billing_state as BillingState) ? input.billing_state as BillingState : "unknown";
  const facts: ApprovalFacts = {
    product_family: key(input.product_family),
    tier_key: key(input.tier_key),
    monthly_price_cents: price ?? 0,
    email_verified: bool("email_verified"),
    challenge_passed: bool("challenge_passed"),
    intake_complete: bool("intake_complete"),
    business_category: key(input.business_category),
    country: key(input.country),
    duplicate_signup_count: duplicates ?? 0,
    signups_from_fingerprint_24h: fingerprint ?? 0,
    billing_state: billing,
    is_qa_client: bool("is_qa_client"),
    on_blocklist: bool("on_blocklist"),
  };
  return { facts: problems.length ? null : facts, problems };
}

export function decideApproval(rawFacts: unknown, policy: ApprovalPolicy): ApprovalResult {
  const finish = (engine: Decision, reasons: string[]): ApprovalResult => ({
    mode: policy.mode,
    engine_decision: engine,
    // Shadow mode never acts: the owner still decides. "off" always queues.
    effective_decision: policy.mode === "live" ? engine : "queue_for_owner",
    reasons,
  });
  if (policy.mode === "off") return finish("queue_for_owner", ["policy_off"]);

  const { facts, problems } = normalizeFacts(rawFacts);
  if (!facts) return finish("queue_for_owner", problems.map((p) => `invalid_facts:${p}`));
  if (facts.is_qa_client) return finish("queue_for_owner", ["qa_client_excluded"]);
  if (facts.on_blocklist) return finish("auto_block", ["blocklisted"]);

  const reasons: string[] = [];
  if (!policy.allowed_families.includes(facts.product_family)) reasons.push("family_not_allowed");
  if (!policy.allowed_tiers.includes(facts.tier_key)) reasons.push("tier_not_allowed");
  if (!policy.allowed_categories.includes(facts.business_category)) reasons.push("category_not_allowed");
  if (!policy.allowed_countries.includes(facts.country)) reasons.push("country_not_allowed");
  if (facts.monthly_price_cents > policy.max_price_cents) reasons.push("price_above_limit");
  if (!facts.email_verified) reasons.push("email_not_verified");
  if (!facts.challenge_passed) reasons.push("bot_check_not_passed");
  if (!facts.intake_complete) reasons.push("intake_incomplete");
  if (facts.duplicate_signup_count > 0) reasons.push("duplicate_signup");
  if (facts.signups_from_fingerprint_24h > policy.max_fingerprint_signups_24h) reasons.push("signup_velocity_high");
  if (policy.require_active_billing && facts.billing_state !== "active") reasons.push("billing_not_active");
  if (policy.auto_approved_today >= policy.max_auto_approvals_per_day) reasons.push("daily_auto_approval_cap_reached");
  return reasons.length ? finish("queue_for_owner", reasons) : finish("auto_approve", ["all_rules_met"]);
}

export type ShadowSample = { engine: Decision; owner: "approve" | "deny" };

// Decides whether shadow-mode evidence is good enough to consider going live. Conservative:
// enough samples, and the engine never approved something the owner denied.
export function shadowReadiness(samples: ShadowSample[], options: { minSamples?: number; maxFalseApprovals?: number } = {}) {
  const minSamples = options.minSamples ?? 20;
  const maxFalseApprovals = options.maxFalseApprovals ?? 0;
  const falseApprovals = samples.filter((s) => s.engine === "auto_approve" && s.owner === "deny").length;
  const wouldApprove = samples.filter((s) => s.engine === "auto_approve").length;
  const missedApprovals = samples.filter((s) => s.engine !== "auto_approve" && s.owner === "approve").length;
  const reasons: string[] = [];
  if (samples.length < minSamples) reasons.push(`need_${minSamples - samples.length}_more_samples`);
  if (falseApprovals > maxFalseApprovals) reasons.push(`false_approvals:${falseApprovals}`);
  return { ready: reasons.length === 0, samples: samples.length, wouldApprove, falseApprovals, missedApprovals, reasons };
}
