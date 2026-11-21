# Pre-launch waitlist package (DRAFT, written 2026-11-04 overnight)

**Status: draft only.** Nothing here is applied, deployed or switched on, and none of it is in `supabase/migrations/`, `src/` or `supabase/functions/`. It is the in-app half of "Option C" in `docs/LAUNCH_PLAN_JUNE16.md`: collect email addresses before launch, then invite people in **waves** (the platform builds only about 4-12 sites a month). Not legal advice; the consent sentence needs a lawyer's read before the list goes public.

## What is in the package and where each file ends up
| Draft file (this folder) | Final home | Purpose |
|---|---|---|
| `waitlist-input.mjs` | `supabase/functions/_shared/waitlist-input.mjs` | All the rules and the whole request handler, pure and testable |
| `join-waitlist.index.ts` | `supabase/functions/join-waitlist/index.ts` | Thin web adapter, holds no rules |
| `waitlist.ts`, `waitlistSupabaseGateway.ts`, `waitlistConfig.ts` | `src/lib/` | Form rules, the real gateway, and the ONE switch (OFF) |
| `PublicWaitlist.tsx` | `src/pages/` -> route `/waitlist` | The sign-up page |
| `PublicWaitlistRemove.tsx` | `src/pages/` -> route `/waitlist/remove` | "Remove me" page for the link in a waiting-list email (removes only on a click, never on opening the link) |
| `OwnerWaitlist.tsx` | `src/pages/` -> route `/owner/waitlist` | Owner counts and "mark a wave as invited" |
| `test-waitlist.mjs` | `scripts/test-waitlist.mjs` | 104 offline checks (112 once promoted, when the wiring checks switch on), with planted-bug controls |
| `../migrations/03_prelaunch_waitlist.sql` (+ `.test.sql`) | `supabase/migrations/<next number>_prelaunch_waitlist.sql` | The table and its service-only functions |
| `promote.mjs` | (stays here) | Does all of the moves and registrations in one command |

## Three layers keep it OFF
1. **The page switch** (`waitlistConfig.ts`) is `null`: `/waitlist` says "not open yet" and makes no request; the owner page says the list is off.
2. **The function switch:** until `NXQ_WAITLIST_ENABLED` is exactly `true` and the site's address is in `NXQ_WAITLIST_ALLOWED_ORIGINS`, `join-waitlist` answers the same 404 to everyone, before it even reads the request.
3. **The database:** the table has RLS on, no public access, and its write functions run for the service role only (the function), with owner-only functions for counts and waves.

## How it behaves (all tested)
- Collects only: email address, a short source tag (`/waitlist?ref=creator_name`), the consent wording version and the time. No phone number, no free text.
- The answer is identical for a new address and one already listed (no probing for who signed up). A hidden bot-trap field looks like success and does nothing.
- Limits: 5 sign-ups per visitor per hour, 1,000 per hour for the whole list (`WAITLIST_LIMITS`); the shared ingress rate limiter from migration 204 does the counting, and `NXQ_LEAD_FINGERPRINT_SALT` (already used by the contact form) hashes the visitor.
- Invites go **oldest confirmed first**, at most 100 per call, and never invite the same person twice. Today "invite a wave" only MARKS people as invited; it sends no email.
- Removal **erases** the row. The removal link is `/waitlist/remove?token=<the row's removal token>`; the page asks for a CLICK before it removes anyone (email scanners and link previews open links on their own and must not remove people), the token must be a plain UUID, removals have their own limit (10 an hour per visitor), and every well-formed token gets the same "Done" answer whether or not it matched anyone.

## Not built yet (be honest before switching on)
1. **Confirmation email** (double opt-in, as `docs/WAITLIST_AND_EXAMPLE_PAGE_PLAN.md` asks). Needs an email sender, which needs the owner's Resend account and a verified domain (the spending hold). Until it exists nobody can reach `confirmed`, so the invite step has nobody to invite. **Decision D1 for the owner:** keep double opt-in, or allow single opt-in (the owner invites straight from `pending`; a one-line change in the invite function). Do not decide this silently.
2. **The removal link inside the emails.** The removal page and the function's `remove` action are now built and tested (see above), but nobody can receive the link until an email sender puts `/waitlist/remove?token=<removal_token>` in each message (the token is readable by the service role only, never by the owner screen). **Do not switch the list on until every email carries a working removal link.**
3. **The wave-invite email** ("your site is ready, please set it up").
4. **A retention purge** (the plan says delete after the family opens or after 24 months).
Items 1-3 all need the email sender; the existing notification pipeline is built around clients, so waitlist mail needs its own small sender.

## To promote it (stop-and-ask: needs the owner's "promote the waitlist")
```bash
node docs/drafts/waitlist/promote.mjs --dry-run
node docs/drafts/waitlist/promote.mjs
npm run test:ci-parity
```
Then run the local Postgres harness (`pg_ctlcluster 16 main start`, then `NXQ_LOCAL_PG_OS_USER=postgres node scripts/test-local-full-schema.mjs`), commit and push. The script refuses to run (changing nothing) if a target file exists or an anchor line has moved. **Rehearsed on 2026-11-04** in a scratch git worktree (never pushed): see the result line at the bottom of this file.

## To switch it on (each step is its own approval, in this order)
1. Promote (above). 2. Apply the migration with the guarded workflow: `validate_foundation` first and read the dry run (it must list exactly the new migration), then `apply_migrations` with the owner's typed `APPLY-NXQ-SUPABASE-STAGING` and the Approve click; read the log afterwards. 3. `deploy_functions` (same approval). 4. The owner sets `NXQ_WAITLIST_ENABLED=true` and `NXQ_WAITLIST_ALLOWED_ORIGINS` (the site address, https only) by hand in Supabase; never paste a value in chat. 5. Build items 1-3 of the list above. 6. Change `waitlistConfig.ts` as its comment says, run the checks, do ONE site build and the owner publishes by hand. 7. Prove it with a throwaway address, then erase that row.

## Rehearsal result (2026-11-04, scratch git worktree, never pushed)
`promote.mjs` was run for real in a throwaway copy of the repo at the then-current branch tip. Results there: `npx tsc -p tsconfig.app.json --noEmit` clean; `npm run test:edge` passed Deno type checking for all **46** functions (45 existing plus `join-waitlist`); `npm run test:ci-parity` **74/74** (it runs `test-waitlist` inside `test:store`); local Postgres harness **48/48** with the new migration applying as number 287 on a fresh database and its regression test passing. The rehearsal found and fixed one real mistake before it could reach the real tree (the function's cached database client was typed in a way Deno's strict check rejects). The migration number is picked at promotion time as one past the highest existing one, so it may not be 287 by then.

**Re-rehearsed 2026-11-04 after adding the removal page and the function's `remove` action** (scratch worktree at `56fb3cc`, never pushed): the promoted `scripts/test-waitlist.mjs` passes all **112** checks, `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run test:edge` passes Deno type checking for all 46 functions, `npm run test:ci-parity` is **74/74**, and the Postgres harness is **48/48** with the migration applying as 287 and its regression test passing.
