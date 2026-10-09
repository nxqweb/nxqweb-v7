# AI model routing, rule-based auto-approval, autonomous outreach, AI chat — plan

Written 2026-10-05 from a planning conversation. **Nothing here is built except the Claude protocol
support described in section 1.1 (local only, not deployed).** Items marked (gate) need explicit
approval before work starts: migrations, deployments, external services, secrets, payments, or
changes to a product rule. Not legal advice; get outreach and privacy terms reviewed by a lawyer.

## 1. Use Claude or ChatGPT, routed by task to the cheapest adequate model

### 1.1 What exists
- `anthropic_messages` protocol added to `generate-business-build-plan` and
  `classify-business-change-request` (commit 7612d6b; offline tests only). OpenAI protocols
  (`openai_responses`, `openai_chat_completions`) already work.
- Gate found: migration 179's readiness function recognises only the two OpenAI protocols as
  proven, so a new migration is needed before readiness can pass with Claude (gate).

### 1.2 Tiers (Claude prices from the cached table dated 2026-09-25; verify before use)
| Tier | Use for | Claude model | $/M tokens in/out |
|---|---|---|---|
| 0 - no AI | Anything a rule can decide (approvals, deployment checks, quotas) | none | 0 |
| Light | Reply-intent triage, change-request classification, abuse triage, summarising audit findings | Haiku 4.5 | 1 / 5 |
| Standard | Outreach drafts, Starter/Growth build plans, support-reply drafts | Sonnet 5.5 | 2 / 10 |
| Premium | $150+ site builds | Fable 5.1 (or Opus 5.5 at 4 / 20) | 10 / 50 |
OpenAI equivalents: pick when wiring; model names and prices must be checked at that time.
A ChatGPT subscription is not an API account; API usage is billed separately.

### 1.3 Cost levers, in order
1. Don't use AI when code can decide.
2. Cheapest adequate tier; escalate once only if schema validation fails or confidence is low.
3. Prompt caching for repeated context (cache reads cost a fraction of normal input).
4. Batch API (about half price) for non-urgent work such as overnight outreach drafting.
5. Tight `max_tokens`; thinking models count thinking toward it, so leave headroom.
6. Per-client monthly ceiling: already enforced (target 90% / minimum 85% margin; $5-$30 per
   month for $50-$200 plans). A premium Fable build (about $3-$14) fits $150+ plans only.
7. Measure real token usage on one sample per tier before setting prices.

### 1.4 Configuration design (gate)
Recommended: a database table of routes (task -> tier -> provider/model/max tokens/cost estimate),
owner-editable, with provider tokens only in Edge secrets. Alternative: tier-specific secret names
(simpler, but more secret names and runtime-profile updates). Either needs approval.
Timeouts (15-20 s today) may need raising for thinking models. Add provider failover (the other
vendor) and Claude refusal fallback.

## 2. Auto-approval without an AI reading the signup text

Idea (owner): the owner mostly clicks Approve without reading, so let a rule engine approve
low-risk clients using only structured facts, never free text or prompts.

**Design: rule engine, no LLM in the decision.**
- Inputs (structured only): product family, tier and price, verified email, Turnstile pass, intake
  completeness, business category from an allowlist, region, duplicate/velocity checks, domain or
  website category, billing state (once billing exists: payment succeeded).
- Outputs: `auto_approve`, `queue_for_owner`, or `auto_block` (limited to unambiguous abuse such as
  blocklisted or duplicate signups). Anything uncertain goes to the owner. Free-text fields are
  shown to the owner but never evaluated by AI for this decision, which removes prompt injection
  from the decision path.
- Safeguards: daily cap on auto-approvals, instant kill switch, full audit log, owner can reverse,
  Netlify budget guard and economic ceiling stay on, paid capabilities already require an active or
  past-due billing state (migration 246), disposable QA clients excluded from auto rules.
- Rollout: shadow mode first (engine records what it would decide while the owner still approves;
  compare on 20+ real cases), then enable for the lowest-risk class only.
- Gate: changes the README rule "one owner APPROVE/DENY decision"; needs a migration
  (policy table + function) and a guarded staging apply. Product decision for the owner.

## 3. Autonomous outreach (finding and contacting prospects)

### 3.1 What exists in the code (foundation)
Prospect table with statuses, website audits, AI draft function, per-channel contact permissions
(non-email channels require consent evidence), suppression table, delivery-jobs and reply-events
tables, settings with `automation_mode` (disabled / review_only / guarded; default review_only),
`emergency_stop` (default on), `external_delivery_enabled` (default off), daily email cap (1-50,
default 20), and a 09:00-16:30 send window. Discovery is limited to approved provider APIs.
**I found no code that reads the delivery, suppression or reply tables**, so sending, unsubscribe
processing and reply handling are not implemented yet.

### 3.2 Target pipeline
discover (approved API) -> audit the prospect's public site -> qualify by rules -> personalise from
real audit findings -> compliance check -> send within caps -> classify replies -> unsubscribe
instantly -> hand interested replies to the owner.

### 3.3 Guardrails to build in (reduce risk; cannot be guaranteed away)
- Email only. No cold SMS (US automated marketing texts generally need prior written consent).
- Region filter: US business-to-business first. Exclude EU, UK, Canada and other consent-based
  regions until reviewed.
- Contact only publicly listed business addresses; record the source and basis per prospect
  (matches the `public_business_email` basis already in the schema).
- Every message: accurate sender identity, honest subject, physical postal address, working
  one-click unsubscribe, processed automatically and globally (suppression list).
- Truthful personalisation only: claims must come from recorded audit findings; no invented facts.
- Sending infrastructure: a separate sending domain with SPF, DKIM and DMARC; warm-up; low daily
  caps; automatic pause if bounce or complaint rates rise; emergency stop.
- Discovery must follow each provider's terms (use official APIs such as a places API; do not
  scrape search results).
- Untrusted input: prospect websites can contain prompt injection. The AI gets no tools, returns
  structured output only, drafts pass a validator (no links except allowlist, no unverifiable
  claims) before they can be sent.

### 3.4 Autonomy stages
0 review-only (today) -> 1 owner approves a batch in one click -> 2 auto-send drafts that pass all
compliance rules, with sampled owner review and a metric-based kill switch -> 3 full autonomy for
a narrow, proven segment. Each stage needs written exit criteria and a lawyer's sign-off on the
templates. Each step to send real email is a gate (external service + production-facing).

## 4. AI customer chat
Stage 1 draft replies for the owner to approve. Stage 2 auto-reply only for a short allowlist of
low-risk questions. Always: customer text is data, not instructions; the AI has no ability to take
actions; it sees only that client's data (tenant isolation); structured output; links and secrets
stripped; rate and cost caps; escalation to the owner on anything outside the allowlist; full
logging. "Cannot be injected" is not achievable; layered controls are.

## 5. Decisions needed from the owner
1. Routing config: database table (recommended) or tier-specific secrets.
2. Which OpenAI models to support alongside Claude.
3. Auto-approval: shadow mode first, and which client class is "low risk".
4. Outreach: stage 1 first; regions; a separate sending domain and email provider.
5. Lawyer review of outreach templates and privacy policy before any real send.

## Status update 2026-10-05
Local pure libraries now exist with offline tests (not deployed, not called by any function):
`supabase/functions/_shared/ai-routing.ts` (section 1) and `supabase/functions/_shared/auto-approval.ts`
(section 2, rules only, off/shadow/live). Section 3 groundwork: `outreach-compliance.ts`,
`outreach-dispatch.ts`. Everything that connects them to the database, a function, or a provider is still
a gate (migration, deploy, secrets).

