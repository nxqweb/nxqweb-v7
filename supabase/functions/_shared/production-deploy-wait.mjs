// Reusing a production deploy that Netlify's own Git integration already started. Pure logic: the lookup and the sleep are passed in, so this runs the same in the
// Edge function and in the Node tests (scripts/test-production-deploy-reuse.mjs). Background and evidence: docs/PROMOTION_DOUBLE_DEPLOY_PLAN.md.
//
// Why: promote-business-production pushes the final commit to `main`. When builds are on, Netlify starts a production build for that push by itself, but only records
// the deploy a few seconds later. Asking straight away finds nothing, so the function used to pay for a SECOND build of the same commit (15 credits per site).
// Looking a few more times, a few seconds apart, reuses the build Netlify already started. If it never appears (for example because builds are stopped), the caller
// falls back to the explicit build exactly as before, so the worst case is a slower promotion, never a missed deploy.
export const GIT_BUILD_WAIT = Object.freeze({ attempts: 6, delayMs: 4000 });

// find() returns the deploy for this exact commit, or null when Netlify has not recorded one yet; it may throw (a failed deploy must surface, not be hidden).
export async function reuseGitTriggeredDeploy({ find, sleep, attempts = GIT_BUILD_WAIT.attempts, delayMs = GIT_BUILD_WAIT.delayMs }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);
    const found = await find();
    if (found) return found;
  }
  return null;
}
