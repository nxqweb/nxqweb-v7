# Oct 22+ cheat sheet (one page, written 2026-10-19)

This is the short version of `docs/OCT22_DEPLOY_DAY_CHECKLIST.md`. If the two ever disagree, the checklist wins. **You** = the owner. **Claude** = the coding session.
Rule of the day: **you click and type the approvals, Claude starts the runs, reads the logs and tells you what really happened.** Nothing is skipped because a run is green: Claude reads the log lines.

## The phrases (only the `APPLY-...` one is exact; the rest are just clear words so Claude knows you mean it)
| When | What |
|---|---|
| Ready to start | Tell Claude: **"ready"** |
| Before the db/functions runs | You type exactly: **`APPLY-NXQ-SUPABASE-STAGING`** (every character, capitals and dashes) |
| After Claude shows the dry run is correct | **"yes, apply"** |
| After the migrations are in | **"yes, deploy functions"** |
| Ready to publish the site | **"go, one deploy"** |
| After the migrations (when you want the AI Desk) | **"277 is applied, switch the AI Desk on"** |
| Only when you want photos (NOT on the 22nd) | "276 is applied, switch the photo panel on" |

## Before you start (2 min)
- It is Oct 22 or later. Netlify team page shows credits near 300. Write the number down: ______
- Candle client has nothing urgent waiting.

## The run order
1. **Claude** runs `npm run ready`. You want: **READY**. Anything else, stop; Claude explains.
2. **Claude** starts `validate_foundation` (read-only, changes nothing) and gives you a link like `https://github.com/<owner>/<repo>/actions/runs/<number>`.
   - **You:** open it, click **Review deployments -> nxq-staging -> Approve and deploy**.
   - **Claude** reads the "Migration dry run" list. It must be **exactly six**: `272`, `273`, `274`, `275`, `276`, `277`. Not five, not seven. If it is anything else, **nobody applies anything**; Claude tells you why.
3. **Claude** starts `apply_migrations`. You type the phrase, then click Approve again. Claude reads the log and must see six lines `Applying migration 27x_...` with **no error**. Claude tells you the six names it saw.
4. **Claude** starts `deploy_functions` (after "yes, deploy functions" and the phrase). Approve click again.
   - If the log says `toomanyrequests` it is the registry throttle: wait about 30 minutes and run it again. Not a bug.
5. **Claude** does the final checks, then you say **"go, one deploy"**. You publish the branch build in Netlify. One deploy = 15 credits. Write the number after: ______ (about 285)
6. **Claude** runs `npm run smoke`. Expect all green. Anything red: stop, see "If it goes wrong".
7. **You** do the phone proof from `docs/COMMERCE_TEST_PLAN.md` (the order of importance is in the checklist): public store in a private window, one practice order, cancel it afterwards.
8. Only after the practice order works: tell the candle client the store is public.

## What "good" looks like in a run log
- Green check is **not** proof. The proof is the lines: `Applying migration ...` and no `ERROR`.
- Run number goes up each time. Write down which one is which (`validate`, `apply`, `deploy_functions`).
- Reading screenshots: `docs/HOW_TO_READ_THE_RUN_LOGS.md`.

## If it goes wrong (don't panic, don't re-deploy)
- Page looks broken: **screenshot, tell Claude, do not deploy again** (each one costs credits).
- A message from the app about a database function: send Claude the exact words. Never paste SQL by hand.
- Dry run lists the wrong migrations: stop. Say "dry run is wrong" and paste the list.
- Anything touching payments, secrets or production you didn't plan: stop and ask.
- Site rollback: Netlify -> Deploys -> previous good deploy -> Publish deploy (check the credits page first). Never un-apply a migration. Full guide: `docs/ROLLBACK_AND_EMERGENCY_PLAN.md`.

## After the AI Desk is on (the new daily flow, ~1 min per client)
1. Approve the client's setup in the owner portal.
2. Open the **AI Desk** panel, pick the client, press **Copy AI task**.
3. Paste it into your NXQX AI Desk chat. Copy the reply.
4. Press **Paste and check the AI Desk reply**. If it says "Good to go", press **Save to project**. If not, press **Copy fix request**, paste it into the chat, and repeat 3-4.
5. The build picks it up on its own within about a minute.

## After the day
- Check Scanii usage (trial: 50 scans) before you ever offer photos to clients.
- Set each client's billing to active by hand (that unlocks their "Request my website" button).
- Tell Claude "wrap up" and it writes down every surprise in the handoff file.
