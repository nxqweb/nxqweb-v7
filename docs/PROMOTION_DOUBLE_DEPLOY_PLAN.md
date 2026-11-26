# The double production deploy at promotion: evidence, cause and a proposed fix (written 2026-11-05)

**Status (2026-11-05): IMPLEMENTED AND DEPLOYED TO STAGING (run #283, commit c898996, promote-business-production redeployed, 45/45 functions verified). Not yet proven live: count the Netlify builds of the next approve run.** (Originally: implemented locally.) Option A was chosen. The wait rule is `supabase/functions/_shared/production-deploy-wait.mjs`, used by `promote-business-production/index.ts`, tested by `scripts/test-production-deploy-reuse.mjs` (16 checks incl. 4 planted-bug controls); `npm run test:ci-parity` 74/74. It reaches staging only after an approved `deploy_functions` run. Known side effect: a reused Git-triggered build is not counted by the Netlify build guard (no reservation is made), so the guard undercounts by one per site; the settled credit numbers remain the source of truth. The original proposal follows. Any fix is an Edge function change (`supabase/functions/promote-business-production/index.ts`), which reaches clients only after an approved `deploy_functions` run. Related: `docs/TEN_CLEAN_RUNS_PLAN.md`, `docs/WAVE_RELEASE_RUNBOOK.md`.

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

## Addendum 2026-11-05 (night): time limit checked, budget added
The job claim has no time limit that 24 seconds could trip. The one real risk was a slow Netlify API: six lookups of up to 15 seconds each could run past an Edge function's wall clock. The wait now has a total budget of 60 seconds (`budgetMs`, with a test and a planted-bug control). It is in the repo but NOT deployed: run #283 deployed the version without the budget, so the budget rides the next `deploy_functions` run. Run #4 passed on the deployed version.

## Addendum 2026-11-11: measured, the fix worked
Netlify's settled usage went from 6 production deploys (90 credits) to 11 (165): runs #9 and #4 used 5 deploys. Run #9 (without the fix) had 3; run #4 (with it) therefore had 2, so 30 credits per site instead of 45. Not read directly from run #4's own Deploys list.

## FINAL READING 2026-11-12 (owner's Netlify team Builds list): the promotion fix works; the remaining variance is at site CREATION
- QA-6049B35B713A (30 credits): 1 production deploy at site creation (11:11 AM, main@0389a06, no message) + 1 production deploy of the final commit (11:16 AM, main@5720f7a, Git-triggered, "generate client website config"). No second build of the final commit.
- QA-08B27165B052 (45 credits): 2 production deploys at site creation (both 12:01 PM, same commit d052992: "Initial commit" by the provisioner bot AND a no-message deploy) + 1 production deploy of the final commit (12:08 PM, main@9bdadb7). Again no second build of the final commit.
- QA-14EEDD2E57C6 (failed, 15 credits): 1 production deploy at creation (yesterday 3:11 PM, main@HEAD) + a preview; failed before promotion. 15 + 30 + 45 = 90 = the measured credit drop.
- Conclusion: the promotion double deploy is FIXED (the 24-second wait did not race). A clean run costs 30 or 45 credits depending on whether Netlify also builds the provisioner's "Initial commit" push at site creation (2 creation deploys instead of 1). Plan with 45. A future saving of 15 credits per site would come from stopping that creation-time duplicate (see `stop_builds` notes in `docs/TEN_CLEAN_RUNS_PLAN.md`), not from the promotion function.
- Preview/branch deploys are not billed.

## Open idea, researched 2026-11-12, NOT solved: the 15-credit duplicate build at site CREATION
Every new site (QA or a real creator) already pays 1 production deploy at creation, and sometimes 2 (the repo's first commit built twice: run QA-08B27165B052, 12:01 PM). `provision-project-infrastructure` sends `stop_builds: true` INSIDE the `repo` object of `POST /api/v1/sites` (lines about 291-310), and Netlify still builds.
What a web search found (third-party mirrors of Netlify's API reference; the official page `https://open-api.netlify.com/` was not read in full): `stop_builds` is documented as `build_settings.stop_builds` on the site object and as settable with `PATCH /api/v1/sites/{site_id}`; when builds are stopped Netlify refuses `POST /sites/{id}/builds` (so our own explicit-build fallback in `promote-business-production` would fail on a stopped site; the pipeline today relies on builds being on after the preview step). A community thread reports a race where a build queues before the flag can be applied.
Untested options, each needing a real Netlify site to try (about 15 credits per attempt, so do them as part of a normal QA run, never as extra runs): (1) after `POST /sites`, immediately `PATCH build_settings.stop_builds`; (2) create the site WITHOUT a linked repo, then link it once the repo is populated; (3) leave as is. Potential saving: 15 credits per site (50 percent on the creation part). Decision: park until the ten runs are done; it is not worth risking the proven pipeline for it now.
