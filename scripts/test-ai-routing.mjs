// Offline tests for AI model routing. No network, no database, no secrets.
import { DEFAULT_CLAUDE_ROUTES, TASKS, estimateCostCents, hardCeilingCents, nextTierUp, selectModel, shouldEscalate } from "../supabase/functions/_shared/ai-routing.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const sonnet = DEFAULT_CLAUDE_ROUTES.standard[0];
const fable = DEFAULT_CLAUDE_ROUTES.premium[0];
const opus = DEFAULT_CLAUDE_ROUTES.premium[1];
const haiku = DEFAULT_CLAUDE_ROUTES.light[0];

// Cost math (reference prices).
check("Sonnet 10k in + 5k out costs 7 cents", estimateCostCents(sonnet, 10_000, 5_000) === 7);
check("a premium Fable build (40k in, 60k out) costs 340 cents", estimateCostCents(fable, 40_000, 60_000) === 340);
check("batch pricing is half", estimateCostCents(fable, 40_000, 60_000, true) === 170);
check("tiny calls cost at least 1 cent", estimateCostCents(haiku, 10, 10) === 1);
check("the hard ceiling mirrors the 85% margin rule", hardCeilingCents(15_000) === 2_250 && hardCeilingCents(5_000) === 750 && hardCeilingCents(-5) === 0);

// Task mapping.
const base = { planTier: "growth", monthlyPriceCents: 10_000, spentThisMonthCents: 0 };
check("auto-approval is rule-only and uses no model", (() => { const r = selectModel({ ...base, task: "auto_approval" }); return r.ok && r.tier === "none" && r.model === null; })());
check("classification and triage use the light tier", ["reply_intent_triage", "abuse_triage", "change_request_classification"].every((task) => { const r = selectModel({ ...base, task }); return r.ok && r.tier === "light" && r.model.model === "claude-haiku-4-5"; }));
check("outreach drafts and build plans use the standard tier", ["outreach_draft", "build_plan", "support_reply_draft"].every((task) => { const r = selectModel({ ...base, task }); return r.ok && r.tier === "standard" && r.model.model === "claude-sonnet-5-5"; }));
check("an unknown task is rejected", selectModel({ ...base, task: "write_novel" }).ok === false);

// Plan gating for premium work.
const premiumTask = { task: "premium_site_build", monthlyPriceCents: 15_000, spentThisMonthCents: 0 };
check("premium builds use Fable on Intelligence and Enterprise plans", ["intelligence", "enterprise"].every((planTier) => { const r = selectModel({ ...premiumTask, planTier }); return r.ok && r.tier === "premium" && r.model.model === "claude-fable-5-1" && r.downgradedFrom === null; }));
check("premium builds are routed to standard on Starter and Growth plans", ["starter", "growth"].every((planTier) => { const r = selectModel({ ...premiumTask, planTier, monthlyPriceCents: 10_000 }); return r.ok && r.tier === "standard" && r.reasons.includes("plan_not_eligible_for_premium"); }));

// Budget behaviour at $150 (ceiling 2,250 cents).
check("a premium build fits a fresh $150 plan", selectModel({ ...premiumTask, planTier: "intelligence" }).ok);
check("with 2,000 cents spent the build falls back to Opus 5.5", (() => { const r = selectModel({ ...premiumTask, planTier: "intelligence", spentThisMonthCents: 2_000 }); return r.ok && r.model.model === "claude-opus-5-5" && r.reasons.includes("over_budget:claude-fable-5-1"); })());
check("with 2,200 cents spent nothing at or above the quality floor fits", (() => { const r = selectModel({ ...premiumTask, planTier: "intelligence", spentThisMonthCents: 2_200 }); return r.ok === false && r.reason === "budget_exhausted"; })());
check("a build plan is refused rather than downgraded below its quality floor", (() => { const r = selectModel({ task: "build_plan", planTier: "starter", monthlyPriceCents: 5_000, spentThisMonthCents: 745 }); return r.ok === false && r.reason === "budget_exhausted"; })());
check("a light task still runs when only a few cents remain", selectModel({ task: "reply_intent_triage", planTier: "starter", monthlyPriceCents: 5_000, spentThisMonthCents: 740 }).ok === true);
check("a $0 plan has no AI budget", selectModel({ task: "reply_intent_triage", planTier: "starter", monthlyPriceCents: 0, spentThisMonthCents: 0 }).ok === false);

// Provider health and OpenAI configuration.
const withOpenAi = { ...DEFAULT_CLAUDE_ROUTES, standard: [...DEFAULT_CLAUDE_ROUTES.standard, { provider: "openai", protocol: "openai_responses", model: "configured-openai-model", inputPerMTokUsd: 1, outputPerMTokUsd: 4 }] };
check("an unhealthy provider is skipped and the next provider is used", (() => { const r = selectModel({ ...base, task: "build_plan", config: withOpenAi, healthyProviders: new Set(["openai"]) }); return r.ok && r.model.provider === "openai" && r.model.protocol === "openai_responses"; })());
check("no healthy provider is reported as such", selectModel({ ...base, task: "build_plan", healthyProviders: new Set() }).reason === "no_healthy_provider");

// Batch.
check("batch pricing is used only for batch-eligible tasks when the caller allows it", (() => {
  const a = selectModel({ ...base, task: "outreach_draft", allowBatch: true });
  const b = selectModel({ ...base, task: "outreach_draft", allowBatch: false });
  const c = selectModel({ ...base, task: "support_reply_draft", allowBatch: true });
  return a.batch === true && b.batch === false && c.batch === false && a.estimatedCostCents <= b.estimatedCostCents;
})());

// Escalation.
check("escalates once on a validation failure", shouldEscalate({ validationFailed: true, confidence: 0.99, minConfidence: 0.9, escalationsUsed: 0 }));
check("escalates once on low confidence", shouldEscalate({ validationFailed: false, confidence: 0.5, minConfidence: 0.9, escalationsUsed: 0 }));
check("never escalates twice", shouldEscalate({ validationFailed: true, confidence: 0.1, minConfidence: 0.9, escalationsUsed: 1 }) === false);
check("does not escalate a good answer", shouldEscalate({ validationFailed: false, confidence: 0.95, minConfidence: 0.9, escalationsUsed: 0 }) === false);
check("tiers escalate light -> standard -> premium -> nothing", nextTierUp("light") === "standard" && nextTierUp("standard") === "premium" && nextTierUp("premium") === null);
check("every task has a defined tier", Object.values(TASKS).every((t) => ["none", "light", "standard", "premium"].includes(t.tier)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll AI-routing checks passed (offline; reference prices only, no provider was called).");
process.exit(failures ? 1 : 0);
