# Deploy day plan (written 2026-11-24)

**STATUS 2026-11-24 (owner said "everything", "she uploads", "today"):** Phase 1 is DONE: drafts 06, 08, 10 and 11 are now migrations 296, 297, 298 and 299 (NOT applied); patches 08, 10, 11 and 12 are APPLIED in the source (not deployed); the phone logo layout is built; CI parity 74/74, store tests 86/86, local database harness 62/62 (including the four regression tests); `node scripts/preflight-deploy-day.mjs` passes except the clean-tree check before the commit, expects pending migrations to be exactly 296 + 297 + 298 + 299, and reports that no Edge function changed (so `deploy_functions` is NOT needed). Phase 2 step A is DONE (run #296, `validate_foundation`, dry run listed exactly 296 + 297 + 298 + 299, log read). Step B is DONE (run #298 applied 296 to 299; log read: four "Applying migration" lines, no error; staging is now through 299). Step C is DONE (run #300, owner-started, log read: "Remote database is up to date."; the stuck duplicate #299 was cancelled). PHASE 2 IS COMPLETE. NEXT: Phase 3, the one 15-credit main-app deploy. UPDATE 2026-11-24 (later): migration 300 (manual launch mode) was also applied (run #302) and verified (run #303), so staging is through 300.

Goal: put everything that is built and waiting onto staging and the site in ONE clean day: the database changes, the screens, the candle client's new logo and background. Builds stay OFF until step 4. One main-app deploy costs 15 Netlify credits (about 180 left on 2026-11-23).

## What is waiting (all finished and tested; the migrations are in the repo as 296 to 299 but NOT applied, the screens are in the source but NOT deployed)
| Piece | What it does | Gated step it needs |
|---|---|---|
| Draft 06 | Two internal tables become owner-only reads (no client-visible change) | migration |
| Draft 08 + patch 08 | Shipping fee: flat fee, free-over, pickup (store page and the owner's Shipping fee card) | migration + screens |
| Draft 10 + patch 10 | A client's own logo and background (database check, upload card on the Live store page); owner colour saves keep their pictures | migration + screens |
| Draft 11 + patches 11 and 12 | Automatic background maker server side, owner limits and approval page (`/owner/backgrounds`), client "Make me a background" button. Switched OFF and zero by default, so nothing happens until the owner sets numbers | migration + screens |
| Candle client logo v2 | `public/brand/light-of-the-world-logo-v2.webp` (already in the repo) | ships with the deploy, then one owner setting |
| Phone logo layout | Decided 2026-11-24 (Option A): on phones the logo sits inside the hero above the title instead of as a fixed background behind the glass cards | BUILT and browser-checked 2026-11-24 (8 of 8); ships with the deploy |
| Edge function `generate-store-background` | The picture maker | NOT part of deploy day; a later, separate gated step (see the end) |

## Decisions to make first (Option A / B / C each; Claude recommends)
1. **How much goes in.** A) everything above in one day (recommended: each piece passed its own tests, 66/66 database harness). B) a smaller "look" deploy: draft 10 + patch 10 + logo only. C) later.
2. **The candle client's background.** A) she uploads it herself with the new card after the deploy (recommended: it tests the real client flow). B) Claude drafts a one-off owner SQL statement to set it by hand (gated, needs your approval).
3. **Date.** Pick a day you have about two hours and credits of at least 15.

## Phase 1: Claude prepares (source only, no credits, no approvals)
1. `git fetch`, confirm the branch tip against `origin`, `npm run test:ci-parity` green.
2. (Phone logo layout: DONE 2026-11-24.) Re-run the parked patch guard; refresh patch 08 if the page changed under it (routine in `docs/drafts/patches/README.md`).
3. Promote the drafts to real migrations with the next free numbers, in dependency order (06, 08, 10, then 11; draft 10 must come before draft 11): move each sidecar test to `scripts/sql/local-full-schema/regression/`, keep the "NOT APPLIED" header, run `node scripts/check-migration-integrity.mjs` and `npm run test:local-full-schema`.
4. Apply patches 08, 10, 11, 12; flip the three "nothing in the app uses these rules yet" tests (listed in the patches README); delete the applied patches and their entries in `scripts/test-parked-patches.mjs`.
5. `npm run test:ci-parity` must be fully green, then `node scripts/preflight-deploy-day.mjs` (the only allowed failure is a dirty tree before the trigger commit). Push to the safe branch. Report exact files, checks and SHA.

## Phase 2: the database on staging (owner approvals; Claude may start each run only for an action approved in chat)
Owner form card for every run (the "Run workflow" page of `manual-supabase-stage.yml`):
| Field | Value |
|---|---|
| Use workflow from | `safe/checkpoint-autonomy-wave35-sales` (never `main`) |
| Choose validation or explicit runtime mutation | step A: `validate_foundation`; step B: `apply_migrations`; step C: `validate_foundation` again |
| Confirmation | step A and C: blank; step B: `APPLY-NXQ-SUPABASE-STAGING` typed by hand (no trailing space) |
A. Read-only `validate_foundation`. Claude reads the "Migration dry run" log: it must list EXACTLY the approved migrations (and nothing else). Anything else: stop and ask.
B. `apply_migrations`. Owner clicks Review deployments, `nxq-staging`, Approve and deploy (never done by Claude). Claude reads the log: one "Applying migration ..." line per migration, no error.
C. `validate_foundation` again: "Remote database is up to date".

## Phase 3: the main-app deploy (15 credits)
Follow `docs/ONE_SITE_DEPLOY_RUNBOOK.md`: (1) owner turns Netlify builds ON; (2) Claude pushes ONE trigger commit; (3) owner publishes the green deploy; (4) owner turns builds OFF and tells Claude "builds stopped". Claude records the credits before and after.

## Phase 4: the candle client's look (no build, no credits)
1. `/owner/store-look`: set her logo to `/brand/light-of-the-world-logo-v2.webp` and save (colours and her uploaded pictures are kept).
2. Her background: per decision 2 above.
3. Keep her old logo file as the rollback (set the logo path back and save).

## Phase 5: smoke test (Claude checks with the owner, about 10 minutes)
- [ ] Her store loads on a computer and a phone: new logo sharp, no text colliding, glass cards readable.
- [ ] `/owner/backgrounds` loads; the maker is OFF; limits show zeros. The client card "Make me a background" is NOT shown (it appears only after the owner switches the maker on).
- [ ] A test client's Live store page: the "Logo and background" card appears; a small picture asks for the "may look soft" tick; the rights tick is required; saving shows the picture on that store.
- [ ] Owner `/owner/store-look` colour save does not remove an uploaded picture.
- [ ] If draft 08 is in: the owner's Shipping fee card saves; a test order shows the fee; pickup works.
- [ ] Add to cart and reach checkout (do not pay). `/owner/client-lifecycle` loads.
- [ ] Netlify builds OFF; credits read and written in the deploy log.

## If something looks wrong
Do not rebuild (credits). Tell Claude exactly what you see (screenshot). Rollbacks: front end, Netlify Deploys, publish the previous deploy; the maker, leave the switch OFF (default); look, set the logo path back; the migrations are additive (draft 06 only narrows who can read two internal tables; it can be restored by recreating the old policies).

## After deploy day, separately (each gated)
1. The Edge function: draft folder `docs/drafts/functions/generate-store-background/` (see its README): adopt into `supabase/functions` with a manifest entry and a `verify_jwt = false` line, a scheduler entry, a provider account with a spending cap, its key stored as a server secret (never in chat), the provider's CURRENT docs read and one live test, then the guarded function deploy.
2. The manual-mode change for the three key-dependent readiness checks (not drafted yet).
3. Key rotation (`docs/KEY_ROTATION_PLAN.md`), the final-month scanner proof and evidence refresh, then the owner's sign-off.
