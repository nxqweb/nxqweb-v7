# The double production deploy at promotion: evidence, cause and a proposed fix (written 2026-11-05)

**Status (2026-11-05): IMPLEMENTED LOCALLY, NOT DEPLOYED.** Option A was chosen. The wait rule is `supabase/functions/_shared/production-deploy-wait.mjs`, used by `promote-business-production/index.ts`, tested by `scripts/test-production-deploy-reuse.mjs` (16 checks incl. 4 planted-bug controls); `npm run test:ci-parity` 74/74. It reaches staging only after an approved `deploy_functions` run. Known side effect: a reused Git-triggered build is not counted by the Netlify build guard (no reservation is made), so the guard undercounts by one per site; the settled credit numbers remain the source of truth. The original proposal follows. Any fix is an Edge function change (`supabase/functions/promote-business-production/index.ts`), which reaches clients only after an approved `deploy_functions` run. Related: `docs/TEN_CLEAN_RUNS_PLAN.md`, `docs/WAVE_RELEASE_RUNBOOK.md`.

## Evidence (first measured approve QA run, 2026-11-04)
Netlify's Builds list for the new site `nxq-qa-disposable-qa-842a688fa6d1-...-website` showed four builds, all completed:
| Time | Build | Notes |
|---|---|---|
| 2:00 PM | Production `main@9119627` | made when the site was created (8s) |
| 2:06 PM | Branch deploy `nxq/client-...@ef2cf00` | the preview (7s) |
| 2:08 PM | Production `main@ef2cf00` | commit message "NXQX: generate client website config", by the provisioner bot (4s): a **Git-triggered** deploy |
| 2:08 PM | Production `main@ef2cf00` | no message (7s): an **API-triggered** deploy |
Two production deploys of the SAME commit (`ef2cf00`) within the same minute. At 15 credits per production deploy that is 15 credits wasted per site (45 instead of 30).

## Cause (read from the code; not yet proven live)
`promoteProduction` in `promote-business-production/index.ts`:
1. `fastForwardMain(...)` moves `main` to the final commit on GitHub (only when `sourceSha !== mainSha`).
2. `findExistingProductionDeploy(siteId, sourceSha)` lists Netlify's recent deploys and reuses one for `main` at that commit. The function is a deliberate guard against exactly this.
3. When it finds none, it reserves a build (`reserveNetlifyBuild`) and calls `triggerProductionBuild`, which POSTs `/sites/{id}/builds?branch=main`.
Builds are switched on after the preview step, so step 1's push makes Netlify's own Git integration start a production build for that commit. Netlify records that deploy a few seconds later. The lookup in step 2 runs immediately after the push, finds nothing yet, and step 3 pays for a second build. The next job (`website_check_production`) then waits for "the exact commit" and is satisfied by whichever finishes.

## Proposed fix (small)
After the fast-forward (only when a push actually happened), poll the existing lookup for a short window before paying for an explicit build:
```ts
// A push to main starts Netlify's own production build a few seconds later; look for it before paying for a second one.
async function waitForGitTriggeredDeploy(siteId: string, sha: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const found = await findExistingProductionDeploy(siteId, sha);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return null;
}
// in the flow:  let build = await findExistingProductionDeploy(siteId, sourceSha);
//               if (!build && sourceSha !== mainSha) build = await waitForGitTriggeredDeploy(siteId, sourceSha);
```
If Netlify did start a build, it is reused and no explicit build (and no build reservation) is made: **15 credits saved per site**. If builds are stopped (so no Git build ever starts), the function waits about 24 seconds and then triggers the explicit build exactly as today, so the worst case is a slightly slower promotion, never a missed deploy.

## Risks and how to test
- It changes the core build path, so it needs a test that fakes Netlify: (1) a deploy appears on the second poll, so no explicit build is triggered; (2) no deploy ever appears, so exactly one explicit build is triggered; (3) `sourceSha === mainSha` (no push), so no waiting. The repo's contract validators for this function (`scripts/validate-business-production-contract.mjs` and the related ones) must also be updated and kept green.
- The Edge function's total run time grows by up to about 24 seconds in the no-Git-build case; the job's time limit must allow it (check before changing).
- Proof on staging: deploy the function (an approved `deploy_functions` run), then count the Netlify builds of the next approve run. Expected: 3 production-plus-preview builds instead of 4, about 30 credits instead of 45.
- Not part of this fix: the 2:00 PM creation deploy (Netlify makes one when a site is created) and the 2:06 PM preview branch deploy (whether Netlify bills branch deploys is still to be read from the settled credit numbers).

## Decision for the owner
- **Option A: implement and test it locally now** (no deploy). Claude writes the change and the tests, keeps parity green, and pushes; nothing changes on staging until the owner approves `deploy_functions`.
- **Option B: leave it** and live with about 45 credits per site (30 if this is fixed).
- Recommendation: **A**. Seven more approve runs at 15 credits saved each is about 105 credits, roughly one whole extra run per cycle, and every real client site benefits too.
