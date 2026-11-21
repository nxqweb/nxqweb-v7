# Backups and "something got hacked": what exists, what to check, how to restore (written 2026-10-29)

Plain rule: nothing here needs a new build, and nothing here is a secret. Never paste a password or key into chat; if a step needs one, you type it yourself into the tool.

## What is already backed up, without you doing anything
| Thing | Where the copy lives | How you get it back |
|---|---|---|
| All code (the NXQX app, her store page, the templates, the database migrations) | GitHub, every commit, branch `safe/checkpoint-autonomy-wave35-sales` | Any older commit can be checked out or redeployed. |
| Every published website version (NXQX app and each client site) | Netlify keeps every past deploy | Netlify -> the site -> **Deploys** -> pick an older green deploy -> **Publish deploy**. Instant, free, no build. |
| A client's generated website | It is rebuilt from the client's saved answers and photos, so it is never the only copy | Ask Claude to rebuild it (costs one build). |

## Confirmed 2026-10-29 (owner checked the dashboard)
- Supabase project `nxqweb-staging` is on the **Free plan: it has NO scheduled or point-in-time backups.** The Backups page says "Free Plan does not include project backups. Upgrade to the Pro Plan for up to 7 days of scheduled backups."
- So today the database has no automatic safety net. That is acceptable for staging with test data, and it must change before real clients or live payments: **upgrading to Pro (or taking a manual copy first) is a launch step.** Owner plan: upgrade when paid.
- Storage (client photos and files) is not inside a database backup either.
- [ ] Until then: take a manual copy (below) before any migration you are unsure about, and before the real launch.

## A manual copy of the database (only needed if there are no daily backups)
On your own computer, with the Supabase CLI logged in and the project linked, you type the database password yourself when asked:
1. `supabase db dump --linked -f nxq-backup-YYYY-MM-DD.sql` (the data and structure).
2. Keep the file somewhere private, NOT in the repository and NOT in a shared folder.
3. Do this before any migration you are unsure about, and monthly.

## If a client's website is defaced or broken
1. Netlify -> that site -> Deploys -> the last good deploy -> **Publish deploy** (this is the "roll back").
2. Tell Claude what you saw. Claude checks the recent commits and the security scan results for what changed.
3. If the site's own login or form was abused: **Pause** that client in `/owner/client-lifecycle` (stops new orders, requests and inquiries; the site stays visible), then fix, then Resume.

## If you think a password or key leaked
1. Rotate it at the source (Supabase, Netlify, GitHub, Stripe, Scanii), then update the matching GitHub Actions secret or Supabase function secret (names only are in `docs/NXQ_RUNTIME_HANDOFF.md`).
2. Tell Claude which one. Claude runs `node scripts/check-sensitive-changes.mjs --tree` to make sure no value was ever committed, and checks recent commits.

## If data is lost or corrupted
1. Do NOT keep clicking around; stop and tell Claude what you saw and when it started.
2. Supabase -> Database -> Backups -> restore to a point just before it happened (this is a gated, one-way action: ask Claude first so we confirm the time and what will be overwritten).
3. After a restore, Claude re-runs the read-only `validate_foundation` check and compares the migration list.

## What now watches for trouble (GitHub Actions: "NXQ Security Audit")
- Every push to a `safe/**` branch and every pull request: the full security checks, a production dependency audit, and a scan of the lines that changed for anything shaped like a secret (the value is never printed). Changes to workflows, migrations, server functions, dependencies, feature switches and `CLAUDE.md` get a visible notice in the run.
- Monthly (the 1st) and on demand: a scan of everything checked in, plus a full dependency audit including build tools.
- Not covered by this scan: what is already deployed on Netlify or in Supabase can change without a commit. Check the Netlify deploy list and Supabase settings if something looks off.

## Still to decide later (needs your approval and external accounts)
- An automatic nightly database export to private storage (needs a secret and a storage place).
- A restore rehearsal on a spare Supabase project, so the first time you restore is not during an emergency.
