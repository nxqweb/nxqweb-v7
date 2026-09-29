# NXQ runtime handoff (canonical)

This is the live, authoritative handoff document for `nxqweb-v7`. Read
`CLAUDE.md` first for standing operating rules, then this file for current
state. Update this file, not a new one, at every handoff.

## Current checkpoint — 2026-09-29

- **Branch:** `safe/checkpoint-autonomy-wave35-sales`
- **HEAD:** `f2b18e4` — "feat: wire capability classification rules into
  change-request pipeline"
- **Working tree:** clean, pushed to `origin`, no divergence.
- This checkpoint was reached by fetching and fast-forward merging from a
  stale local cache that had lagged the real remote tip
  (`afbbc5f` → `c36568d`), then several further local commits ending at
  `f2b18e4` — see "Confirmed blockers/risks" for why stale tracking refs
  must always be refreshed before trusting a reported HEAD.

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

1. Ask the user whether `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` for
   the staging project may be provided (as container env vars, never
   pasted into chat/source) so `validate-paid-capability-guards-staging.mjs`,
   `npm run test:staging-evidence`, and the remainder of
   `npm run test:release` can actually run to completion. This is a
   decision point, not an autonomous task — do not proceed past it without
   an explicit answer.
2. Audit `docs/LAUNCH_HARDENING_CHECKLIST.md` against current contract
   validator coverage to confirm no row has silently regressed since
   2026-08-16, and correct any other stale claims found. Four real
   discrepancies were found and fixed by simply reading the code this
   session (Multi-Location status, the brand-contract check, the
   zero-key/Stripe checks, and my own handoff-doc regression) — treat
   every older doc claim as unverified until re-checked against current
   source, not as ground truth.
3. With the entire credential-independent release gate now green (see
   "Completed work" above), the next real leverage is external: decide
   with the user whether to pursue staging-credential setup (task #1) or
   continue hardening/auditing code in the meantime. Absent a new signal,
   default to task #2 in a loop — the codebase has repeatedly turned out to
   have small, real drift between docs/tests and source that only surfaces
   by actually running things and reading the code, not by assuming green.

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
