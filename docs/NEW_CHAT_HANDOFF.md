# NXQX-Web: new-chat handoff (written 2026-10-29, upload this file to the new chat)

**First message to paste into the new chat:** "Read CLAUDE.md and docs/NEW_CHAT_HANDOFF.md in the nxqweb-v7 repo, check git against origin, ask me whether Netlify builds are ON or OFF before any push, then continue with the first of the next three tasks."

## Do this first (every session)
1. `git fetch`, then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/safe/checkpoint-autonomy-wave35-sales`. Branch: `safe/checkpoint-autonomy-wave35-sales`. Never work on `main`. Never trust a SHA written in a document.
2. Read `CLAUDE.md` (standing rules), then the "HANDOFF 2026-10-29" block at the top of `docs/NXQ_RUNTIME_HANDOFF.md` and the "Canonical launch checklist" in that file.
3. Ask the owner whether **Netlify builds are ON or OFF** before ANY push. Builds cost 15 credits each and a push to the safe branch while they are ON starts one. Builds were stopped 2026-10-29 2:44 PM; credits 209.7 / 300 (resets Nov 22).
4. Before every push run `npm run test:ci-parity` (74 commands, takes about 2 minutes: run it in the background and read /tmp output). A real Postgres is in the sandbox: `pg_ctlcluster 16 main start`, then `NXQ_LOCAL_PG_OS_USER=postgres node scripts/test-local-full-schema.mjs` (45 checks). Type-check with `npx tsc -p tsconfig.app.json --noEmit` (the root tsconfig checks nothing).

## Where things stand (2026-10-29)
- Staging database: migrations through **286 applied** (285 client lifecycle, run #276; 286 store look, run #278). 45 Edge functions deployed. No pending migrations.
- Site: ONE build done and **published by the owner by hand 2026-10-29 2:33 PM**, commit `b74bd2f` on `nxqweb-v9-staging.netlify.app` (Auto Publishing is locked, so the owner always publishes by hand). A docs-only handoff commit sits on top of it.
- New in that build: `/owner/client-lifecycle` (Pause, Cancel + take-down to-do, free first month), `/owner/store-look` (colors, headings, logo per store), paused-store and portal notices, the Light of the World store look, setup-form color theme + own colors + background picks, the photo panel ON, AI Desk "Save to project" ON, scheduled security scan + secret watcher, backup guide.
- **Not yet seen live by Claude** (the sandbox cannot open the Netlify host): ask the owner for screenshots of her store, `/owner/store-look`, `/owner/client-lifecycle` and the setup form.
- The candle client (Light of the World) has NOT yet added products, photos, payment link or Website content: her store says "opening soon". Products load live from the database, so adding them needs NO build and costs 0 credits.

## Next three safe tasks
1. Get screenshots of the live new screens; fix anything wrong in ONE batched commit, pushed only when builds are OFF or the owner decides to spend a build.
2. When the helper has added products: look at her live store, then one practice order; test a product photo upload (never tested by Claude; Scanii free trial is 50 scans total).
3. With the owner's approval: make the theme/background picks apply to generated sites (needs `supabase/functions` changes + a `deploy_functions` run), or draft Resend email wiring that stays OFF by default.

## Rules in force
- Stop-and-ask gates are in `CLAUDE.md` (workflows, migrations, external services, secrets, deploys, payments, destructive actions). Migration apply and function deploys need the owner's typed `APPLY-NXQ-SUPABASE-STAGING` and the Approve click; always read the log afterward. Give the owner the 3-field "Run workflow" card (Use workflow from `safe/checkpoint-autonomy-wave35-sales`; action name; confirmation box) every time they must fill that form.
- Owner prefers: gen-z tone, nice, honest, smart, helpful; options as labeled choices for real decisions; a short done/left checklist at the end of a chat; point to the canonical checklist, never invent a percentage.
- Supabase is on the FREE plan: no backups. Upgrading to Pro (or a manual copy, see `docs/BACKUP_AND_RESTORE.md`) is a launch step before real clients or live payments.
- Honest limit: only light/dark mode is applied automatically to generated sites; theme, background and own colors are recorded in the setup report for the owner and the AI build plan.

## Owner-only items (Claude cannot do these)
Resend email account (no automatic emails to clients or shoppers today; the biggest hands-on reducer), live Stripe, AI key, production Supabase and a production scanner key, lawyer review, ten clean end-to-end runs, Pro plan for backups, a larger Netlify plan.

## Useful files
`docs/ONE_SITE_DEPLOY_RUNBOOK.md` (deploy steps), `docs/BACKUP_AND_RESTORE.md`, `docs/CANDLE_CLIENT_INTAKE_SHEET.md`, `docs/BOOKING_QUICK_START.md`, `docs/REAL_LAUNCH_GATE.md`, `docs/NXQ_RUNTIME_HANDOFF.md` (full history, long).
