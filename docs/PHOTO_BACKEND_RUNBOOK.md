# Photos at setup: what to run, and where (owner runbook)

Written 2026-10-18. Status (2026-10-18): **migration 276 is PROMOTED (in `supabase/migrations`, owner said "lets do all of that") and the builder change and the real photo gateway are in the code; NOTHING is applied, deployed or switched on.** Step A below is DONE. You asked to do the
backend part yourself. This is the exact list. Every step marked **GATE** is one of the stop-and-ask items in `CLAUDE.md`, so it needs your explicit go and your
own click; the rest is just so you know what is happening.

## What this gives a client
Pay first -> create account -> **Request your website** brief -> pick photos right there ("Photos of my work" go in an Our work section; "Other photos" go to the
NXQX team), add a description to each, press send. Later, **Redesign my website** has the same photo box for adding pictures. Photos are shrunk in the browser,
virus-checked before anyone can see them, and only a clean, released photo is ever copied into the client's website. The builder also proves the downloaded file is byte-for-byte the file that was scanned (SHA-256), and deletes gallery files it did not write in that build, so a removed or later-flagged photo cannot stay public at an old address.

## Review notes (an independent read of the draft, 2026-10-18, all fixed and tested)
Two real bugs were found and fixed: stale gallery files staying public after a photo was removed or flagged (the builder now deletes files it did not write), and the billing trigger being able to block billing changes for approved clients (billing-only changes now behave exactly as in migration 246). Also added: the scan fingerprint check, an active-plan requirement for tagging photos, a client-state check inside the build read, and stricter tests.
Known weaknesses left as they were: the claimed file type of an upload is client-supplied (the builder's byte check and the scanner bound the damage); the old upload-ticket re-authorize behaviour from migration 246 is unchanged (the new fingerprint check is what stops a post-scan swap from reaching the site).

## Why this needs YOUR backend steps (found while building it)
1. **Uploads were blocked before approval.** Migration 246 only lets a client upload after you approve them. Migration 276 allows **images only** to the files bucket for a
   client whose billing is **already active** while they are still in setup. Unpaid clients still cannot upload anything. (Tested with 7 planted bugs.)
2. **Storage limits did not exist before approval.** The monthly storage allowance is a per-client policy created only at approval, so even with rule 1 a paid client
   in setup would be refused ("No server-side resource policy is configured"). Migration 276 creates that policy when billing turns active. (Tested.)
3. **Photos stay locked until the malware scanner says clean.** Every upload is "restricted" until a scan says clean. The scanner (Scanii) is already live and proven on staging (step C), but its free trial is 50 scans in total, so photo uploads are a limited resource until a paid plan is possible.

## The steps, in order

### A. Promote the draft to a real migration  (GATE: migrations) **DONE 2026-10-18**
Done in one commit on the safe branch: `supabase/migrations/276_site_photos.sql` (promoted from draft 10), its test in `scripts/sql/local-full-schema/regression/276_site_photos.test.sql`, the builder change live in `supabase/functions/build-business-website` (it calls the new database function, which CI only allows once the migration is real), the real gateway in `src/lib/sitePhotosSupabaseGateway.ts`, 276 added to `expectedPendingMigrations` in `scripts/preflight-deploy-day.mjs` and to `docs/OCT22_DEPLOY_DAY_CHECKLIST.md`. Nothing is applied.
(Do NOT paste the SQL into the Supabase SQL editor: that skips the migration record, and the next `apply_migrations` run would try to apply it again and collide.)

### B. Apply it with the guarded workflow  (GATE: workflow + migration apply)
GitHub -> Actions -> **NXQ Manual Supabase Stage** -> Run workflow:
1. First run `validate_foundation` (read-only). Open the run, read the **"Migration dry run"** step. It must list exactly the migrations you approved:
   `272, 273, 274, 275` plus `276` if you promoted it before deploy day (or only `276` if 272-275 are already applied). Anything else: stop and ask.
2. Then run `apply_migrations` (this applies ALL pending migrations, so on deploy day it is the same run as 272-275). Type the confirmation phrase `APPLY-NXQ-SUPABASE-STAGING`, then click **Review deployments -> nxq-staging -> Approve and deploy**.
3. Read the log for `Applying migration 276_site_photos.sql` and a green result. (If you tell me which run, I will read the log and report what actually happened. I can also
   start the run for you through the GitHub tool once you have approved the exact migration list in chat; the Approve click stays yours.)

### C. The scanner: ALREADY DONE on staging (correction 2026-10-18)
I wrongly listed "create a Scanii account" here. The owner already has it: Scanii account created 2026-10-05, the key, secret and region (`NXQ_SCANII_API_KEY`, `NXQ_SCANII_API_SECRET`, `NXQ_SCANII_REGION=us1`) are set in the staging Supabase Edge secrets, the adapter and `scan-client-file` were deployed (run #233), migration 263 was applied (run #242), and the scanner was **proven both ways on staging** (a normal file came back "clean and released", the EICAR test file "infected and quarantined"; see the handoff notes of 2026-10-05/06 and `docs/MALWARE_PROVIDER_SCANII_PLAN.md`). Nothing to create or paste.
What is still true:
1. **The trial has a limit.** The Scanii dashboard (Account -> Usage, 2026-10-18) shows a **50-credit trial with 46 left**. Every uploaded file is one scan. A client who uploads 12 work photos uses 12 credits, so the trial covers only a few clients' photos. Rough rule: credits left / photos per client. Past the trial, Scanii is a paid plan, which is on hold under the spending hold (about July 2027). Options when credits run low: (a) keep photo uploads limited per client (the panel already caps work photos at 12), (b) turn the photo panel off again (`sitePhotosGateway = null`), (c) upgrade Scanii when the hold lifts. Check Account -> Usage before offering photos to a new client. Files that cannot be scanned stay restricted and never publish (fail closed).
2. The builder and worker changes still have to be shipped with `deploy_functions` on deploy day (same workflow, same phrase and Approve click).
3. Keep every key and secret value out of chat, screenshots and code. (A dashboard screenshot that shows key IDs is not a leak of the secret, but crop it next time.)

### D. Turn the panel on  (code change, then a site deploy)
After B succeeds, tell me **"migration 276 is applied, switch the photo panel on."** I will set the one switch in `src/lib/sitePhotosConfig.ts` to `createSitePhotosGateway(supabase)` (the gateway file is already in `src/lib`), flip the "switch is still null" expectation in `scripts/test-site-photos-ui.mjs`, run all checks, and push.
Then ONE site deploy (Netlify) publishes it. (Deploying the site before 276 exists would just show a calm "could not be loaded" in the photo box, nothing else breaks.)

### E. Per-client habit  (your normal owner screen, no code)
1. A client pays you (by hand for now). On `/owner/billing`, set their billing to **active**. That is what unlocks photo uploads for them (and creates their storage limit).
2. The client fills the brief and sends it. You approve once, as usual. The AI Desk / AI step builds the plan.
3. When the site is built, only photos that passed the scan appear in Our work. The build log step "generate_website_draft" lists how many photos were published and, for any that
   were skipped, why (too big, wrong type, could not be downloaded).

### F. Prove it once on staging
Use a real test account (NOT a QA-only client; those can never be billed): set billing active, upload 2 photos in the brief, check they show "Being checked", wait for "Ready",
approve, run the build, open the preview, and confirm the Our work section shows both. Then try the redesign form and add one more photo.

## If something goes wrong
- **Switch the panel off:** set `sitePhotosGateway` back to `null` in `src/lib/sitePhotosConfig.ts`, push, one site deploy. Nothing else changes for clients.
- **Close the uploads rule again:** the original function is migration 246's `nxq_authorize_storage_upload`; a rollback migration just redefines it from that file and restores the
  old trigger columns. I will write it if you ask; it is deliberately not run by anything today.
- **A photo looks wrong on the site:** remove it from the client's photo list (the client can, or tell me) and rebuild; the builder only publishes what is in the list.

## What I cannot do for you
- Create the Scanii account or enter the secrets (yours alone).
- Click Approve and deploy (yours alone, always).
- Make photos appear on a site before the scanner is live.
