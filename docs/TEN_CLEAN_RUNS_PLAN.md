# Ten clean runs: the schedule and the traps (rewritten 2026-11-04 after reading the owner's Launch readiness page)

**Status: PLAN ONLY.** This does not start anything. The step-by-step for ONE run is `docs/QA_RUN_RUNBOOK.md`. The map of all 26 required checks, and what the other 11 need, is `docs/READINESS_GATE_MAP.md`. This file covers only the ten-runs check: what really counts, what it costs, what will stop it, and a calendar.

**Correction to an earlier version of this plan and to `docs/QA_RUN_RUNBOOK.md`:** the runbook used to suggest mixing in DENY runs ("8 APPROVE and 2 DENY"; it now carries a correction note). The counter does not work that way. `count_strict_clean_business_runs()` (migration 181) counts only runs with `test_kind = 'business_e2e'`, `target_outcome = 'approve'` and `monitor_version = 'disposable-business-v2'` whose strict evidence flags are all true. **DENY runs do not count toward the ten.** They feed a separate check (`deny_flow_passed`), which is already green. So the ten must all be approve runs, and no more DENY runs are needed.

## Where it stands (the owner's page, 2026-11-04)
The page lists eight runs. It does not show the counter, so the count below is from the handoff notes, not from the page.
| # | Started | Kind | Run code | Result |
|---|---|---|---|---|
| 1 | 2026-08-18 | DENY | QA-5FFA8E8CD185 | passed (feeds `deny_flow_passed`; does not count toward ten) |
| 2 | 2026-08-18 | APPROVE | QA-1BB60A84DD4F | failed |
| 3 | 2026-08-22 | APPROVE | QA-8E1612E7D953 | failed |
| 4 | 2026-08-23 | APPROVE | QA-3BC433C6634E | passed (may or may not count: the page does not say which monitor version it used) |
| 5 | 2026-10-06 | APPROVE | QA-B0605777AAEA | failed |
| 6 | 2026-10-06 | APPROVE | QA-8CC192C8705A | failed |
| 7 | 2026-10-07 | APPROVE | QA-E45F85D69C9A | **passed** (the handoff counts this as the first clean run, "1 of 10") |
| 8 | 2026-10-07 | APPROVE | QA-16A49D9B4A3E | failed (ended 14 minutes after it started; the `stop_builds` fix hit a Netlify 400, fixed the same day, redeployed with all 44 functions on 2026-10-22, never run since) |
**No run is "running" now, so both Start buttons work.** Plan for **nine more approve passes** (eight if the August 23 pass counted). The count is total passes; a failure does not reset it. The evidence of the running count is `strict_clean_business_e2e_runs` inside the `ten_clean_runs` check.

## The traps (all found in the repo or on the page)
1. **DENY runs do not count** (above).
2. **The Netlify build guard.** `nxq_netlify_budget_settings` defaults to `max_builds_per_cycle = 4` and `max_qa_builds_per_cycle = 2` (migration 234). An approve run reserves a preview and a production build (and, until the `stop_builds` fix is proven, a third), so the defaults give about **one approve run per cycle**. The current staging values are not recorded anywhere; read them first. No screen in the app changes them. The owner function `owner_update_netlify_budget_settings(...)` checks `auth.uid()`, which is empty in the Supabase SQL editor, so from there use a plain table update, as was done for the cost cap: first `select * from public.nxq_netlify_budget_settings;`, then (owner's choice of numbers) `update public.nxq_netlify_budget_settings set max_builds_per_cycle = 15, max_qa_builds_per_cycle = 15, updated_at = now() where singleton = true;` (the QA number may not exceed the cycle number). The alternative is a small owner screen that calls the function with the owner's own login (see below).
3. **Netlify credits, and they lag.** Measured on 2026-10-07: a new QA site cost about **45 credits** (Netlify ignored `stop_builds` at site creation, so the site made two production deploys by itself, plus the promotion). The fix expects about 15-30, unproven until a run measures it. Netlify's billing page today carries a banner: "We are experiencing some issues with our billing systems. Credit consumption reporting may be delayed." It read **209.5 of 300** (the cycle runs Oct 23 to Nov 22). A stale reading is how the team ran out on 2026-10-07, so: read before, read again five minutes after each run, and start the next run only when two readings agree.
4. **The platform cost cap.** Staging's `nxq_platform_cost_settings` is `monthly_limit_cents = 500` ($5). QA clients draw every paid job from it (an estimated 30-40 cents per run), and billing and alert emails draw on it too. If a run stalls with a cost-blocked error, check this first; raising it is the owner's decision.

5. **The monthly platform cost pool is drained on the 1st by maintenance of old disposable QA clients (FOUND 2026-11-04, first measured run).** The run `QA-842A688FA6D1` stalled at its third step: `prepare_build_plan` and `provision_project_infrastructure` sat `queued, attempts 0` with "Skipped by billing guard: PLATFORM_COST_BLOCKER: monthly platform cost limit reached" (so no Netlify credits were spent). A read-only query of `nxq_platform_cost_reservations` for November showed **500 reservations, all `qa:technical_maintenance`, 1 cent each = 500 cents, the last at 2026-11-01 00:49 UTC**: the whole $5 cap was used within the first hour of the month. Cause: `nxq_guard_maintenance_transition` (migration 246) reserves 1 cent every time a `website_maintenance_tasks` row for a QA-only client goes to `running`, and the monthly maintenance for the leftover disposable QA clients made 500 attempts at the start of November. It will recur every month. Estimated cost per run is only about 21 cents (prepare_build_plan 10, provisioning 2, safe branch 5, previews and checks 1-2 each). Options: (a) raise `monthly_limit_cents` (estimates only: no paid AI or email provider is connected, so real spend is $0; reversible); (b) stop old disposable QA clients' maintenance (owner row edits); (c) a migration that stops QA maintenance drawing from the pool (gated product decision). Unblocking by (a) is the quick path; (b) or (c) removes the monthly recurrence.

## Credit calendar for nine approve runs (unverified until one run is measured; keep a 60-credit reserve)
| Per-run cost | This cycle (to Nov 22): 209.5 - 60 = 149.5 usable | Next cycle (Nov 23 to Dec 22): 240 usable | Nine runs done |
|---|---|---|---|
| 45 credits (as measured before the fix) | 3 runs (135) | 5 runs (225) = 8 total | the ninth falls in the cycle starting Dec 23 |
| 30 credits (if the fix works) | 4 runs (120) | 5 runs (150) = 9 total | late November to early December |
Creators' real sites cost the same credits, and a clean run uses a real GitHub repo and Netlify site each time. A bigger Netlify plan (decision A7 in `docs/REAL_LAUNCH_GATE.md`; Personal was about $9 for 1,000 credits, unverified) would let all nine run within about two weeks, but it is a paid step against the spending hold. The free-plan schedule above still fits the "launch-ready by about Jan 4" target.

## Before the FIRST run
- [x] **Build guard raised (2026-11-04, owner, Supabase Table Editor):** it was the default 4 builds and 2 QA builds; both are now **12**. To go back, set 4 and 2.
- [x] **Cost cap read (2026-11-04):** `enabled` true, `emergency_stop` false, `monthly_limit_cents` 500. Enough for about a dozen runs at an estimated 30-40 cents each.
- [x] **Credits "before" (2026-11-04):** 209.5 of 300 at 10:50 AM and again at 11:41 AM, so the reading is stable (Netlify still warns reporting may be delayed). Read it again right before the run.
- [x] **Pre-flight `validate_foundation` PASSED (2026-11-04, workflow run #279, head `b62fd20`, owner approved `nxq-staging`, Claude read the log):** migration dry run says "Remote database is up to date" (nothing pending); all 17 required Edge secret names present (names only); manifest covers all 45 Edge functions exactly; all 26 `architecture-*` contract checks pass against the live staging database; it changed nothing. **`validate_non_ai` ALSO PASSED (workflow run #280, head `9a3700d`, same approval and log reading):** "Remote database is up to date", all 21 required secret names for `business-non-ai-staging` present (the larger list a real approve run needs, including the GitHub and Netlify names), 45 functions, 26 architecture checks, nothing changed. `validate_prelaunch` is NOT the right pre-flight for this zero-key setup: it requires every launch secret except the model-provider token, so it would fail on the Resend and scanner names you do not have.
- [ ] The runbook's own preconditions (`validate_prelaunch` passing, the current frontend live on staging, owner login works, no run already running: true today).
- [ ] Claude: `git fetch`, parity 74/74 on the branch tip (it includes `npm run test:netlify-builds-stopped`, the guard for the `stop_builds` fix).

## For every run
1. Owner: **Start APPROVE-path QA**, then approve it in the approval queue (`/owner/preview-requests`, client "NXQ QA Disposable ..."), then do nothing else; any manual rescue makes the run not clean. 2. Owner: when it ends, screenshot the run's row on Launch readiness, and the Netlify credits five minutes later. 3. Claude: records it in the ledger below and compares credits before and after. 4. Only then the next run, one at a time (a run takes roughly one to one and a half hours; run #7 took about an hour).
**If a run fails:** stop. Do not retry blindly and do not delete anything. Send Claude the run code (`QA-...`), the phase and the error text. Claude finds the cause and fixes it on the branch with a test and a green parity; a function change then needs an approved `deploy_functions` run before the next attempt.

## Ledger (new runs; the history above is the older record)
| Run # | Date | Run code | Result | Credits before | Credits after (5 min later) | Notes |
|---|---|---|---|---|---|---|
| 9 | 2026-11-04 12:53 PM | QA-842A688FA6D1 (`business-launch-20261104 #1`) | STALLED at step 3 by PLATFORM_COST_BLOCKER (approved ~1:00 PM; no Netlify credits spent; see trap 5) | 209.5 of 300 (page headline "210"), 0/1 concurrent builds, read just before starting; Netlify banner said reporting may be delayed | (pending) | First measured approve run since the `stop_builds` fix. Claude holds all pushes to the repo while it runs, because `build-business-website` reads the template from this repo at `NXQ_AUTOMATION_SOURCE_REF`. |

## What Claude can do meanwhile, without any approval
- **BUILT 2026-11-04, on the branch but NOT on the site yet:** the owner screen `/owner/netlify-budget` (`src/pages/OwnerNetlifyBudget.tsx`, helpers in `src/lib/netlifyBudget.ts`). It shows this cycle's counted builds against the limits (total and QA, with how many approve runs fit) and changes the limits through the existing owner function with a confirm box that lists exactly what changes; the emergency stop warns that real clients are affected. No migration. Tests: `scripts/test-netlify-budget-screen.mjs` (inside `npm run test:store`, with planted-bug controls) and the browser check `scripts/manual/netlify-budget-e2e.mjs` (13 checks and an axe scan, mocked database). It appears on the live site only with the next site build; until then the Supabase table edit above does the same job.
- Keep the ledger and read each result from the owner's screenshots (the owner pages need a login, so Claude cannot open them).

## After the tenth pass
The `ten_clean_runs` check turns ready within five minutes. The sign-off still waits on every other required check, in the order set out in `docs/READINESS_GATE_MAP.md`; the six expiring evidence checks come last, in the final week.
