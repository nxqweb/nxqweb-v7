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

## ACCESS PLAN: how a client's employees actually get in (added 2026-11-05, from reading the real sign-in code)
**What exists today (read from `PortalLogin.tsx`, `PortalSignup.tsx`, migration 015):** everyone signs in with email + password through Supabase Auth. After login the portal asks "owner?" then "client?" and sends you to `/owner` or `/client`. A new account becomes a CLIENT only if its sign-up carries a `business_name` (trigger `handle_new_client_signup`, migration 015); an account without it is just a login with no business. Storefront shoppers already use a separate third kind of account (`PublicShopperAccount.tsx`), so "another kind of user" has a precedent.
**Two gaps this exposes:** (1) the portal login does not know about workers, so workers need their own door (`/team/login` and `/team`) or they would be bounced; (2) a worker must sign up WITHOUT a `business_name`, or they would accidentally get their own client workspace. Both are safe to fix in front-end code.

### The employee journey
1. Business owner opens `/client/team`, types the worker's name, and gets an invite link (and a QR image of the same link) shown ONCE. They send it by text, hand it over, or print it. No email delivery is needed from us.
2. Worker opens the link on their phone, creates an account (email + password) or signs in, and the invite is claimed. The invite link is personal to that worker and dies when used or after 7 days.
3. From then on the worker goes to `/team` (bookmark it, or add it to the Home Screen), signs in, and sees one big Clock in / Clock out button plus their own recent shifts. Forgot password uses the existing reset page.
4. A worker who leaves: the business switches them off; their history stays for the business.

### Who can see what
| Person | Sees | Never sees |
|---|---|---|
| Worker | their own shifts and their own corrections | other workers, other businesses, any pay |
| Business owner (the client) | all their workers and hours, edit trail | other businesses |
| NXQX owner (you) | everything, via your own owner login | |
| Claude / this build sandbox | nothing live: it has no login to the app and no database access to client data | |
NXQX is a processor for the business: the business decides who is a worker. Nobody at NXQX should read staff data except to fix a problem, with the client told.

### Honest limits of the no-location rule
- Without location, nothing stops a worker clocking in from home or a friend clocking them in ("buddy punching"). Hours are a record the business reviews and can correct, not proof. Say so in the wording.
- A shared "scan this poster to clock in" QR is NOT in v1: it would invite exactly that. QR codes here are only personal invites.
- No push alerts and no reminders ("you forgot to clock out") in v1; those need a provider and an app.

### Gaps still to close before any real client uses it
1. `/team/login` + `/team` worker pages, and sign-up that never creates a client workspace (tested).
2. Does Supabase email confirmation apply to worker sign-up, and who sends it? Unverified; depends on the email provider setup (Resend is not live yet). If confirmation is required, a worker cannot finish sign-up until it is.
3. Erasure and export: staff data must be covered by the existing data-request function (`process-data-subject-request`) and a retention rule. NOT done; needs the owner's retention choice and a lawyer read.
4. Wording on every screen: "tracking only, not payroll", and a plain notice to workers that their clock-in times are stored and who can see them.
5. A test that a worker account can never read a client portal page or call a client-only function, and the reverse (draft 05 covers the database side; the page side is new).
