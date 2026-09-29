# NXQ runtime handoff (canonical)

This is the live, authoritative handoff document for `nxqweb-v7`. Read
`CLAUDE.md` first for standing operating rules, then this file for current
state. Update this file, not a new one, at every handoff.

## Current checkpoint — 2026-09-29

- **Branch:** `safe/checkpoint-autonomy-wave35-sales`
- **HEAD:** `8424e3f` — "feat: draft migration to notify client on new
  Commerce request (staged, not applied)"
- **Working tree:** clean, pushed to `origin`, no divergence.
- This checkpoint was reached by fetching and fast-forward merging from a
  stale local cache that had lagged the real remote tip
  (`afbbc5f` → `c36568d`), then several further local commits ending at
  `8424e3f` — see "Confirmed blockers/risks" for why stale tracking refs
  must always be refreshed before trusting a reported HEAD.
- **Two new, unapplied migrations in the tree** — both pass local
  migration integrity and every other local check, but **neither has
  been applied to any database** (no staging credentials in this
  container, and applying is always a separate guarded action anyway).
  Review both before the next `apply_all` staging run:
  - `supabase/migrations/248_notify_client_on_website_setup_denial.sql`
  - `supabase/migrations/249_notify_client_on_commerce_customer_request.sql`

## Completed work since the prior handoff entry (2026-09-29, this session)

- Added `CLAUDE.md` and canonicalized this handoff document
  (`a94cc2e`).
- Ran `npm ci && npm run test:release` for the first time this session
  against a real HEAD. Found and fixed a genuine pre-existing bug:
  `validate-nxqx-brand-contract.mjs`'s "public plan cards use NXQ-* names"
  check was failing because `src/pages/PublicPlans.tsx` only contained the
  literal string `NXQ-Business`; the other seven family names render only
  dynamically through `ProductFamilySignupSelector`/`productCatalog.ts`.
  Added a "Coming next: …" line listing all eight names as visible static
  copy. Fixed in `e9a6fda`. Traced to a Sept 3 2026 import commit
  (`aab89f1`) — likely broken since that import, not a recent regression.
- Re-ran the full release gate after the fix: it now progresses past the
  brand contract cleanly and 8+ validator suites (hundreds of sub-checks,
  including tenant isolation, paid-capability enforcement, maintenance/
  recovery, growth/outreach, mega-autonomy, Netlify budget, NXQ identity)
  pass. It stops at `validate-paid-capability-guards-staging.mjs`, which
  requires live `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` to query the
  staging database directly and fails closed without them by design. This
  container has no staging credentials — correctly so, per the
  external-service stop-and-ask gate in `CLAUDE.md`. No attempt was made to
  source or fabricate credentials to get past it.
- Manually ran every remaining `validate-*.mjs` file that alphabetically
  follows the credential-gated one (23 files) directly, since
  `run-release-gate.mjs` cannot reach them while that check fails closed.
  Found and fixed three more real issues, all local-only (no staging
  credentials involved):
  - `validate-provider-plug-in-readiness-contract.mjs`: **a regression
    I introduced** in this same session — my first canonicalization pass
    compressed this file's one-time-setup/plug-in/future-hookup sections
    into a pointer to other docs, but the validator requires this file to
    literally contain the `## Future one-session provider hookup` heading
    and all twelve secret names. Restored the full original sections
    verbatim. Fixed in `d2c17e6`. Lesson: this file is a load-bearing
    contract target, not free-form prose — do not compress its required
    sections without checking which validators read it first
    (`grep -rn "NXQ_RUNTIME_HANDOFF" scripts/`).
  - `validate-zero-key-staging-contract.mjs`: a stale exact-spacing literal
    match against `src/pages/ClientFiles.tsx` (`||` with no surrounding
    spaces) that no longer matched the file's ESLint-formatted spacing. The
    guarded quarantine/scan-status logic itself was already correct on
    both client and owner sides — updated the check's expected string, not
    the security logic. Fixed in `859f200`.
  - `validate-stripe-readiness-contract.mjs`: `ClientCommerceLiveStore.tsx`
    had generic "protected credential" copy but not the literal
    `https://buy.stripe.com/` example format or the phrase "Stripe secret
    key" the check requires. This touches a Stripe-labeled file, so I
    stopped and asked before editing per the payments gate; approved as
    copy-only (no payment/billing logic changed). Fixed in `859f200`.
- Manually ran every credential-independent script the gate would
  otherwise reach after the failing validator: `npm run lint --
  --max-warnings=0`, `node scripts/check-migration-integrity.mjs`,
  `npm run test:security`, `npm run test:accessibility`, `npm run
  test:edge`, `npm run build`, `node scripts/check-production-bundle-budget.mjs`,
  `npm run test:routes`, `npm audit --omit=dev --audit-level=high`. All
  passed (0 high/critical prod vulnerabilities; 214 migrations valid; 44
  Edge functions type-check; 19/19 accessibility; 17/17 security; build
  and all 16 route smoke checks green).
- Ran the remaining credential-independent pieces of the release gate:
  `node scripts/check-runtime-stage-readiness.mjs` (9/9, including its own
  explicit self-deferral of the remote launch-architecture contract since
  staging credentials are absent), `node scripts/simulate-autonomy-failures.mjs`
  (23/23), and `npm run test:lifecycle` (21/21 deterministic scenarios plus
  10/10 clean onboarding-to-live replays; external provider evidence
  correctly reported as "not exercised" since it needs disposable
  Supabase/GitHub/Netlify runtime). No fixes needed — all passed cleanly.
- **Everything in `scripts/run-release-gate.mjs` that does not require live
  staging credentials is now confirmed green at HEAD `5f6adc5`**, run
  individually rather than through the chained script (which still stops
  at `validate-paid-capability-guards-staging.mjs`). The only pieces left
  unverified are that one validator and `npm run test:staging-evidence`,
  both of which need real `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`.
- Audited every claim in `docs/LAUNCH_HARDENING_CHECKLIST.md` against
  current code and validators (unlike the other docs checked earlier this
  session, this one held up — no false claims found). Verified: Turnstile
  server-side verification is real (`supabase/functions/ingest-business-lead/index.ts`,
  confirmed by `validate-business-generated-site-quality.mjs` 27/27),
  recovery/readiness (18/18), provider health (24/24), tenant isolation
  (28/28), growth/outreach (16/16), and staging readiness evidence (12/12)
  contracts all pass, and migration 231 (client-owned domain policy)
  exists in the tree. No edits to that file were needed.
- Audited `docs/NXQ_CAPABILITY_ROADMAP.md` (the AI-safety policy for what
  features the AI may promise clients) and found a real implementation
  gap, not a doc-staleness issue: `src/ai/capabilityRules.ts` fully
  implemented the roadmap's classification rules (9 rules, decision/risk
  ranking, the exact car-customizer/ecommerce/restricted-workflow
  examples from the doc) but was never imported anywhere in the app —
  dead code next to a doc describing it as live policy. Confirmed via
  `grep -rln "classifyCapabilityRequest|capabilityRules"` across
  `src/` and `supabase/functions/` before touching anything. Asked the
  user how to handle it (wire it in vs. log and move on); approved to
  wire it in. Fixed in `f2b18e4`:
  - Moved the rules to `supabase/functions/_shared/capability-rules.ts`
    (the only place anything currently reads it from — Edge Functions,
    not the frontend, since Deno and Vite don't share a module root
    here). `src/ai/` no longer exists.
  - `supabase/functions/classify-business-change-request/index.ts` now
    runs `classifyCapabilityRequest(title + description)` as a
    deterministic pre-filter before its existing deterministic-patch/AI
    branching. Any decision other than `approved_standard` (full
    checkout, vehicle/3D configurators, inventory/external sync,
    restricted legal/medical/financial workflows) is forced to
    `owner_review` immediately, bypassing the AI provider call entirely
    for those categories, with the matched rule name and decision
    recorded in `automation_plan` evidence for audit.
  - This is additive-only by construction: none of the existing rule
    keywords overlap with ordinary contact/service-list edits, so normal
    change requests are provably unaffected. Verified with a direct call
    (`node --input-type=module -e '...'`) showing a car-customizer
    request now returns `custom_quote_required` while a normal
    contact/testimonial request still returns `approved_standard`.
  - Re-ran the entire credential-independent release gate after this
    change (lint, `test:edge` — 44/44 Deno type-check — all 23
    downstream validators, `simulate-autonomy-failures.mjs` 23/23,
    `test:lifecycle` 21/21 + 10/10) — all still green, nothing regressed.
  - **This has not been deployed anywhere.** It is a local source change
    in the repo only; it takes effect on staging only after the normal
    guarded `manual-supabase-stage.yml` deployment action, which remains
    a separate explicit gate.
- Scanned `src/` and `supabase/functions/_shared/` for other files
  referenced nowhere else (the same pattern that found the capability-rules
  gap). Found one more: `src/services/paymentProviders.ts`, a client-side
  "activate subscription" stub from the same Sept 3 import commit,
  unreferenced anywhere. Unlike the capability rules, this one should
  **not** be wired in — its shape would require a Stripe secret key in the
  browser, which directly violates the project's own no-secrets-in-browser
  rule, and it's superseded by the real server-side implementation
  (`supabase/functions/ingest-stripe-webhook` + migration 227). Asked the
  user since it's payments-adjacent; approved to delete. Removed in
  `6ffc1ee`. No other unreferenced files found in either scan. Full
  release gate re-run after deletion: same clean stop at
  `validate-paid-capability-guards-staging.mjs`, nothing else regressed.
- Checked outstanding TODO/FIXME/HACK markers (none found), Edge function
  manifest coverage (already 44/44 confirmed by
  `check-runtime-stage-readiness.mjs`), and `console.error` usage in Edge
  functions (14 occurrences, all legitimate last-resort operational
  logging of `.message` strings when a DB write itself fails — no secrets,
  no defect). Checked whether any "planned" product family in
  `productCatalog.ts` is secretly fully built like Multi-Location was
  (Booking, Commerce, Menu, Property, Multi-Location, Membership all
  `planned`; Enterprise Systems `private`) — Commerce has substantial code
  but that's Commerce-as-a-module-inside-NXQ-Business, not a
  signup-ready standalone family; flipping any status to `available` is a
  real business/product decision, not a code defect, so left untouched.
- Ran `npm audit` (including dev dependencies, which the release gate's
  `--omit=dev` check doesn't cover) and found 2 real dev-only
  vulnerabilities (1 moderate, 1 high) in the `browserslist`/
  `baseline-browser-mapping` chain used only by build tooling, never
  shipped to users. Ran `npm audit fix` (no `--force`) — only
  `package-lock.json` changed, `package.json` untouched, no direct
  dependency added/removed/downgraded. `npm audit` now reports 0
  vulnerabilities. Verified with a clean build, clean lint, and a full
  release-gate re-run (same expected stop point). Fixed in `5a06296`.
- Checked all `dependencies` and `devDependencies` in `package.json` for
  usage anywhere in the codebase. Found `clsx` listed but never imported
  anywhere. Confirmed with the user before removing (dependency removal is
  a confirm-first action) — approved. `npm uninstall clsx`; only
  `package.json`/`package-lock.json` changed. Verified clean build, lint,
  and full release gate (same expected stop point). Fixed in `66f1d3b`.
  All `devDependencies` checked too (eslint, vite, typescript, deno,
  supabase CLI, etc. — all used via config/scripts, not direct imports;
  `jose` actively used in 8 Edge functions) — nothing else unused found.
- Checked `scripts/` for orphaned automation files not called by
  `package.json`, `run-release-gate.mjs`, or any workflow. Two initial
  hits (`remote-launch-architecture-contract.mjs`,
  `workflow-step-helper.mjs`) were false positives — both are shared
  modules imported by other scripts, confirmed with a repo-wide grep, not
  actually orphaned. No real orphans found. Also checked
  `templates/booking-v1/blueprint.json` (looked unreferenced at a glance)
  — it's a real, validator-tracked scaffold for the "planned" Booking
  family, not dead code.
- Verified the tier pricing model against the server-enforced economics:
  provider cost is capped at `(monthly_price − 40) × 100` cents
  (migration 229, line 359), so NXQ is guaranteed at least $40 gross
  margin per client on every tier — including Starter at $50/mo — before
  any referral credit is applied. Confirmed the Enterprise resource-policy
  row's `provider_cost_cents:11000` matches the formula exactly at
  $150/mo. No inconsistency found; this is sound by design.
- Audited every outbound `fetch` call across all 44 Edge functions for the
  same SSRF risk class as the earlier `generate-business-build-plan` fix
  (a config-supplied URL feeding an outbound request without the shared
  guard). Found and fixed a real gap:
  `supabase/functions/prepare-build-plan/index.ts` had its own weaker,
  hand-rolled `validateAdapterUrl` instead of the shared
  `requirePublicHttpsUrl` — missing cloud-metadata hostname blocks
  (`metadata.google.internal`, etc.), the `100.64.0.0/10` and
  `198.18.0.0/15` private ranges, `0.0.0.0`, IPv4-mapped IPv6, and
  `.internal`/`.local`/`.home`/`.lan` suffixes that the shared guard
  already covers. `NXQ_BUILD_PLAN_AI_ADAPTER_URL` is config-supplied and
  feeds directly into `fetch`, the same risk shape as the prior fix.
  Replaced the local implementation with the shared guard. This broke
  `validate-autonomy-ops-wave18-contract.mjs`, which hardcoded literal
  markers from the old regex implementation — updated that check to
  verify the shared guard is imported and used instead (a tightening,
  not a weakening, of the check). Every other outbound fetch in
  `supabase/functions/` was checked and uses either a hardcoded trusted
  host (`api.github.com`, `api.netlify.com`) or the project's own
  self-referential Supabase URL — no other gap found. Fixed in
  `e33ef28`, verified with lint, Deno type-check (44/44), the full
  release gate (same expected stop point), all 23 downstream validators,
  the failure simulator (23/23), and the 10-run lifecycle simulation.
- Followed up on the same "audit every function for this bug class"
  pattern for the worker-token timing-attack fix a prior commit
  (`b7bd71d`) had started but not finished: that commit fixed 6 functions
  comparing `NXQ_AUTOMATION_WORKER_TOKEN` with plain `===`/`!==` instead
  of a constant-time comparison, but a full grep across all 44 Edge
  functions found 10 more with the identical gap:
  `apply-business-change-request`, `build-business-location-pages`,
  `build-business-seo-artifacts`, `check-provider-health`,
  `classify-business-change-request`, `dispatch-notifications`,
  `process-data-subject-request`, `run-backup-restore-drill`,
  `run-staging-evidence-suite`, `scan-client-file`. A plain string
  comparison leaks timing information proportional to how many leading
  characters match, theoretically letting an attacker recover a valid
  internal automation token byte-by-byte. Switched all 10 to the shared
  `constantTimeEqual`. (`provision-storefront` was correctly excluded —
  it already has its own equivalent timing-safe helper under a different
  name, `protectedTokenMatches`, not a vulnerability.) Fixed in
  `faab445`, verified with a direct sanity call on `constantTimeEqual`
  (match/mismatch/empty-string), Deno type-check (44/44), lint, the full
  release gate (same expected stop point), all 23 downstream validators,
  the failure simulator (23/23), and the 10-run lifecycle simulation.
- Considered but declined a softer finding: 19 internal Edge functions
  (all already gated by worker-token or owner-login auth) parse request
  bodies with no explicit app-level size cap. Asked the user; no strong
  preference either way, so went with the recommendation to skip it —
  low confidence it's a real gap given the existing auth gates plus
  Supabase's own platform-level request size ceiling, and no single
  clean established pattern across the codebase to replicate
  consistently (unlike the SSRF/timing-attack fixes, which had one).
  Logging this here rather than acting on it; revisit only if a
  concrete reason to prioritize it shows up.
- Followed the "does every user of this shared guard actually use it
  correctly" question one step further: checked every function using
  `requirePublicHttpsUrl` for whether its actual `fetch()` call also
  blocks redirects (`redirect: "error"`). A URL can pass upfront
  validation and still be redirected by the far end to an internal
  address if the fetch silently follows 3xx responses — a classic
  SSRF-via-redirect bypass. 6 of 8 already had `redirect: "error"`
  (the correct, already-established pattern); `generate-business-build-plan`
  and `prepare-build-plan` — the same two functions already touched for
  SSRF this session — did not. Added `redirect: "error"` to both,
  matching the existing pattern exactly; no behavior change for a
  well-behaved provider. Fixed in `cb46ddb`, verified with Deno
  type-check (44/44), lint, the full release gate (same expected stop
  point), all 23 downstream validators, the failure simulator (23/23),
  and the 10-run lifecycle simulation.
- Ran a schema-level version of the same "pattern applied inconsistently"
  audit: checked every migration for a table created without RLS ever
  enabled anywhere (none found — clean), then checked every RLS-enabled
  table for whether it ever got an actual policy. Most "RLS enabled, zero
  policies" hits are the correct, deliberate lockdown pattern for
  internal/ops-only tables (`nxq_scale_modes`, `nxq_netlify_budget_settings`,
  `staging_readiness_evidence_runs`, etc. — service-role-only by design,
  not a bug). One stood out as different: **`commerce_cart_items`**
  (migration 036) was granted `select, insert, update, delete` to the
  `authenticated` role but never got an RLS policy, and — unlike the ops
  tables — is never referenced anywhere in `src/` or
  `supabase/functions/`. Traced the real checkout flow (migration 090
  `protected_commerce_checkout` onward): it takes cart contents as a
  stateless request payload directly into the checkout RPC, never
  persisting to a cart table at all. `commerce_cart_items` is leftover
  schema from an earlier design, superseded before this branch's current
  checkout flow existed.
  - **Not a security hole**: RLS enabled with no policies fails closed by
    default in Postgres — the `GRANT` alone gives no actual access without
    a matching policy, so this has effectively zero live exposure.
  - **Not touched**: fixing this means a new migration (drop or
    RLS-lock the table), which is a hard stop-and-ask gate. Asked the
    user; recommended logging it rather than drafting a migration given
    it's inert — approved. No migration was written or drafted.
  - **Action for later**: if/when a maintenance pass touches Commerce
    schema, consider a migration to drop `commerce_cart_items` (or add
    the missing policies if it turns out something still expects it to
    work) — needs explicit review and the normal guarded staging apply,
    not an autonomous change.
- Checked a different consistency angle: every Edge function the frontend
  calls directly via `supabase.functions.invoke` (17 total, found by
  grepping `src/` for that call). Since these are genuine cross-origin
  browser calls, each needs its own CORS handling (`OPTIONS` preflight +
  `Access-Control-Allow-*` headers) — Supabase's platform does not add
  this automatically. 16 of 17 had it; `discover-sales-prospects` had
  none at all. This isn't a security gap, it's a **functional bug**: the
  Owner Portal's "fictional discovery" button (`OwnerGrowthCenter.tsx`)
  would have its request blocked by the browser's own CORS preflight and
  could not have worked as shipped. Added the same `corsHeaders`/`OPTIONS`
  pattern already used consistently in the other 16 functions. Fixed in
  `731ce8d`, verified with Deno type-check (44/44), lint, the full
  release gate (same expected stop point), all 23 downstream validators,
  the failure simulator (23/23), and the 10-run lifecycle simulation.
- Ran a read-only end-to-end audit of the actual Business flow, at the
  user's explicit request: signup/intake → owner decision → build →
  deploy handoff → client portal → maintenance. Traced each joint by
  reading real code, not assuming:
  - **Signup/intake**: `PortalSignup.tsx` collects family/tier-specific
    project-fit answers and stores them as Supabase auth user metadata.
    The `handle_new_client_signup()` trigger (migration 193) only reads
    `business_name`/`contact_name`/`product_family_slug`/`product_tier_key`
    from that metadata — the richer answers (`intake_family_details`,
    `intake_family_answers`, `intake_service_area`, `intake_primary_goal`,
    `intake_tier_goal`) are never read again. Confirmed this is
    **intentional, not a bug**: the real, authoritative intake is a
    separate, far more thorough "website setup report" form inside
    `ClientPortal.tsx` (industry, services, pages, style, brand,
    competitors, lead-handling rules, AI assistant rules, typed
    signature) submitted via `submit_current_client_website_setup`,
    matching migration 218's own description of it as "authoritative
    intake evidence." The initial signup answers only route the
    family/tier selection. Worth a UX look someday (why ask detailed
    questions twice) but that is a product call, not a code gap.
  - **RPC/route integrity**: every `supabase.rpc(...)` call in `src/`
    (109 distinct names) resolves to a real function defined in
    `supabase/migrations/`; every page in `src/pages/` is registered in
    `src/App.tsx`. No broken buttons or dead routes found.
  - **Owner decision → build → deploy handoff**: `qa_only` enforcement
    (blocking disposable QA clients from real infrastructure/billing) is
    correctly centralized in database RPCs (`nxq_authorize_paid_capability`
    and siblings), not scattered per-function — the right architecture,
    confirmed by tracing the exact cost-cap formula rather than assuming.
    Role authorization (owner-only functions checking `owner_users`,
    client-facing ones checking `clients`) is consistently correct across
    all 17 browser-invoked functions.
  - **Client portal**: the live lead-capture contract between every
    generated client website (`templates/business-v1/lead-form.js`) and
    `ingest-business-lead` was checked field-by-field and matches exactly
    (`form_key`, `name`, `email`, `phone`, `message`, `service_area`,
    `utm`, `company_website`, `challenge_token` in, `{ok:true,accepted:true}`
    out) — this is the one contract that, if broken, would silently kill
    every client's contact form, and it's intact.
  - **Real gap found**: `promote-business-production` (the function that
    performs the actual first production launch) logs an internal
    `automation_audit_log` event (`business_website_published_automatically`)
    but never notified the client. The parallel, already-correct pattern
    for *ongoing* changes (migration 137's `notify_change_request_state`
    trigger) does notify the client the moment a change reaches
    `published` — the very first launch, arguably the single most
    important moment in the whole product, had no equivalent. Fixed by
    adding a `notification_deliveries` insert immediately after the
    existing audit-log insert, using the exact channel/recipient_kind
    pattern already established by five other insert sites (migrations
    137, 148, 154, 155, 159): `channel: "in_app"` (always deliverable,
    no external provider needed), `recipient_kind: "client"`,
    `template_key: "business_production_published"`, `priority: "high"`.
    Deliberately not error-checked, matching the audit-log insert right
    above it — the launch has already fully succeeded by that point, so
    a failed notification write must never make the launch report as
    failed. No migration or schema change needed;
    `notification_deliveries` and its dispatch worker already exist.
    Fixed in `51aced5`, verified with Deno type-check (44/44), lint, the
    full release gate (same expected stop point), every validator that
    references `promote-business-production` by name, all 23 downstream
    validators, the failure simulator (23/23), and the 10-run lifecycle
    simulation.
  - **Maintenance**: `run-website-maintenance` and its uptime/SSL/backup
    checks were already exhaustively covered by
    `validate-recovery-readiness-contract.mjs` (18/18) and
    `validate-mega-autonomy-contract.mjs` (45/45) earlier this session —
    not re-audited from scratch here, but nothing in the launch-handoff
    trace above surfaced anything wrong with how maintenance picks up a
    newly-published site (`bootstrap_live_website_maintenance` RPC runs
    unconditionally right before the notification fix above).
- Continued the same audit one stage earlier and found the identical gap:
  `build-business-website`'s `processPreviewCheck` updates a run to
  `status: "preview_ready"` / `current_step: "client_review"` — a state
  that explicitly means "the client needs to act" — but never notified
  the client either, for the same reason (no trigger on
  `website_automation_runs` beyond an `updated_at` touch). Arguably more
  important than the production-launch gap, since preview review is an
  action-required step, not just an FYI. Fixed the same way: a
  `notification_deliveries` insert (`template_key:
  "business_preview_ready"`) right after the existing `updateStep` call,
  placed after the deferred-retry early return so it fires exactly once
  per successful preview completion (a later rebuilt preview would
  correctly notify again). Fixed in `a75c1e8`, verified identically:
  Deno type-check (44/44), lint, the full release gate (same expected
  stop point), every validator referencing `build-business-website` by
  name, all 23 downstream validators, the failure simulator (23/23), and
  the 10-run lifecycle simulation. Also confirmed
  `scripts/patch-provider-capacity-preview.mjs` throwing when run
  directly is expected, deliberate behavior (a one-time code-patch
  script with an idempotency guard that refuses to re-apply an already-
  present change) — not a bug, and not part of `run-release-gate.mjs`
  (only `validate-*.mjs` files run there).
- Continued the audit to the owner-decision stage and found the third and
  highest-priority instance of the same gap: `deny_website_setup()`
  (migration 183) hard-stops a client's pipeline on denial but never
  notifies the client at all — no trigger on `owner_approval_requests`
  covers denial either (the only one, migration 109's
  `owner_approval_queue_storefront_provisioning`, only fires on the
  `accepted` path). A denied client currently has no way to learn their
  pipeline stopped except by manually checking their portal — arguably
  the most important of the three gaps, since it's a rejection notice.
  Unlike the two already-fixed gaps, closing this means changing a
  database function body, which only happens through a new migration —
  a hard stop-and-ask gate even though the fix itself is simple. Asked
  the user; approved to draft a migration for review rather than fix
  silently or just log it. Wrote
  `supabase/migrations/248_notify_client_on_website_setup_denial.sql`:
  re-defines `deny_website_setup()` identically to migration 183 except
  for one `notification_deliveries` insert on the newly-denied path only
  (never on the idempotent already-denied replay), using the same
  established pattern. **Not applied to any database** — staged in the
  repo for review only. Verified everything checkable without a live
  database: migration integrity (215 migrations), the full release gate
  (same expected stop point), all 23 downstream validators, the failure
  simulator (23/23, including 9/9 denial-hard-stop checks specifically),
  and the 10-run lifecycle simulation. Fixed/staged in `6812458`.
- Continued into the domain-connection stage and found a fourth instance:
  `reconcile-domain` never notified the client on either outcome that
  matters to them — the domain fully connecting (same magnitude as the
  already-fixed production-launch notification), or DNS action being
  required at their own registrar (arguably the single most actionable
  gap found this session — nothing progresses until the client manually
  updates DNS, and they had no way to know). This function is polled on
  a schedule (`next_check_at`/`recheck_minutes: 15`) until it succeeds,
  so both new notifications are guarded by a state-transition check
  against the pre-reconciliation `automation_state` fetched earlier in
  the same function, so they fire exactly once per transition, not on
  every 15-minute retry. The `dns_pending` sub-case (registrar already
  connected, just waiting on propagation, no client action needed)
  intentionally gets no notification, matching its own message. Pure
  application-code change, no migration needed. Fixed in `f4b9c40`,
  verified with Deno type-check (44/44), lint, the full release gate
  (same expected stop point), the domain-specific validator (14/14) and
  every other validator referencing `reconcile-domain`, all 23
  downstream validators, the failure simulator (23/23), and the 10-run
  lifecycle simulation.
- Checked the remaining owner-decision-stage communication path —
  `request_targeted_more_info()` (migration 182), the "owner needs more
  detail before approving" flow — and confirmed it is **not** a gap: it
  deliberately inserts into `client_messages` (a real in-portal inbox the
  client reads via `current_client_message_page`, confirmed rendered in
  `ClientPortal.tsx`), and its own code comment explicitly documents
  skipping an external notification as an intentional design choice for
  this pre-approval iterative flow. Good negative result — not every
  "no notification_deliveries insert" hit is a bug.
- Checked billing and maintenance escalation before moving to Commerce.
  Both are already correct, no gap: billing payment failures already
  call `record_billing_notification()` for the client on every failed
  attempt (migration 100); maintenance/uptime/SSL issues correctly
  escalate only to the *owner* internally (`automation_escalations`) —
  the client shouldn't be alarmed by routine infrastructure monitoring
  NXQ is supposed to absorb transparently. The "client isn't told about
  important things" pattern does not extend into these two areas.
- At the user's request, extended the audit into the **Commerce flow**.
  Found the fourth-class instance of the same notification gap:
  `submit_public_commerce_customer_request()` (migration 242's version)
  — the real "customer requests a custom order" form on a Commerce
  storefront — creates a genuine `commerce_customer_requests` row but
  never notifies the client, unlike the exactly parallel Business event
  (`ingest-business-lead` already sends `new_lead`/`urgent_new_lead`
  notifications). Before fixing anything, also checked
  `create_public_protected_commerce_checkout` (migrations 090/091) for
  the same gap and confirmed it is **intentionally excluded, not a bug**:
  it is an explicit test/protected checkout path (`is_test: true`,
  `payment_provider: 'protected_test'`,
  `metadata.no_customer_contact: true`, "no real payment was charged and
  no customer was contacted") — real Commerce purchases go through
  external Stripe Payment Links, not this RPC, so there is no real order
  event being silently missed there. Asked the user about the genuine
  gap (same migration stop-and-ask gate as `deny_website_setup`);
  approved to draft a migration for review. Wrote
  `supabase/migrations/249_notify_client_on_commerce_customer_request.sql`:
  re-defines the function identically except for one
  `notification_deliveries` insert (`template_key:
  "new_commerce_request"`) on the successful-submission path. **Not
  applied to any database** — staged in the repo for review only.
  Verified everything checkable without a live database: migration
  integrity (216 migrations), the full release gate (same expected stop
  point), the Commerce reference-upload contract validator, all 23
  downstream validators, the failure simulator (23/23), and the 10-run
  lifecycle simulation. Fixed/staged in `8424e3f`.

## Completed work in the prior session (through 2026-09-29 checkpoint sync)

The prior handoff entry described the 2026-08-16 audit (migration 222,
classifier runtime v3). Since then, `safe/checkpoint-autonomy-wave35-sales`
has accumulated further hardening, most recently:

- Business-location schema/guard hardening: a run of `fix:` commits
  isolating and classifying Business-location constraint drift, RPC
  failures, write-path failures, and guard validation phases
  (`4336460`, `f66efbc`, `5cd0c55`, `37fbae7`, `f7716a9`, `c38c517`,
  `deb2d08`, `a9d05e4`, `0621650`, and related).
- Paid-capability guard hardening: transaction/rollback stabilization,
  authorization isolation, and economic margin ceiling enforcement
  (`77b8cca`, `a833fae`, `25e6365`, `8e9fd32`, `cb9d908`, `8e94dd3`,
  `369f249`, `79810e5`, `2b86917`).
- Provider health reclassified as control-plane infrastructure
  (`160b59d`), plus scoped CI for a provider-health-only staging deploy and
  a one-shot smoke check (`cc10a47`, `afbbc5f`).
- Latest 5 commits landed by fast-forward to the verified tip:
  - `c36568d` fix: close SSRF gap in generate-business-build-plan provider
    URL check
  - `b7bd71d` fix: centralize constantTimeEqual and use it for
    worker-token checks
  - `be9c2ad` fix: update three stale Commerce reference-upload contract
    checks
  - `ee0c5dc` fix: remove duplicated upstream/internal provider
    secret-name lists
  - `651d1c4` fix: share the workflowStep helper between two contract
    scripts

## Multi-Location status — corrected

A prior instruction in this session incorrectly assumed Multi-Location's
migration/frontend implementation was absent from this branch. That was
checked against the actual repository state and is **false**. As of HEAD
`c36568d`:

- `supabase/migrations/132_enterprise_multi_location_business_foundation.sql`
  (218 lines) defines `client_locations` and `client_location_services`,
  including RLS and constraints.
- `src/pages/ClientBusinessLocations.tsx` is a working client-facing page
  reading through `current_client_locations()`.
- Multiple contract validators actively assert Location schema, RLS, and
  guard behavior: `scripts/validate-tenant-isolation-contract.mjs`,
  `scripts/validate-autonomy-ops-wave25-contract.mjs`,
  `scripts/validate-paid-capability-enforcement-contract.mjs`.
- The most recent commit streak on this branch is active hardening of this
  exact feature (constraint drift classification, guard validation phases),
  not new construction of missing functionality.

**Implication:** Multi-Location does not need to be "rebuilt from a fresh
migration/security plan" — it exists and is under active, incremental
hardening. Any future change to it should be treated as modifying existing
guarded infrastructure (subject to the same migration/external-service
stop-and-ask gate as any other schema change), not as greenfield work.

## Checks run this session

- Git-state verification: `git remote -v`, `git status --short --branch`,
  `git rev-parse HEAD`, `git rev-parse origin/<branch>`,
  `git ls-remote origin refs/heads/<branch>`, `git log --oneline
  --decorate`, followed by `git fetch` + `git merge --ff-only`.
- `npm ci` — clean install, 171 packages, 2 pre-existing `npm audit`
  findings (1 moderate, 1 high) not yet triaged.
- `npm run test:release` (full local release gate) — run twice:
  1. First run: failed at `validate-nxqx-brand-contract.mjs`
     ("public plan cards use NXQ-* names"), 13/14 in that suite. All
     validators before it in alphabetical order passed in full.
  2. After the `e9a6fda` fix: that suite now passes 14/14, and the gate
     progresses through at least 8 more validator suites (Netlify budget,
     NXQ identity, mega-autonomy, maintenance/recovery, growth/outreach,
     launch-hardening, paid-capability enforcement, tenant isolation, and
     others) before stopping at `validate-paid-capability-guards-staging.mjs`
     — a live-Supabase-credential check that fails closed by design without
     `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`, which this container
     does not have.
- The 2026-08-16 entry's "67 contract validators / 189 migrations / 276
  SECURITY DEFINER functions / 35 Edge functions green" claim is still
  **not fully re-verified** — only the portion of the gate before the
  credential-gated validator has been confirmed green at current HEAD.
  Lint, `npm audit --audit-level=high`, `npm run build`, and the bundle
  budget check have not run this session.

## Current product decisions and hard rules in force

From `README.md` (unchanged, still authoritative):

- Signup creates a lead; completed intake creates one owner
  `APPROVE`/`DENY` decision. `DENY` creates no provider infrastructure.
- One `APPROVE` starts an idempotent backend lifecycle; provider retries
  reuse checkpointed resources.
- Supabase is the source of truth; browser code never receives
  service-role credentials or direct control-plane mutation authority.
- Preview and production are distinct; production promotion is
  exact-commit, fast-forward-only, and stays locked until verified.
- Tenant data (files, domains, messages) is read only through
  authenticated tenant-derived boundaries.
- Commerce remains a supported product family and must not be removed
  while Business automation evolves.

From `docs/LAUNCH_HARDENING_CHECKLIST.md` (unchanged):

- Clients purchase/own/renew their own domains; NXQ never holds registrar
  credentials.
- No live email, outreach, billing, provider mutation, or production
  deployment without its configured gate.
- Never use placeholder secrets or fabricated evidence to pass a readiness
  check.

From this session's explicit approval (now encoded in `CLAUDE.md`):

- Stop-and-ask gates: workflows, migrations, external services, secrets,
  deployments, payments, production, destructive actions, material
  compatibility risk.
- Never work directly on `main`.

## Confirmed blockers/risks

- **Production remains blocked**, per prior audits: requires 10 consecutive
  disposable external Business QA runs with real Supabase/GitHub/Netlify
  evidence, recovery proof, and explicit owner signoff. No change here
  alters that.
- **External-provider-dependent work stays blocked** per
  `docs/LAUNCH_HARDENING_CHECKLIST.md`: real AI provider key, real
  notification delivery, production-approved malware scanning, Stripe
  test-mode lifecycle, client-owned production domain DNS/SSL test, fresh
  Netlify build (credits were previously exhausted — do not assume they've
  been restored).
- **Stale git tracking refs are a demonstrated risk in this environment.**
  This session's own initial checkpoint report (`afbbc5f`) was wrong
  because a local `origin/<branch>` ref was stale; the real remote tip was
  `c36568d`. Always `git fetch` and compare against `git ls-remote` before
  reporting a checkpoint as verified.
- **Full local release gate cannot complete in this container without
  staging Supabase credentials.** `validate-paid-capability-guards-staging.mjs`
  fails closed on missing `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`
  by design (see Checks run above). Supplying those is an external-service
  action requiring an explicit decision, not something to do autonomously.
  Whether the gate is fully green beyond that point remains unverified.

## Next 3 highest-priority safe tasks

1. **Review and, if approved, apply both staged migrations**
   (`248_notify_client_on_website_setup_denial.sql` and
   `249_notify_client_on_commerce_customer_request.sql`) through the
   normal guarded staging workflow (`validate_prelaunch` / `apply_all`
   with the exact confirmation phrase). Both are currently only staged
   in the repo, not applied anywhere. Once applied, denied clients and
   Commerce clients receiving new customer requests will get in-app
   notifications they don't currently receive.
2. Ask the user whether `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` for
   the staging project may be provided (as container env vars, never
   pasted into chat/source) so `validate-paid-capability-guards-staging.mjs`,
   `npm run test:staging-evidence`, and the remainder of
   `npm run test:release` can actually run to completion. This is a
   decision point, not an autonomous task — do not proceed past it without
   an explicit answer.
3. Consider drafting (only with explicit user approval, never
   autonomously) a migration to drop or properly lock down
   `commerce_cart_items` — orphaned schema found this session: granted to
   `authenticated` but no RLS policy ever written, unreferenced anywhere
   in `src/` or `supabase/functions/`, superseded by the stateless
   cart-payload checkout flow since migration 090. Not urgent (fails
   closed, no live exposure) but worth cleaning up in a future reviewed
   migration pass. Keep applying the audit technique that found five real
   fixes this session (2 SSRF gaps, a timing-attack gap across 10
   functions, a CORS bug, and 3 missing client notifications across the
   launch flow): pick an established safe pattern already used correctly
   somewhere in the codebase, then check every place that pattern
   *should* apply. Treat any remaining older doc claim as unverified
   until re-checked against current source, not as ground truth.

## Resume instruction for the next Claude session

Before doing anything else: read `CLAUDE.md` in the repository root for
standing operating rules, then this file for current state. Then verify
live git state yourself — do not trust this document's SHA blindly:
`git fetch origin safe/checkpoint-autonomy-wave35-sales`, compare
`git rev-parse HEAD` against `git rev-parse origin/safe/checkpoint-autonomy-wave35-sales`
and against `git ls-remote origin refs/heads/safe/checkpoint-autonomy-wave35-sales`.
Once confirmed current, resume from the "Next 3 highest-priority safe
tasks" list above, honoring the stop-and-ask gates in `CLAUDE.md`.

## One-time staging setup

1. Review the latest safe checkpoint on the safe branch. Do not merge it to
   `main` yet.
2. Create a separate hosted Supabase staging project. Do not point
   `nxq-staging` at production.
3. Create the GitHub Environment named `nxq-staging` with:
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_DB_PASSWORD`
4. Add the Edge secret names required by `business-prelaunch` to the
   staging Supabase project. This profile checks every Business launch
   secret except `NXQ_AI_MODEL_PROVIDER_TOKEN`. `NXQ_RUNTIME_ENVIRONMENT`
   must have the value `staging`. Print the exact names without values
   with:

   ```bash
   node scripts/edge-function-manifest.mjs --profile=business-prelaunch
   ```

   The local machine check is authoritative for manifest/auth consistency:

   ```bash
   npm run test:runtime-stage
   ```

   The shared AI model provider requires exactly these four protected Edge
   secret names:

   - `NXQ_AI_MODEL_PROVIDER_URL`
   - `NXQ_AI_MODEL_PROVIDER_TOKEN`
   - `NXQ_AI_MODEL_PROVIDER_MODEL`
   - `NXQ_AI_MODEL_PROVIDER_PROTOCOL`

   For an OpenAI Responses configuration, set the URL to the provider's
   Responses endpoint and the protocol to `openai_responses`. Store the API
   key only in Supabase Edge secrets; never paste it into chat, source,
   logs, workflow inputs, or a committed environment file. The selected
   model must support strict structured outputs.

   Provider readiness also uses two first-party, protected adapter
   functions. Point each adapter URL at the matching function in the same
   staging project and use a separate randomly generated adapter token.
   Never reuse the automation worker token or place any value in source,
   GitHub workflow inputs, or chat.

   Notification delivery requires:

   - `NXQ_NOTIFICATION_ADAPTER_URL` → the hosted `notification-provider-adapter` function
   - `NXQ_NOTIFICATION_ADAPTER_TOKEN`
   - `NXQ_RESEND_API_KEY`
   - `NXQ_NOTIFICATION_FROM_EMAIL`

   Malware scanning requires:

   - `NXQ_MALWARE_SCAN_ADAPTER_URL` → the hosted `malware-scan-provider-adapter` function
   - `NXQ_MALWARE_SCAN_ADAPTER_TOKEN`
   - `NXQ_CLOUDMERSIVE_API_KEY`

   The default Cloudmersive adapter limit is 3,500,000 bytes so the
   evaluation tier fails closed before an unsupported upload. A later paid
   plan may use the optional `NXQ_MALWARE_ADAPTER_MAX_BYTES`, capped by NXQ
   at 100 MiB. File access remains restricted unless the provider returns
   valid clean evidence and the independently computed SHA-256 matches.

   Merely adding these names cannot make readiness green. Notification
   readiness requires a real successful delivery within 30 days.
   File-security readiness requires real provider success plus a released
   clean scan within 30 days. The generic provider-health worker
   deliberately preserves those activity-owned statuses instead of
   fabricating health from configuration.

5. Before the real AI key is available, run **NXQ Manual Supabase Stage**
   with action `validate_prelaunch`. It links staging, dry-runs migrations,
   and proves every other launch secret name is present without changing
   the database.
6. Run `validate_zero_key` while the challenge, malware-scan, and external
   notification providers are intentionally unavailable. This validates
   the existing public analytics/lead endpoints and fingerprint salt
   without accepting fake adapter values. `validate_prelaunch` must
   continue to fail on those nine adapter/provider names until real
   providers are connected.
7. Run `validate_non_ai` while using the temporary staging fallback. Only
   after the real provider token is added should `validate` and
   `apply_all` be allowed to pass. `apply_all` requires confirmation
   `APPLY-NXQ-SUPABASE-STAGING`; confirm every pending migration is
   included before deploying the client portal and changed Edge functions.
8. Sign into the staging Owner Portal, open **Launch readiness**, and
   choose **Configure staging runtime routes**. Confirm the exact phrase
   shown by the dialog.
9. Refresh Provider Health and request checks for the configured
   providers. Missing provider secret names stay visible; no secret value
   is displayed.
10. Re-check provider capacity before retrying any pending preview. Do not
    blindly create a replacement site or deploy if Netlify build credits
    are exhausted.
11. Start one disposable DENY-path QA run and prove zero infrastructure.
12. Start disposable APPROVE-path QA runs one at a time until ten strict
    external runs pass. Do not count local simulations as external
    evidence.

## Plug-in-and-launch sequence

When Netlify production deployments resume and the model-provider token is
available:

1. Add or replace only `NXQ_AI_MODEL_PROVIDER_TOKEN` in protected Supabase
   Edge secrets. Never place it in GitHub, chat, source, logs, or workflow
   inputs.
2. Run `validate`; it must pass the strict `business-external-qa` profile.
3. Run `apply_all` with the exact staging confirmation, then configure
   staging runtime routes from Owner Launch Readiness.
4. Prove a real provider call and healthy worker/provider evidence.
5. Complete one DENY-path run and ten consecutive APPROVE-path external
   runs without duplicate infrastructure, crossed tenant data, or manual
   rescue.
6. Review the production change, provide explicit owner signoff, and make
   a separate production launch decision. No earlier step merges or
   publishes production.

## Future one-session provider hookup

NXQ can remain safely staged until the provider accounts are available.
The Owner Portal **Launch readiness** page now carries the same
secret-name-only checklist. It does not collect, store, or display any
secret value.

Prepare the accounts in this order:

1. Under separate staging-mutation authorization, run
   `configure_internal_provider_adapters` with the exact workflow
   confirmation. It derives the four first-party function URLs and
   generates four independent adapter tokens. It sets
   `NXQ_NOTIFICATION_ADAPTER_URL`, `NXQ_NOTIFICATION_ADAPTER_TOKEN`,
   `NXQ_MALWARE_SCAN_ADAPTER_URL`, `NXQ_MALWARE_SCAN_ADAPTER_TOKEN`,
   `NXQ_PROVIDER_HEALTH_ADAPTER_URL`, `NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN`,
   `NXQ_BUILD_PLAN_AI_ADAPTER_URL`, and `NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN`
   together without printing their values. The temporary secret file is
   removed before the job ends. Because the provider-health scheduler may
   begin read-only GitHub/Netlify checks after configuration, do not run
   this action without explicit authorization for those resulting calls.
2. Notification delivery: verify the sender domain and obtain a
   sending-only key. Add only `NXQ_RESEND_API_KEY` and
   `NXQ_NOTIFICATION_FROM_EMAIL` directly to protected Supabase staging
   Edge secrets.
3. Malware scanning: obtain a file-scanning key. Add only
   `NXQ_CLOUDMERSIVE_API_KEY` directly to protected Supabase staging Edge
   secrets.
4. AI classification and planning: choose a strict-structured-output
   model. Add only `NXQ_AI_MODEL_PROVIDER_URL`, `NXQ_AI_MODEL_PROVIDER_TOKEN`,
   `NXQ_AI_MODEL_PROVIDER_MODEL`, and `NXQ_AI_MODEL_PROVIDER_PROTOCOL`
   directly to protected Supabase staging Edge secrets.

Then configure staging runtime routes from Owner Launch Readiness, open
Provider Health, and recheck the connections. Real notification, scanning,
AI, evidence, or QA activity remains a separate explicitly authorized step.
Never put a provider value in chat, source, logs, workflow inputs, or a
committed environment file.

## Production remains blocked

Production still requires the ten strict external staging runs,
healthy provider/worker evidence, recovery proof, owner signoff, a separate
production change review, and an explicit production deployment decision.
The staging workflow cannot merge a branch, publish Netlify production,
change DNS, enable billing, or mark QA evidence passed.
