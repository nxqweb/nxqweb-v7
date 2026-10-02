# QA run runbook — the 10 clean external runs

Plain-language steps for the owner. Written 2026-10-02 from the code
(`src/pages/OwnerLaunchReadiness.tsx`, migrations `disposable_business_qa_runner` and
`strict_qa_lifecycle_evidence`). This is the production gate: **10 consecutive clean
disposable runs with real Supabase, GitHub and Netlify evidence**, then recovery proof and
your signoff. Local simulations (`npm run test:lifecycle`) do **not** count.

## Do not start until all of these are true

- [ ] Staging secrets set, and `validate_prelaunch` re-run and passing (Cloudmersive key,
      AI provider config, etc. — see `docs/NXQ_RUNTIME_HANDOFF.md`)
- [ ] Netlify has credits. Each approved run builds a real Netlify QA site, so this spends
      credits
- [ ] The current frontend is live on the staging site: set Netlify to "Active builds", let
      the safe-branch deploy build, click "Publish deploy", then set builds back to
      "Stopped"
- [ ] You can log in as owner on the staging site and open `/owner/launch-readiness`
- [ ] No QA run is already "running" (the Start buttons are disabled if one is)

## What one run is

You work from **Owner portal -> Launch readiness -> "Disposable Business lifecycle QA"**.
There are two kinds:

| Button | What it tests |
|---|---|
| **Start APPROVE-path QA** | A fictional client goes all the way: approval, private GitHub repo, Netlify preview and production, maintenance. |
| **Start DENY-path QA** | A fictional client is denied. The test passes only if nothing at all is created downstream. |

Only one run can be active at a time. The fictional client uses an
`@example.invalid` email and is permanently **non-billable**; billing artifacts and
external notifications for it are blocked in the database.

## Steps — APPROVE path

1. Open `/owner/launch-readiness`. Click **Start APPROVE-path QA** and confirm the
   pop-up. This creates only a fictional client and a pending approval.
2. Go to the normal approval queue (`/owner/preview-requests`). Find the client named
   **"NXQ QA Disposable ..."**. Review it and **Accept**. This is your normal APPROVE
   decision; it is what triggers real infrastructure.
3. Wait. The pipeline runs by itself: project infrastructure, build plan, website build,
   preview deploy, production promotion, maintenance start. Do not click around to
   "help" it.
4. Watch the run's row on the Launch readiness page. It should move through phases to
   **passed**. When it finishes, the strict check runs automatically.
5. Refresh the page. The "Ten clean runs" counter should go up by one.

## Steps — DENY path

1. Click **Start DENY-path QA** and confirm.
2. Open the approval queue, find the **"NXQ QA Disposable ..."** client, and **Deny** it.
3. Refresh. It passes only if no project, repository, Netlify site, billing item or
   external notification was created.

## What "clean" means (the code checks all of these)

APPROVE run passes only if: the client ended approved/active; the project and deployment
belong to that client; a private repo and a Netlify site were recorded and are **unique**
(not shared with another client); production is verified (published, commit recorded,
https URL); preview and production commits were verified; maintenance started; there are
**no failed-out or blocked jobs**; **no manual rescue was used**; **no cross-client data**
was detected.

DENY run passes only if: the client is denied; no project; no deployment; no active
downstream jobs.

**"Manual rescue" is the one to avoid.** If a run gets stuck and you fix it by hand
(re-queue jobs, edit rows, push a button to unstick it), that run is *not clean*, even if it
finishes. Stop and tell Claude instead.

## If a run fails or gets stuck

1. Do not retry blindly and do not delete anything.
2. Open `/owner/exceptions` and `/owner/automation-health`; note the error text.
3. Copy the run code (the "QA-..." name), the phase it stopped in, and any error.
4. Tell Claude. A failed run is useful evidence: it points at a real bug, and fixing
   the bug is what makes the next run clean.
5. A failed run does not necessarily reset the count (the counter counts passed strict
   runs), but "consecutive" is the launch intent: treat any failure as a reason to fix
   first and keep going only when the cause is understood.

## Suggested order

Interleave so both paths are proven repeatedly. Example for 10 clean runs: 8 APPROVE and 2
DENY, or 7/3. Do them one at a time, each only after the previous one finished. Don't
batch several in the same minute.

## After the 10 runs

1. Refresh Launch readiness; "ten_clean_runs" should read **ready** (the check refreshes
   every 5 minutes).
2. The remaining checks (backup/restore drill, storage and RLS isolation suites,
   malware-scanner clean scan, SEO publish lane, etc.) must also be ready.
3. Only then does the **"Approve autonomous launch readiness"** button unlock. That records
   your signoff. It does not deploy production, change DNS, create billing or contact
   customers; those remain separate guarded steps.

## What this runbook does not do

It does not start anything for you, does not touch production, and does not enable
billing. Production remains blocked until the gate above is genuinely met.
