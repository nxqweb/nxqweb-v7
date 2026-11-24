# Final-month runbook: the order that makes launch readiness green at the same moment (written 2026-11-24)

Why an order matters: several launch checks are only "ready" while their proof is fresh, so doing the steps in
the wrong order leaves rows flickering or stale at sign-off time. Facts below were read from the migrations and
workflow named in each step. Nothing here is a secret; no token value ever goes in this file.

Every guarded run needs the owner's typed phrase and the owner's own "Review deployments -> nxq-staging ->
Approve and deploy" click. Claude starts a run only for an action the owner approved in that chat, then reads
the log and reports what actually happened. Cards for the Run workflow form: branch
`safe/checkpoint-autonomy-wave35-sales` (never `main`), the exact action name, and the confirmation phrase only
for a mutation (blank for a read-only validation).

## How long each proof stays fresh (why the order matters)
| Check | Fresh for | Source |
|---|---|---|
| Staging evidence group (template repo, storage isolation, tenant isolation, domain flow, maintenance, workers) | 7 days | `supabase/functions/run-staging-evidence-suite/index.ts`, migrations 228 and 237 |
| File scanner (a clean, released scan plus a healthy provider success) | 30 days | migration 263 |
| Workers deployed, provider health monitor | the worker heartbeat must be under 10 minutes old | migrations 141, 238, 263 |
| Ten clean runs | permanent once the strict count is 10 (owner read 10 on 2026-11-24) | migration 181 |
| Owner sign-off | decided by the owner, only unlocks when every other required row is ready at that moment | migration 226, 300 |

## The order (target: all of it inside one sitting, in the last 7 days before launch)
1. **Prepare (any time earlier, free).** Check `docs/EXPIRING_TOKENS.md` (expiry months) and do the key rotation in `docs/KEY_ROTATION_PLAN.md` first, because every rotation is re-proven in step 5 anyway. Make sure builds stay OFF unless a main-app deploy is needed.
2. **Read-only baseline.** Run `validate_foundation` (blank confirmation). Expect "Remote database is up to date." and all required secret names present.
3. **Functions, only if something changed.** `node scripts/preflight-deploy-day.mjs` tells you whether any Edge function changed since the last deploy. If it says one did, run `deploy_functions` and read the "complete remote coverage" lines. If not, skip.
4. **Fresh clean scan (scanner row).** Upload one harmless file on a billing-active, non-QA test client's `/client/files` page. The file scanner needs a clean, released scan from the last 30 days. Then continue straight to step 5.
5. **Dispatch the workers, then the evidence suite, back to back.** `dispatch_workers` first (it makes the worker heartbeats fresh, which the workers-deployed and provider-health rows need), then `run_evidence_suite` (refreshes the seven-day evidence). The dispatcher may also release the scanned file. Read both logs; the evidence suite should say `ok: true`, `netlify_calls: 0`, `production_changed: false`, `fixtures_removed: true`.
6. **Read the readiness page within minutes.** Press Refresh and read every required row. Expected at best: everything required ready except the owner sign-off. Rows that depend on heartbeats can fall back after about ten minutes, so do not wait; go to step 7 in the same sitting.
7. **Owner sign-off.** The owner presses "Approve autonomous launch readiness". It records governance evidence only and deploys nothing. If it refuses, read which required row is not ready and fix only that row.
8. **Record it.** Update `docs/NXQ_RUNTIME_HANDOFF.md` and the canonical launch checklist only for rows that really changed state.

## If a row misbehaves
- **Ten clean runs shows unknown but the strict count is 10** (owner SQL: `select public.count_strict_clean_business_runs();`): a second checker is overwriting it. A fix is drafted and parked as `docs/drafts/migrations/05_ten_run_check_follows_strict_count.sql` (would become the next migration number; needs the owner's go, a dry run listing exactly that one, then the guarded apply). Not needed unless this happens.
- **Workers deployed or provider health unknown right after step 5:** the heartbeat was older than ten minutes by the time the page was read. Run `dispatch_workers` again and read the page at once.
- **File scanner still unknown after step 5:** the scan was not clean and released, or is older than 30 days. Check the Provider health screen for the scanner connection and the Files card on the test client.
- **Any evidence row unknown with "expired or missing":** the seven days passed. Re-run `run_evidence_suite`.

## What is deliberately NOT required for launch (owner decision 2026-11-23, manual launch mode)
Notification email delivery, the AI change classifier and AI build-plan enrichment are waived with a written reason on the readiness page (migration 300). They can be switched back on with `owner_set_manual_launch_mode(false)`, which also withdraws any existing sign-off.
