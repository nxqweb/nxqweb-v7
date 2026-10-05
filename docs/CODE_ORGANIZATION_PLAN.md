# Code organization and optimization plan

Written 2026-10-05. Nothing here is done yet. Goal: make the code easier to change and cheaper to
run **without changing behavior**. Rules for every step: one change per commit; no migration or
workflow edits; no deploy until a batch is approved; compare before/after (test counts, build,
67-route browser smoke test); stop if any number gets worse.

## Measured state (from the repo)

| Area | Fact | Concern |
|---|---|---|
| Edge functions | 44 functions; `response()` re-written in 33, `secret()` in 18, `timedFetch()` in 12, `record()` in 8 | Drift and bug-copying; only 11 shared modules |
| Edge functions | Largest: `provision-storefront` 845 lines, `build-business-website` 783 | Hard to review; verified only by static validators (no Deno here) |
| Frontend pages | `OwnerPortal.tsx` 1,657 lines, `ClientPortal.tsx` 1,270; 59 of 64 pages call Supabase directly; no unit tests in `src` | Hard to test or reuse data access |
| CSS | 7,780 lines in 10 layered stylesheets (`nxq.css` 4,300) | Overlap and dead rules likely; UI is currently good, so visual risk outweighs gain |
| Scripts | 148 files: 26 one-off `patch-*`, 89 `validate-*`, 34 "wave" files; release gate auto-discovers `validate-*.mjs` in `scripts/` | Clutter hides the real gates |
| Docs | `docs/NXQ_RUNTIME_HANDOFF.md` is ~2,600 lines of ledger plus live state | Costs every new session time and context |
| Migrations | 223 files | History: never rewrite or renumber |
| Bundle | Main chunk 444 kB (127 kB gzip), pages already lazy-loaded | Fine; low priority |

## Recommended order (value vs. risk)

1. **Split the handoff doc.** Keep a short "current state + next tasks" file; move the history to an
   archive file. Zero runtime risk; saves effort in every future session.
2. **Tidy `scripts/`.** Move unreferenced `patch-*` scripts to `scripts/archive/`; keep validator
   discovery working (update the gate in the same commit); gate pass count must match before/after.
3. **Add safety nets before refactoring.** Offline tests for shared helpers; extend the browser
   smoke test with before/after screenshots of key pages.
4. **Share Edge-function helpers.** Create `_shared/http.ts` (`jsonResponse`, CORS), `_shared/env.ts`
   (`secret`, `optionalSecret`), `_shared/fetch.ts` (`timedFetch`). Migrate a few functions per
   commit, smallest first. Each touched function needs a guarded redeploy, so batch them.
   Static validators that match source text must be checked after each change.
5. **Frontend data layer.** Move Supabase calls out of pages into `src/lib/api/*`; split the two
   giant pages into components. Behavior-preserving only; verify with the route smoke test.
6. **CSS last, or never.** Only remove proven-dead rules, with screenshot comparison.

## Progress

- **Step 1 done (2026-10-05):** handoff split. `docs/NXQ_RUNTIME_HANDOFF.md` 2,649 -> 1,201 lines; the
  moved sections are verbatim in `docs/archive/NXQ_HANDOFF_HISTORY.md` (1,463 lines). A line-by-line
  check found 0 original lines missing. `scripts/validate-provider-plug-in-readiness-contract.mjs`
  reads the handoff, so the "Future one-session provider hookup" section and the secret names stay
  in the live file.
- **Step 2 not safe as written:** all 26 `scripts/patch-*` files are referenced by workflow files in
  `.github/workflows/` (one-shot-* and harden-*). Moving them would break those workflows, and
  workflow files are a stop-and-ask gate. Left in place. Revisit only with approval to edit or retire
  those workflows.

## Cost and performance levers already planned elsewhere

AI model routing and caching: `docs/AI_ROUTING_AND_AUTONOMY_PLAN.md`. Per-site costs:
`docs/UNIT_ECONOMICS_AND_SCALE.md`.
