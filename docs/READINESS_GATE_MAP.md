# Launch readiness gate map: what each of the 26 required checks needs (written 2026-11-04 from the owner's page)

**Source:** the owner's `/owner/launch-readiness` page, pasted at 10:50 AM on 2026-11-04, plus the migrations that define each check. **Status: this is the product's own evidence gate** (`launch_readiness_checks`, migrations 134, 170, 181, 228, 237). On that page: **required ready 14 of 26, readiness 54%, blocking/unknown 12**. Those numbers are the page's own count of ready required checks, not an estimate. The canonical checklist in `docs/NXQ_RUNTIME_HANDOFF.md` stays the place that tracks code, migrations and live verification separately.

## The 14 that are ready
Schedulers and cron healthy; domain reconciliation runtime; notification digest scheduler; privacy request processor; GitHub App connection; Netlify connection; provider health monitor; **DENY hard-stop test** (evidence from 2026-08-18); backup/restore simulation; weekly recovery drill; required migrations applied; Vault worker URLs and tokens; client file scanner runtime; Business SEO artifact worker. (One more row, the online billing provider adapter, is optional and shows "not applicable", so **live Stripe is not a required check**.)

## The 12 that are unknown, grouped by what unblocks them
| Group | Checks (check key) | What clears it | Needs money or keys? |
|---|---|---|---|
| **A. Keys and accounts (3)** | Notification dispatcher runtime (`notification_pipeline_ready`); Website change classifier healthy (`change_classifier_ready`); Business AI build-plan enrichment proven (`business_build_plan_ai_ready`) | Resend API key plus a verified sender domain, then one authorized staging email; an AI provider token, then one staging classification and one validated AI build plan. The page calls these "add later". | **Yes** (Resend needs a verified domain; the AI key is a provider account) |
| **B. Expiring staging evidence (6)** | Workers deployed (`workers_deployed`); Business template repository ready (`business_template_ready`); Storage isolation (`storage_isolation_passed`); Tenant RLS isolation (`rls_isolation_passed`); Domain/SSL flow (`domain_flow_passed`); Maintenance and recovery flow (`maintenance_passed`) | A fresh evidence run: the guarded `deploy_functions` action (and its coverage check), then `run_evidence_suite`. They show `nxq-staging-evidence-expiry-v2` because the earlier proof **expired**. | No, but each is a guarded workflow run with the owner's typed phrase and Approve click |
| **C. A heartbeat (1)** | Business SEO publish lane healthy (`business_seo_publish_lane_ready`) | "Complete a staging SEO publish-lane heartbeat without touching production." Probably the same `run_evidence_suite` run: the suite records the SEO publish-lane result inside the `workers_deployed` evidence. Not confirmed; check the page after that run. | No |
| **D. The ten runs (1)** | Ten clean end-to-end disposable runs (`ten_clean_runs`) | Ten passed **approve** runs; see `docs/TEN_CLEAN_RUNS_PLAN.md` | Netlify credits |
| **E. The sign-off (1)** | Owner explicitly approved launch (`owner_launch_signoff`) | The page says it "unlocks only after every other required readiness check is ready". It records governance evidence only; it deploys nothing. | n/a |

## Three facts that decide the schedule
1. **Group B evidence lasts 7 days.** The evidence suite records all six results with a 7-day expiry (`supabase/functions/run-staging-evidence-suite/index.ts`, the `expiresAt` constant; the database allows at most 30; the one-hour value in that file belongs to a temporary test-file fixture, not to evidence). So these six are the LAST things to run, in the final week before sign-off. Running them now only makes them go stale again.
2. **The sign-off cannot unlock while Group A is unknown.** The gate treats the three key-dependent checks as required, so with no Resend and no AI key the final button stays locked. That conflicts with "everything ready except API keys and live Stripe". See the decision below.
3. **Only approve runs count toward the ten** (`count_strict_clean_business_runs()` in migration 181: `test_kind = 'business_e2e'`, `target_outcome = 'approve'`, `monitor_version = 'disposable-business-v2'`, strict evidence flags all true). DENY runs feed the separate, already-green DENY check. The count is total passes; a failed run does not reset it.

## Decision for the owner: what to do about Group A (real product decision)
The gate already has a way to say "not needed in this launch mode": the optional billing row is stored with `required = false` and status `not_applicable` (migration 172), and the page shows "Not required in the current launch mode."
- **Option A: keep the gate strict.** Get a no-card AI key for staging (your notes say a free provider key is acceptable for TESTING with fake data only) and a Resend account with a verified domain, then prove both on staging. Launch only when they are green. Costs a domain and effort; nothing is relaxed.
- **Option B: launch in a stated "manual mode".** Mark the three Group A checks not required for the launch (the AI Desk copy-paste replaces AI planning and classification, and email stays off), with the reason written in the row. A small change (a migration or an owner SQL statement, so it is gated) and it changes what "launch-ready" means, which is your call. The AI key and Resend then become post-launch upgrades.
- **Option C: relax only the AI pair, keep email required** (or the reverse), if you want one of them proven before launch.
**My recommendation is Option B for June 16, given the spending hold**, as long as the page keeps saying plainly which checks were waived. But it is a statement about what you are promising launch customers, so it should be your decision, in writing, not mine.

## Recommended order
1. **Now to about early December:** the nine remaining approve runs (credits and the build guard decide the pace).
2. **Before the final week:** decide Group A (A, B or C above), and if Option A, set up the accounts.
3. **Final week:** `deploy_functions` with the coverage check, `run_evidence_suite` (Group B), the SEO publish-lane heartbeat (C), and any Group A proofs; confirm `ten_clean_runs` is ready; then the owner's sign-off.
Every guarded run above needs the owner's typed phrase and Approve click; Claude starts them only for an action approved in that chat, reads the logs afterwards, and reports what actually happened.
