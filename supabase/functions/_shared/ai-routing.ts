// AI model routing for NXQX: pick the cheapest adequate model for each task, keep premium models
// for premium plans, stay inside the per-client cost ceiling, and escalate at most once.
// Pure functions only: no network, no database, no environment reads, no secrets. Nothing calls
// this yet. The database stays the authority for spend (economic reservations and the minimum
// margin ceiling); this module only chooses a model and estimates cost before a reservation.
// Prices below are REFERENCE values (cached table dated 2026-09-25) and must be re-verified
// before they are used for pricing decisions. OpenAI entries are supplied by configuration
// because their model names and prices are not hard-coded here.

export type Tier = "none" | "light" | "standard" | "premium";
export type PlanTier = "starter" | "growth" | "intelligence" | "enterprise";
export type Protocol = "anthropic_messages" | "openai_responses" | "openai_chat_completions";

export type ModelEntry = {
  provider: string;
  protocol: Protocol;
  model: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
};

export type RouteConfig = Record<Exclude<Tier, "none">, ModelEntry[]>;

export const DEFAULT_CLAUDE_ROUTES: RouteConfig = {
  light: [{ provider: "anthropic", protocol: "anthropic_messages", model: "claude-haiku-4-5", inputPerMTokUsd: 1, outputPerMTokUsd: 5 }],
  standard: [{ provider: "anthropic", protocol: "anthropic_messages", model: "claude-sonnet-5-5", inputPerMTokUsd: 2, outputPerMTokUsd: 10 }],
  premium: [
    { provider: "anthropic", protocol: "anthropic_messages", model: "claude-fable-5-1", inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
    { provider: "anthropic", protocol: "anthropic_messages", model: "claude-opus-5-5", inputPerMTokUsd: 4, outputPerMTokUsd: 20 },
  ],
};

export type TaskKey =
  | "auto_approval"
  | "reply_intent_triage"
  | "abuse_triage"
  | "change_request_classification"
  | "audit_summary"
  | "outreach_draft"
  | "support_reply_draft"
  | "build_plan"
  | "premium_site_build";

type TaskSpec = {
  tier: Tier; // preferred tier
  minTier: Tier; // never route below this tier (quality floor)
  inputTokens: number; // planning estimate, not a measurement
  outputTokens: number;
  batchEligible: boolean; // non-urgent work that can use a half-price batch API
  minPlan?: PlanTier; // premium work is limited to these plans and above
};

export const TASKS: Record<TaskKey, TaskSpec> = {
  auto_approval: { tier: "none", minTier: "none", inputTokens: 0, outputTokens: 0, batchEligible: false },
  reply_intent_triage: { tier: "light", minTier: "light", inputTokens: 1_500, outputTokens: 200, batchEligible: false },
  abuse_triage: { tier: "light", minTier: "light", inputTokens: 1_500, outputTokens: 200, batchEligible: false },
  change_request_classification: { tier: "light", minTier: "light", inputTokens: 3_000, outputTokens: 500, batchEligible: false },
  audit_summary: { tier: "light", minTier: "light", inputTokens: 3_000, outputTokens: 500, batchEligible: true },
  outreach_draft: { tier: "standard", minTier: "standard", inputTokens: 2_500, outputTokens: 700, batchEligible: true },
  support_reply_draft: { tier: "standard", minTier: "standard", inputTokens: 3_000, outputTokens: 800, batchEligible: false },
  build_plan: { tier: "standard", minTier: "standard", inputTokens: 6_000, outputTokens: 5_000, batchEligible: false },
  premium_site_build: { tier: "premium", minTier: "standard", inputTokens: 40_000, outputTokens: 60_000, batchEligible: false, minPlan: "intelligence" },
};

const PLAN_RANK: Record<PlanTier, number> = { starter: 0, growth: 1, intelligence: 2, enterprise: 3 };
const TIER_ORDER: Exclude<Tier, "none">[] = ["premium", "standard", "light"]; // descending cost

export function estimateCostCents(model: ModelEntry, inputTokens: number, outputTokens: number, batch = false): number {
  const dollars = (inputTokens / 1_000_000) * model.inputPerMTokUsd + (outputTokens / 1_000_000) * model.outputPerMTokUsd;
  const cents = dollars * 100 * (batch ? 0.5 : 1);
  return Math.max(1, Math.ceil(cents - 1e-9));
}

// Hard monthly provider-cost ceiling in cents, mirroring the database rule: price x (100 - minimum margin)%.
export function hardCeilingCents(monthlyPriceCents: number, minimumMarginPercent = 85): number {
  return Math.floor((Math.max(monthlyPriceCents, 0) * (100 - minimumMarginPercent)) / 100);
}

export type RouteDecision =
  | { ok: true; tier: "none"; model: null; estimatedCostCents: 0; reasons: string[] }
  | { ok: true; tier: Exclude<Tier, "none">; model: ModelEntry; estimatedCostCents: number; batch: boolean; downgradedFrom: Tier | null; reasons: string[] }
  | { ok: false; reason: "budget_exhausted" | "no_healthy_provider" | "unknown_task"; reasons: string[] };

export function selectModel(options: {
  task: TaskKey;
  planTier: PlanTier;
  monthlyPriceCents: number;
  spentThisMonthCents: number;
  config?: RouteConfig;
  healthyProviders?: ReadonlySet<string>; // omit to treat every provider as healthy
  allowBatch?: boolean; // caller can actually use a batch API for this call
  minimumMarginPercent?: number;
}): RouteDecision {
  const spec = TASKS[options.task];
  if (!spec) return { ok: false, reason: "unknown_task", reasons: ["unknown_task"] };
  if (spec.tier === "none") return { ok: true, tier: "none", model: null, estimatedCostCents: 0, reasons: ["rule_only_no_ai"] };

  const config = options.config ?? DEFAULT_CLAUDE_ROUTES;
  const reasons: string[] = [];
  let desired: Exclude<Tier, "none"> = spec.tier;
  if (spec.minPlan && PLAN_RANK[options.planTier] < PLAN_RANK[spec.minPlan]) {
    desired = "standard";
    reasons.push("plan_not_eligible_for_premium");
  }
  const floor = spec.minTier === "none" ? "light" : spec.minTier;
  const ceiling = hardCeilingCents(options.monthlyPriceCents, options.minimumMarginPercent ?? 85);
  const batch = Boolean(options.allowBatch && spec.batchEligible);
  const start = TIER_ORDER.indexOf(desired);
  const end = TIER_ORDER.indexOf(floor);
  let sawHealthy = false;
  for (let index = start; index <= end; index += 1) {
    const tier = TIER_ORDER[index];
    for (const model of config[tier] ?? []) {
      if (options.healthyProviders && !options.healthyProviders.has(model.provider)) continue;
      sawHealthy = true;
      const estimate = estimateCostCents(model, spec.inputTokens, spec.outputTokens, batch);
      if (options.spentThisMonthCents + estimate <= ceiling) {
        if (tier !== spec.tier) reasons.push(`routed_to_${tier}`);
        return { ok: true, tier, model, estimatedCostCents: estimate, batch, downgradedFrom: tier === spec.tier ? null : spec.tier, reasons };
      }
      reasons.push(`over_budget:${model.model}`);
    }
  }
  return { ok: false, reason: sawHealthy ? "budget_exhausted" : "no_healthy_provider", reasons };
}

// Escalate to the next tier up at most once, only when the cheaper answer failed validation or
// was not confident. Never escalates past premium or beyond the caller's budget check.
export function shouldEscalate(input: { validationFailed: boolean; confidence: number | null; minConfidence: number; escalationsUsed: number }): boolean {
  if (input.escalationsUsed >= 1) return false;
  if (input.validationFailed) return true;
  return input.confidence !== null && Number.isFinite(input.confidence) && input.confidence < input.minConfidence;
}

export function nextTierUp(tier: Exclude<Tier, "none">): Exclude<Tier, "none"> | null {
  const index = TIER_ORDER.indexOf(tier);
  return index > 0 ? TIER_ORDER[index - 1] : null;
}
