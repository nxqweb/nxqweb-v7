# NXQX Web as a "web of your business": plan for after the June launch (written 2026-11-04)

**DECISION (owner, 2026-11-05): Team hours is CANCELLED. Not building it, no employee portal, no payroll feed.** Reason in the owner's words: free tools already do it, so charging for it is trying too hard. A draft data layer was written and tested the same day and then deleted at the owner's request (it stays in git history: commits 9820020 and 8d47967). The notes below are kept only as the record of the idea. Draft 04 (generic add-on packs) is untouched; its seeded `team_hours` row is now just a placeholder and should be replaced if packs are ever revisited.

**Status: PLAN ONLY, nothing built.** Owner decision in chat (2026-11-04): launch the website product FIRST (target June 16, 2027), then add business tools as add-on packs. This file keeps the idea, the honest limits and the order of work so none of it is lost. Not legal advice; the privacy and employment points need a lawyer's read before anything ships.

## The idea (the owner's words, tidied)
One portal where a small business runs everything: the website (the main page), team hours that staff enter or tap from their phones, a debrief space inside the portal, and a worker app reached by QR code, all under the owner's login. Stripe handles money; NXQX does not do taxes or payroll. Employee location is asked from the worker's own phone (the phone's permission prompt); NXQX does not run its own map. Base plan stays $50 a month; extras are add-on packs (the owner's example: about $5 a month for employee tracking).

## Honest limits to design around
- **A web page is not an app.** A QR code can open a web page that clocks someone in and out. Continuous background location, and "you have been in one spot too long" alerts, normally need a native app (App Store and Google Play) or a Home-Screen-installed web app, and iPhone web apps are more limited than Android ones (unverified, check current platform rules). Store accounts cost money (Apple's yearly fee is about $99, Google's one-time fee about $25, both unverified), which clashes with the spending hold until about July 2027.
- **If the owner is to see where people are, the location has to leave the phone.** Then NXQX stores personal data about employees on behalf of the client business. "It runs locally on the phone" only holds if the data never reaches the owner screen.
- **Hours are not payroll.** Say "tracking only" everywhere. A wrong number that feeds someone's pay is the client's wage dispute and our reputation.
- **Employee monitoring law differs by place** (notice, written consent, work hours only, what you may do with the data). The client business is the employer and carries that duty; NXQX should still give it plain wording and defaults that are safe. Needs a lawyer's review; the legal review is parked until money exists.
- **A new kind of user.** Workers are not clients and not owners. A third role means new tables, new RLS rules, and a hard rule that one business's staff data is never visible to another. That is exactly the cross-tenant risk `CLAUDE.md` makes a stop-and-ask gate.

## Order of work (each step is its own owner decision)
1. **Now to June 16:** launch the website product. No suite code. Drafts only (below).
2. **Pack plumbing (draft 04):** a catalog of add-on packs, a per-client row, an append-only events trail, one owner-only switch. Billing stays manual. Draft is tested on the local Postgres harness; applying it is a gated migration.
3. **Team hours v1 (the cheapest safe version):** a worker opens a link or QR, signs in, taps Clock in / Clock out. An OPTIONAL location stamp only at that moment, with a plain consent line; no live tracking. The owner sees hours per person and can correct an entry (every correction logged). No push alerts. Works as a web page, so no app-store fee.
4. **Debrief space:** a short end-of-shift note per worker, owner reads it in the portal. Text only.
5. **Alerts and live tracking (v3, only if wanted):** needs a native app or an installed web app, a push provider (external service), and the legal read. Treat as a separate project with its own budget.

## Sketch of the data (not a migration, names are placeholders)
`team_workers(client_id, auth_user_id, display_name, active)`, `team_time_entries(client_id, worker_id, clock_in, clock_out, location_consent, lat_lon_rounded, edited_by, edit_reason)`, `team_debriefs(client_id, worker_id, entry_id, note)`. Every table: RLS on; owner reads all; a client reads only its own business; a worker reads only its own rows; no anon access. A sidecar test must plant a second client and prove it cannot see the first one's workers.

## Pricing notes
- Card fees are about 2.9% + $0.30 per charge (unverified). On $1 that is about $0.33 (a third of the price). On $5 it is about $0.45 (about 9%). So packs should be priced at a few dollars and ride the monthly invoice, not be charged separately.
- Raising the base price later is a separate owner decision; today's pilot is "first month free, then $50-$150" (see `docs/REAL_LAUNCH_GATE.md`).
- The seeded `team_hours` pack in draft 04 is at 500 cents and INACTIVE until the owner confirms name and price.

## Gates (nothing starts without a specific yes)
New migrations and applying them; any outside service (push provider, app stores, a Stripe change); anything that stores employee location; the privacy wording and a lawyer read; Netlify builds and function deploys.
