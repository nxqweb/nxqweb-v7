# Tokens and secrets that expire (names and dates only; NEVER put a value in this file) (written 2026-11-11)

Why this exists: approve run #5 (QA-14EEDD2E57C6, 2026-11-11) failed because Netlify answered 401 to our token; see the ledger in `docs/TEN_CLEAN_RUNS_PLAN.md`. Nothing reminded us a token had an end date. Check this table before every QA run and before launch.

| Supabase Edge secret | Feeds | Token (where it was made) | Expires | Status |
|---|---|---|---|---|
| `NETLIFY_ACCESS_TOKEN` | provisioning, build, promote, reconcile-domain, storefront provisioning | Netlify personal token `nxqweb-supabase-staging-nov2026` | **2027-11-11** (owner phone reminder about 2027-10-28) | replaced 2026-11-11 by the owner; run #5 failed with 401 before this |
| `NXQ_NETLIFY_VERIFY_TOKEN` | read-only verify functions, provider health | same Netlify token as above | **2027-11-11** | replaced 2026-11-11 |
| `NXQ_GITHUB_VERIFY_TOKEN` | 8 read-only verify functions | GitHub fine-grained token (both listed fine-grained tokens, `nxqweb-staging-verify` and `NXQ deployment verifier`, show EXPIRED on GitHub) | unknown, probably already expired | **NOT replaced yet** (next owner task; new fine-grained, read-only, long expiry, pasted by the owner into Supabase) |
| GitHub environment secret `SUPABASE_ACCESS_TOKEN` (nxq-staging) | every guarded workflow (link, dry run, deploy, secrets check, remote contract query) | Supabase scoped token `nxqweb-github-actions-nov2026-b` (project nxqweb-staging only, Full access) | **2027-11-10** (phone reminder about 2027-10-27) | replaced 2026-11-11; the old `nxqweb-staging` token EXPIRED (last used Nov 4) and caused HTTP 401 in run #284; VERIFIED by run #286 (Link project and migration dry run passed; "Remote database is up to date") |
| `GITHUB_APP_*` (id, installation id, private key) | repo creation and moving `main` (a GitHub App, not a personal token) | GitHub App | no date known | working (runs #4 and #5 got past the GitHub steps) |

## Old tokens still listed, to review after the new ones are proven (do not delete blindly)
- Netlify: `NXQ Web Automation` (Apr 23), `NXQ Storefront Provisioner` (Jul 30), `NXQ Web Staging Supabase` (Aug 9), `NXQ Staging Provision Worker` (Aug 11): all "No Expiry"; I cannot tell which a live secret still uses. Expired and dead: `NXQ deployment verifier` (Aug 15), `nxqweb-staging-verify` (Nov 8).
- GitHub classic `NXQ Web Automation` (admin:org, repo, workflow, no expiry, "Never used"): nothing in the code uses a classic token; delete after a clean run.

## Rule
Long expiry (about 1 year), the date written here and in Proton Pass, a phone reminder 2 weeks before. Never "No Expiry" for a personal token that acts as the owner.

## Provider health smoke (run #286, 2026-11-11, after both fixes): `checked 3, healthy 2, degraded 0, errors 1`
Which provider errored is not printed by the workflow; read it on the owner Provider health screen. The expired GitHub verify token (`NXQ_GITHUB_VERIFY_TOKEN`) is the prime suspect. The remaining test of `NETLIFY_ACCESS_TOKEN` is a real QA run.

## Provider health sweep returned HTTP 500 (run #287, 2026-11-12) and the fix (NOT deployed)
Cause (from `automation_worker_heartbeats.last_error`): `Provider health event write failed: ... violates check constraint "nxq_provider_health_events_status_check"`. The health adapter answers `not_configured` for providers with no read-only check (billing, Stripe, the AI adapters ...). That word is not allowed in the events table (migration 134), so the insert failed and the whole sweep died with 500 as soon as one such provider was due; the owner's "Recheck now" clicks made them due (it sets a provider to `configured` with no last check). Not a token problem. Fix in the repo: `supabase/functions/_shared/provider-health-status.mjs` plus `check-provider-health/index.ts` (not_configured is skipped and kept as "not configured", unknown words become `error`), test `scripts/test-provider-health-status.mjs` with 4 planted-bug controls. It needs a gated `deploy_provider_health_only` run (0 Netlify credits) to take effect. Until then the automatic 5-minute health sweep may keep failing, which does not affect the QA pipeline as far as the code shows.
