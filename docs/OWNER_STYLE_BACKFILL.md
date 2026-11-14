# Owner SQL: fill in the missing website style for clients who submitted before the fix

Written 2026-10-26. **Optional, owner-run, NOT applied.** Nothing in the repo runs this for you.

## What problem this fixes
Before 2026-10-26 the "Request your website" form wrote the style answer on the line *after* "Style direction:", but the database only reads the style from the *same* line, so every client who used the form has an empty style in their intake record and keeps seeing "Complete the missing onboarding information: desired_style" in their portal (seen on the Tier Test Growth and Intelligence clients). The form is fixed for new submissions (it now writes one line). This file fills in the style for the clients who already submitted, using the style they typed, which is still stored in their setup report.

## Read this first: what happens after you run it
The onboarding check re-runs on a schedule for every approved client. Once a client's style is filled in, the next run **stops asking** for it, and if nothing else is missing it **queues that client's website build plan** (the test shows the state change to `build_plan_queued`, and the portal then says "NXQ is preparing your website build plan"). So running this **moves real clients' projects forward and starts their build-plan automation job**. That is the point, but it is why it is a separate decision and is not part of a migration. It never touches clients that have no setup report or already have a style.

## Step 1: preview (changes nothing)
Run in the Supabase SQL editor for the staging project. It lists exactly who would change and what style would be written. If a name is on the list that you do not want moved forward, stop here and tell Claude.

```sql
select c.business_name, c.status, ci.id as intake_id,
       coalesce(public.extract_setup_report_section(c.notes, 'Style direction'), public.extract_setup_report_value(c.notes, 'Style direction')) as style_from_report
from public.client_intakes ci
join public.clients c on c.id = ci.client_id
where nullif(btrim(coalesce(ci.desired_style, '')), '') is null
  and c.notes like 'NXQ WEB WEBSITE SETUP REPORT%'
  and coalesce(public.extract_setup_report_section(c.notes, 'Style direction'), public.extract_setup_report_value(c.notes, 'Style direction')) is not null
order by c.business_name;
```

## Step 2: apply (only after the preview looks right)
Only each client's newest intake record is changed, only if its style is empty, and running it twice changes nothing the second time.

```sql
update public.client_intakes ci
   set desired_style = x.style
  from (
    select distinct on (i.client_id) i.id as intake_id,
           coalesce(public.extract_setup_report_section(c.notes, 'Style direction'), public.extract_setup_report_value(c.notes, 'Style direction')) as style
      from public.client_intakes i
      join public.clients c on c.id = i.client_id
     where c.notes like 'NXQ WEB WEBSITE SETUP REPORT%'
     order by i.client_id, i.created_at desc
  ) x
 where ci.id = x.intake_id
   and nullif(btrim(coalesce(ci.desired_style, '')), '') is null
   and x.style is not null;
```

## How it was checked
`scripts/sql/local-full-schema/regression/owner_style_backfill.test.sql` runs both statements on a real local Postgres: a client with the old two-line report gets its style, the onboarding check stops listing `desired_style` afterwards and queues the build plan, a client that already had a style is untouched, a client with no report is untouched, and a second run changes nothing. `scripts/test-owner-style-backfill.mjs` fails if this file and that test ever stop using the same SQL.

## Undo
There is nothing to undo for a wrong style, because the text is the client's own words from their report. To put a client back to "missing", set that intake's `desired_style` to null.
