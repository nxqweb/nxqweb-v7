# If the 22nd goes wrong: rollback and emergency plan (written 2026-10-17)

Read this BEFORE deploy day, once, so nothing here is a surprise. The short version: **almost nothing on deploy day can hurt the candle client's
orders, because the store keeps working the same way, and every step has an undo or a safe stop.** Breathe.

Golden rules (also in `CLAUDE.md`): stop and ask before anything destructive; never un-apply or edit a migration as a "fix"; do not paste secrets anywhere.

## What is safe to undo and what is not

| Thing | Undo? | How |
|---|---|---|
| The website (Netlify deploy) | Yes, quickly | Netlify -> Deploys -> open the previous good deploy -> **Publish deploy**. Check the Netlify credit page first: the credit rules for publishing an old deploy could not be verified from this repo |
| Edge functions (44 of them) | No one-click undo | Stop the damage by setting `NXQ_BILLING_ENABLED` to `false` in Supabase (the Stripe webhook then does nothing). Claude fixes locally and redeploys once |
| Migrations 272 and 273 | **Never undo.** They only ADD (a table, functions). Nothing is deleted or changed in old data | Leave them. If the Reviews page misbehaves, simply do not link to it; the rest of the site never touches 273 |
| A practice order | Yes | Cancel it in Orders afterwards (step 4.2 of the checklist) |
| Stripe sandbox state | Not real money | Nothing to undo; it is test mode |

## Symptom -> what to do

| You see | Probably | Do this |
|---|---|---|
| Dry run (`validate_foundation`) lists anything besides 272 and 273 | Something else got pending | **STOP.** Screenshot it, send it to Claude. Do not click Approve on `apply_migrations` |
| `apply_migrations` fails | A migration did not apply (the run stops at the first failure; whether a half-applied file rolls back was not verified, so Claude checks the database state read-only before anything else) | Screenshot the failing step and the last 20 log lines. Do NOT re-run blindly. Claude reads it and tells you whether re-running is safe |
| `deploy_functions` says `toomanyrequests: Data limit exceeded` | Amazon registry throttle, seen once on 2026-10-17 | Nothing changed. Wait ~30 minutes, then "Re-run all jobs" |
| The site deploy finishes but a page looks broken | A front-end bug | Do **not** deploy again right away (each deploy costs credits). Screenshot it. If it is the candle store itself, use **Publish deploy** on the previous good deploy; otherwise leave it and send Claude the screenshot |
| `/client/reviews` says "could not be loaded" | 273 not applied yet, or the site went out before it | Confirm the apply step finished green. Order on deploy day is migrations -> functions -> site |
| Candle client's store will not load for shoppers | Front-end or Supabase problem | 1) Open the store link in a private window and screenshot. 2) Publish the previous good deploy. 3) Tell Claude. Orders already placed are safe in the database |
| An order is stuck or looks wrong | Could be a real bug | Do not edit the database by hand. Send Claude the order number and a screenshot |
| Stripe webhook errors after deploy | Functions mismatch, or a missing secret | Check the Stripe dashboard delivery list; turn `NXQ_BILLING_ENABLED` to `false` if it keeps failing; tell Claude. It is test mode, nobody is charged |
| You are not sure what you are looking at | Normal | Screenshot, send, wait. Doing nothing is almost always safe |

## Who does what
- **You (owner):** every approval click, typing `APPLY-NXQ-SUPABASE-STAGING`, Netlify publish/rollback clicks, anything inside Stripe or Netlify.
- **Claude:** starts the read-only checks, reads every log, reports what ACTUALLY happened (not just the green check), fixes locally.

## Before you start (2 minutes, worth it)
1. Netlify credits: write the number down (see checklist 0.1/0.2). A bad deploy plus a rollback is about two deploys of credits.
2. Find the **previous good deploy** in Netlify now and note its name or time, so a rollback is one click later.
3. Tell no one (including the candle client) that the store is public until the practice order passed.

## After a rollback
Write down what happened, the time and the screenshot in `docs/NXQ_RUNTIME_HANDOFF.md` (Claude does this), fix locally, run `npm run preflight` and
`npm run test:ci-parity`, and batch the fix into ONE new deploy later.
