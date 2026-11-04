# Ten clean runs: the schedule and the traps (written 2026-11-04)

**Status: PLAN ONLY.** This does not start anything. The step-by-step for ONE run is `docs/QA_RUN_RUNBOOK.md` (read it first; it is correct); the rule and the signoff are in the "Canonical launch checklist" in `docs/NXQ_RUNTIME_HANDOFF.md` and `docs/LAUNCH_HARDENING_CHECKLIST.md`. This file adds what the runbook does not: how many credits the runs really cost, the limits that will stop you, and a calendar. Local simulations (`npm run test:lifecycle`) do not count; only real runs with Supabase, GitHub and Netlify evidence do.

## Where it stands (from the handoff, 2026-10-07 entries)
- **1 of 10 done:** run #3 `QA-E45F85D69C9A`, 2026-10-07, `strict_evidence_passed` (APPROVE path).
- Runs #1 and #2 failed (they pointed at real bugs, since fixed). **Run #4 `QA-16A49D9B4A3E` stalled** at `provision_project_infrastructure`: the new `stop_builds` fix got a 400 from Netlify. A corrected version (PATCH only the one field, and show Netlify's own message on failure) was committed that day; all 44 staging functions were redeployed on 2026-10-22 (run #267), so it should be live, but **nobody has run it since**. Whether run #4 is still stuck as "running" is unknown from here.
- **Need 9 more clean runs.** The runbook suggests mixing both paths; with 1 APPROVE already done, a sensible mix is **6 APPROVE + 3 DENY**.

## The three traps (all found in the repo, all stop runs silently if ignored)
1. **The Netlify build guard.** `nxq_netlify_budget_settings` defaults to `max_builds_per_cycle = 4` and `max_qa_builds_per_cycle = 2` (migration 234). An APPROVE run reserves at least a preview and a production build, so with the defaults you get about **one APPROVE run per billing cycle**. It is raised by the owner-only function `owner_update_netlify_budget_settings(enabled, emergency_stop, max_builds_per_cycle, max_qa_builds_per_cycle)`; **no screen in the app calls it**, so today it is a SQL paste by the owner. The current values on staging are unknown from here (a note says the cap "was raised by a small owner-approved change", but no value is recorded). Read them first with `owner_netlify_budget_status()`.
2. **Netlify credits.** Measured, not guessed: before the fix, a new QA site cost about **45 credits** (two production deploys at creation, because Netlify ignored `stop_builds` inside the site-creation call, plus the promotion deploy). The fix expects about 15-30 per site, but its real effect is unproven until a run measures it. Netlify's usage page **lags by minutes**: on 2026-10-07 a stale reading let run #4 start with no credits left and the team ran out. Rule: read credits fresh, wait a few minutes after each run, and never start the next run until two readings agree. DENY runs build nothing, so they cost 0 credits.
3. **The platform cost cap.** Staging's `nxq_platform_cost_settings` was unlocked at `monthly_limit_cents = 500` ($5) because QA clients draw every paid job from it. Estimated 30-40 cents per full run, so ten runs fit, but billing and owner alert emails draw on it too. If a run stalls with a "PLATFORM_COST_BLOCKED" style error, this is the first suspect; raising it is the owner's decision.

## Credit arithmetic (unverified until one run is measured)
| | Credits |
|---|---|
| Free plan per cycle | 300 (resets on the 22nd/23rd; the page said Nov 22) |
| Left on 2026-11-04 | 209.7 |
| Reserve to keep for fixes and the main site | 60 |
| One APPROVE run, worst case (as measured before the fix) | about 45 |
| One APPROVE run, if the fix works | about 15-30 |
| One DENY run | 0 |
Six APPROVE runs cost **90-270 credits** depending on whether the fix works. That alone can eat a whole cycle, and creators' real sites draw on the same 300. **So the credits, not the code, decide the calendar.** A bigger Netlify plan (decision A7 in `docs/REAL_LAUNCH_GATE.md`; Personal was about $9 for 1,000 credits, unverified) would remove this squeeze, but it is a paid step that conflicts with the spending hold; the alternative is spreading the runs over two or three cycles.

## Suggested calendar (the dates assume every run is clean; failures push everything back)
| Window | Credits available | Runs | Credit cost (worst case) |
|---|---|---|---|
| Now to Nov 22 | 209.7 (keep 60) | Measure first: 1 APPROVE, then if the fix works 2 more; plus all 3 DENY runs | 45 per APPROVE, 0 per DENY |
| Nov 23 to Dec 22 | 300 (keep 60) | The remaining APPROVE runs (up to 3 at 45 = 135) | leaves room for the main site and the first creators |
Done by about the first week of December if nothing fails, which fits the "launch-ready by about Jan 4" target. Creators' sites should wait until the runs are done or until credits are bought, so they do not starve the runs (or the reverse).

## Before the FIRST run (checklist; each item is the owner's or a read-only check)
- [ ] Open `/owner/launch-readiness`: is any run still "running" (run #4)? The Start buttons are disabled while one is. If run #4 is stuck, do not dispatch workers for it blindly (each wake burns one of its 5 attempts); send Claude a screenshot first.
- [ ] Read the build guard (`owner_netlify_budget_status()`) and, if it is still 4 and 2, raise it for the test window (owner SQL, or a small owner screen: see the option below).
- [ ] Read the platform cost cap and this month's use; raise only if needed.
- [ ] Fresh Netlify credits reading (Team -> Billing), wait five minutes, read again.
- [ ] The runbook's own preconditions (`validate_prelaunch` passing, current frontend live on staging, owner login works).
- [ ] Claude: `git fetch`, parity 74/74 on the branch tip, and the guard `npm run test:netlify-builds-stopped` (it is inside parity) passing.

## For every run (the loop)
1. Owner: start it (APPROVE or DENY), then approve or deny it in `/owner/preview-requests`, then do nothing else ("manual rescue" makes a run not clean). 2. Owner: screenshot the run's row on Launch readiness when it ends, and the Netlify credits a few minutes later. 3. Claude: records it in the ledger below, compares credits before and after, and writes down anything odd. 4. Only then the next run, one at a time.
**If a run fails:** stop. Do not retry blindly, do not delete anything. Send Claude the run code (`QA-...`), the phase and the error text. Claude finds the cause, fixes it on the branch with a test and a green parity; any function change then needs an approved `deploy_functions` run before the next attempt. A failure is a reason to fix first, not to keep clicking.

## The ledger (fill in as you go)
| # | Date | Path | Run code | Result | Credits before | Credits after | Notes |
|---|---|---|---|---|---|---|---|
| 3 | 2026-10-07 | APPROVE | QA-E45F85D69C9A | strict_evidence_passed | n/a | n/a | the one clean run so far |
| 4 | 2026-10-07 | APPROVE | QA-16A49D9B4A3E | stalled: stop_builds PATCH 400 | n/a | n/a | fix committed; status today unknown |
| 5 |  |  |  |  |  |  |  |

## What Claude can do meanwhile, without any approval
- Build a small **owner screen for the build limit** (`/owner/netlify-budget`) that shows `owner_netlify_budget_status()` and lets the owner change the limits with a confirm step. No migration is needed (both functions already exist and are granted). It would reach the site only with one build, so it is optional; pasting the SQL once is the zero-credit alternative.
- Keep this ledger and the evidence, and read each run's result from your screenshots (the owner pages need a login, so I cannot open them).

## After the tenth clean run
Refresh Launch readiness until `ten_clean_runs` reads ready. The other readiness checks must also be ready (backup and restore drill, storage and RLS isolation suites, a clean malware scan, the SEO publish lane), and only then does "Approve autonomous launch readiness" unlock. That records the owner's signoff; it deploys nothing and contacts nobody (`docs/QA_RUN_RUNBOOK.md`).
