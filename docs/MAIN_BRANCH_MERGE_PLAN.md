# Merging the safe branch into `main` — PLAN ONLY (nothing on `main` was touched)

Written 2026-10-26 from read-only inspection. The owner chose "Plan only".

## Verified facts (fetched from origin, history unshallowed)
- `origin/main` = `77e9455` (Aug 13). It is a pure ancestor of the safe branch: **0 commits ahead, 1131 behind**, so a fast-forward is possible and no conflicts can exist.
- The branch differs from `main` by: 178 migration files, 70 Edge-function files, 52 workflow files, plus app code. `main` has only 2 workflow files (`manual-supabase-stage.yml`, `runtime-worker-dispatch.yml`); the branch has 53.
- Netlify "Deploy project" builds `main`, which is why `main` is stale and **must not** be built until merged on purpose. Auto Publishing stays locked either way.

## What would start running once these workflows exist on `main`
- Checked on the branch: `client-file-domain-isolation-contract.yml` and `portal-scale-contract.yml` run on push to `main` (and PRs); `harden-domain-reconciliation.yml` is limited to the safe branch; `ci.yml`, `ci-mega-extended.yml`, `security-audit.yml`, `client-canonical-stage-contract.yml`, `client-lead-pagination-contract.yml` run on pull requests (their push triggers were not confirmed by my quick scan: re-read the `on:` blocks before merging).
- `runtime-worker-dispatch.yml` is a 5-minute cron and **already exists on `main`**, so the schedule is live today; merging only updates it.
- Scheduled and one-shot workflows only run from the default branch. Any `harden-*` / `one-shot-*` file that has `contents: write` and a push trigger must be reviewed first: after a merge, a push to `main` could run it against `main`.

## Workflow audit result (2026-10-26, read-only, all 53 workflow files on the branch)
- **40 `harden-*` / `one-shot-*` workflows have `contents: write` and a push trigger. Every one of them is pinned to a `safe/...` branch** (32 to `safe/checkpoint-autonomy-wave35-sales`, 7 to `safe/commerce-live-storefront`, 1 to `safe/mega-autonomy-pass`; two of them use the inline `branches: [...]` form, checked by hand). **None names `main`, so a merge cannot trigger any of them.** Merging does not make them run.
- Workflows that do run on a push to `main`: `ci.yml`, `ci-mega-extended.yml`, `security-audit.yml`, `client-file-domain-isolation-contract.yml`, `portal-scale-contract.yml` (all read-only checks; the branch is green on all of them as of `0219175`).
- `manual-supabase-stage.yml`, `diagnose-business-ai-proof.yml`, `sync-staging-local-ai-adapter.yml`, `runtime-worker-dispatch.yml` use secrets and the protected `nxq-staging` environment; the first three are manual only, and the worker dispatcher is the 5-minute cron that already runs from `main` today.
- Net: merging adds no new automatic writer or deployer on `main`. The remaining risks are Netlify (a build on `main`) and the size of the change.

## Safe sequence (each step needs the owner)
1. DONE 2026-10-26: pre-merge workflow audit (result above).
2. Open a **pull request** `safe/checkpoint-autonomy-wave35-sales` -> `main` (CI runs on the PR; fix anything red on the branch). Do not merge yet.
3. Owner reviews the PR; decides whether to merge-commit or fast-forward (fast-forward keeps history linear).
4. Before merging: set Netlify so production builds from `main` stay stopped; confirm Auto Publishing is locked.
5. Merge. Watch the push-to-`main` workflows; read the logs.
6. Only then, if wanted, point Netlify production at `main` and do a deliberate publish (one 15-credit build).
7. Rollback: Netlify rollback target `aa72bd0` for the site; for `main`, a revert PR (never force-push).

## Decision for the owner
Merging is not needed to ship anything: the site deploys from the safe branch today. It matters for "Merge side branches into main" on the launch checklist and for scheduled workflows. Recommended: do steps 1-2 now (free), merge later after launch QA.
