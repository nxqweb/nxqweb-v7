# Team hours (first business add-on pack): plan and status (written 2026-11-05)

**Status: DRAFT ONLY.** Data layer written and tested as `docs/drafts/migrations/05_team_hours.sql` (+ `.test.sql`, runs in `npm run test:local-full-schema`). Nothing is in `supabase/migrations/`, nothing is applied, nothing is deployed, no Netlify credits spent. Parent plan: `docs/BUSINESS_SUITE_PLAN.md`. Needs draft 04 (add-on packs) first.

## Owner decisions (chat, 2026-11-05)
- First pack to build: **Team hours** (not Debrief, not plumbing-only).
- **No location of any kind in v1.** The tables have no location columns, and the draft's test fails if one is ever added. Location, if ever wanted, is its own later pack with a lawyer read first.
- Scope tonight: drafts, tests, screens. No promotion to `supabase/migrations/`.

## How it works
1. Owner switches the pack on for a business (`owner_set_client_addon_pack`, draft 04; the catalog row starts INACTIVE until the owner confirms name and price).
2. The business adds a worker by name (`client_add_team_worker`) and gets a one-time invite token. Only its SHA-256 hash is stored; it expires in 7 days; a lost link is reissued with `client_reissue_team_invite` (only for a worker who has not joined).
3. The worker signs in with their own account and claims the invite (`team_claim_invite`). Wrong, used and expired tokens all return the same message.
4. The worker taps **Clock in** / **Clock out** (`team_clock_in`, `team_clock_out`). The time is the database clock, never the phone's. One open shift per worker (enforced by a unique index as well as the function).
5. The business sees hours per person (`client_team_hours_summary`, at most a year at a time; an open shift counts up to now) and can correct an entry (`client_correct_team_entry`): a reason of 3 to 300 characters is required, no future times, no shift over 24 hours, and the old values are kept in an append-only trail (`team_time_entry_edits`) the worker can also read.
6. A business can switch a worker off (`client_set_team_worker_active`). Cancelling the pack blocks every function immediately; the data stays.

## Safety rules (all tested)
- A business sees only its own workers and hours; a worker sees only their own rows; anon sees nothing; the owner reads everything. Two businesses plus workers on both sides are in the test.
- Nobody writes the tables directly (no insert/update grants to signed-in users); everything goes through functions that check the caller. The invite hash column is not readable by signed-in users (so `select *` on `team_workers` fails for them on purpose: list columns).
- Up to 50 workers per business. Every function needs the pack switched on.
- Planted-bug controls proved the test fails when: a location column is added; a correction ignores business ownership; the pack check is removed.

## Honest limits (unchanged from the suite plan)
Tracking only, not payroll; say so on every screen. A web page cannot do background tracking or alerts (no location in v1 anyway). Employment and privacy law differ by place and the business is the employer: wording needs a lawyer's read before real clients rely on it (parked until money exists). Workers are a new kind of user: the cross-tenant wall above is the part to re-check before any promotion.

## What is left to build (each step safe and local until promotion)
1. Worker page (`/team`): sign in, claim invite, big Clock in / Clock out button, own recent shifts. Calls the RPCs directly through the existing Supabase client, so **no Edge function and no function deploy** is needed.
2. Business page (`/client/team`): add worker (shows the invite link once), hours per person with a date range, correct an entry with a reason, switch a worker off.
3. Owner: a switch for the pack on the client lifecycle screen.
4. Promotion (GATED): draft 04 + 05 to real migrations, apply via the guarded workflow, publish the front end (Netlify credits). Each needs the owner's separate yes.
