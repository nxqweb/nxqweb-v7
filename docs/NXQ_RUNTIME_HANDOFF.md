# NXQ runtime handoff (canonical)

This is the live, authoritative handoff document for `nxqweb-v7`. Read
`CLAUDE.md` first for standing operating rules, then this file for current
state. Update this file, not a new one, at every handoff.

## Current checkpoint — 2026-09-29

- **Branch:** `safe/checkpoint-autonomy-wave35-sales`
- **HEAD:** `e9a6fda` — "fix: list all NXQ-* product family names on public
  plans page"
- **Working tree:** clean, pushed to `origin`, no divergence.
- This checkpoint was reached by fetching and fast-forward merging from a
  stale local cache that had lagged the real remote tip
  (`afbbc5f` → `c36568d`), then one further local commit
  (`a94cc2e` → `e9a6fda`) — see "Confirmed blockers/risks" for why stale
  tracking refs must always be refreshed before trusting a reported HEAD.

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
- **Not yet exercised this session:** everything after that validator in
  `scripts/run-release-gate.mjs` — remaining `validate-*.mjs` files,
  `check-runtime-stage-readiness.mjs`, `check-migration-integrity.mjs`,
  `simulate-autonomy-failures.mjs`, lifecycle/security/accessibility/edge
  tests, lint, `npm audit`, build, routes, and bundle-budget check. These
  are unverified against current HEAD until the credential-gated check is
  either supplied credentials (external-service decision, not autonomous)
  or the gate is otherwise addressed.

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
   pasted into chat/source) so `validate-paid-capability-guards-staging.mjs`
   and the remainder of `npm run test:release` can actually run to
   completion. This is a decision point, not an autonomous task — do not
   proceed past it without an explicit answer.
2. Independently of #1: run the individual local-only checks that do not
   need staging credentials and are not gated by the failing validator —
   e.g. `npm run lint -- --max-warnings=0`, `npm run build`,
   `npm run test:security`, `npm run test:accessibility`,
   `npm run test:edge`, `node scripts/check-migration-integrity.mjs` — by
   invoking them directly rather than through `test:release`, to get real
   signal on the rest of the gate while the credential question is open.
3. Audit `docs/LAUNCH_HARDENING_CHECKLIST.md` against current contract
   validator coverage to confirm no row has silently regressed since
   2026-08-16, and correct any other stale claims found (the Multi-Location
   correction and the brand-contract bug both show older docs/assumptions
   need a fresh read-the-code pass before being repeated).

## Resume instruction for the next Claude session

Before doing anything else: read `CLAUDE.md` in the repository root for
standing operating rules, then this file for current state. Then verify
live git state yourself — do not trust this document's SHA blindly:
`git fetch origin safe/checkpoint-autonomy-wave35-sales`, compare
`git rev-parse HEAD` against `git rev-parse origin/safe/checkpoint-autonomy-wave35-sales`
and against `git ls-remote origin refs/heads/safe/checkpoint-autonomy-wave35-sales`.
Once confirmed current, resume from the "Next 3 highest-priority safe
tasks" list above, honoring the stop-and-ask gates in `CLAUDE.md`.

## Original one-time staging setup and provider hookup sequence

The staging setup steps, protected Edge secret names, and the
plug-in-and-launch sequence previously documented here are unchanged and
still apply. They are preserved in full detail in the project's
`docs/STRIPE_LAUNCH_RUNBOOK.md`, `docs/GROWTH_AND_OUTREACH_LAUNCH_RUNBOOK.md`,
and `docs/LAUNCH_HARDENING_CHECKLIST.md`, and in
`scripts/edge-function-manifest.mjs --profile=business-prelaunch`. Consult
those rather than duplicating secret-name lists here, to avoid this file
drifting out of sync with the scripts that are the actual source of truth
for required secret names.

Production remains blocked pending the ten strict external staging runs,
healthy provider/worker evidence, recovery proof, owner signoff, a separate
production change review, and an explicit production deployment decision.
The staging workflow cannot merge a branch, publish Netlify production,
change DNS, enable billing, or mark QA evidence passed.
