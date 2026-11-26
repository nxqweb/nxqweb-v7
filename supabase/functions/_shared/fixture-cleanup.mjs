// Removing the evidence suite's temporary fixtures one record at a time, with a short retry and a time budget. Pure logic: the delete call and the clock are
// passed in, so the Edge function and the Node tests (scripts/test-fixture-cleanup.mjs) run exactly the same code.
//
// Why: on 2026-11-12 the suite recorded its evidence, then deleting BOTH temporary clients in one statement hit "canceling statement due to statement timeout"
// (Free-plan database under IO pressure). The run returned HTTP 500 and left two fixture clients behind. A timed-out delete is rolled back, so a smaller delete
// that is retried a couple of times is safe. A record that is already gone ("User not found") is a success, not an error: the second cleanup pass reported
// phantom "auth user: User not found" errors for users the first pass had already removed.
export const CLEANUP_RETRY = Object.freeze({ attempts: 3, delayMs: 3000, budgetMs: 45000 });

export function alreadyGone(message) {
  return /not found|no rows|does not exist|already (deleted|removed)/i.test(String(message || ""));
}

// deleteOne(id) resolves to { error } like the Supabase client does (it may also throw). Returns a list of error strings; empty means everything is gone.
export async function removeOneByOne({ ids, deleteOne, sleep, label, attempts = CLEANUP_RETRY.attempts, delayMs = CLEANUP_RETRY.delayMs, budgetMs = CLEANUP_RETRY.budgetMs, now = Date.now }) {
  const errors = [];
  const startedAt = now();
  for (const id of ids) {
    let gone = false;
    let lastError = "";
    for (let attempt = 0; attempt < attempts && !gone; attempt += 1) {
      if (attempt > 0) {
        if (now() - startedAt >= budgetMs) break;
        await sleep(delayMs);
      }
      try {
        const result = await deleteOne(id);
        const message = result && result.error ? String(result.error.message || result.error) : "";
        if (!message || alreadyGone(message)) gone = true;
        else lastError = message;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (alreadyGone(message)) gone = true;
        else lastError = message;
      }
    }
    if (!gone) errors.push(`${label}: ${lastError || "delete did not complete"}`);
  }
  return errors;
}
