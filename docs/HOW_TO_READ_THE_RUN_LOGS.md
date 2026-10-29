# How to read the GitHub run logs on deploy day (a cheat sheet for the screenshots you send)

You do not have to understand these. This only helps you glance at a screenshot and know whether to **keep going** or **stop and send it to Claude**.
Open the run, click the job called **stage**, and click a step's name to expand it. A green tick means the step did not crash, but **read the lines**, because
"green" alone does not prove the right thing happened.

Lines marked (seen) were really seen in earlier runs on this project. Lines marked (expected) are what the setup should print but have not been seen yet.

## 1. `validate_foundation` (read-only, nothing changes)
Expand **Migration dry run**.
- KEEP GOING (seen): `DRY RUN: migrations will *not* be pushed to the database.` then `Would push these migrations:` then exactly four bullets, `272_referral_invoice_credit.sql`, `273_reviews_collector.sql`, `274_fix_duplicate_variant_oversell.sql` and `275_revoke_client_direct_table_writes.sql`, then `Finished supabase db push.`
- STOP if there is any other file name in that list, or if there are fewer or more than those four. Screenshot it.
- Ignore (seen): "A new version of Supabase CLI is available". It is just advertising.
- The steps that say **Apply migrations** / **Deploy ...** with a grey circle-slash icon were skipped on purpose. That is correct for a read-only run.
- Also expand **Verify staging Edge secret names**: green is good (it only checks that the names exist, never the values).

## 2. `apply_migrations` (changes the database; you type `APPLY-NXQ-SUPABASE-STAGING` exactly)
Expand **Apply migrations**.
- KEEP GOING (expected): `Applying migration 272_referral_invoice_credit.sql...` then `Applying migration 273_reviews_collector.sql...`, `274...` and `275...` then `Finished supabase db push.`
- STOP if you see the word `ERROR`, a red cross on that step, or fewer than four "Applying" lines. Do not re-run. Screenshot the step and send it.
- If the run stops at **Require explicit mutation confirmation**, the phrase was typed wrong. Nothing was applied (this happened once before, safely). Run it again and paste the phrase carefully.

## 3. `deploy_functions` (redeploys the 44 server functions)
- KEEP GOING (seen): the "Deploy ..." steps are green and **Verify complete remote function coverage** is green.
- Known harmless hiccup (seen once): `toomanyrequests: Data limit exceeded` from Amazon's registry. Nothing was changed. Wait about 30 minutes and click **Re-run all jobs**.
- STOP on any other red step.

## 4. The site deploy (Netlify)
- KEEP GOING: the deploy shows **Published** and the home page opens. Then run `npm run smoke` (Claude does), then the phone proof.
- STOP if the build fails or a page looks broken. Do not deploy again right away; see `docs/ROLLBACK_AND_EMERGENCY_PLAN.md`.

## The three rules
1. A grey circle-slash icon = skipped. That is usually fine.
2. Red cross or the word `ERROR` = stop and send a screenshot.
3. If you are unsure, doing nothing is safe. Send the screenshot and wait.
