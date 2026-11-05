# Plan to the June 16, 2027 launch (written 2026-11-04)

**Status: PLAN ONLY.** Nothing here is applied, deployed or paid for. Dates are targets, not promises. The evidence-based status of the product is the "Canonical launch checklist" in `docs/NXQ_RUNTIME_HANDOFF.md` (code / staged migrations / live verification, kept separate) and the money and decision gates are in `docs/REAL_LAUNCH_GATE.md`. This file adds the calendar and the waitlist strategy on top; it does not replace either.

## The shape (224 days from Nov 4, 2026 to Jun 16, 2027)

| Phase | Dates | Days | Goal |
|---|---|---|---|
| 1. Launch-ready | Nov 4, 2026 to about Jan 4, 2027 | 61 | The product is tested well enough to take creators and a waitlist without surprises |
| 2. Waitlist and creators | about Jan 4 to Jun 16, 2027 | 163 | Creators get free sites, the waitlist grows toward 1,000, everything stays stable |
| 3. Launch | Jun 16, 2027 | 1 | Invite the waitlist in waves; turn on live Stripe and the AI key once they exist |

The owner's rule for phase 1: **everything built and ready except the AI key and live Stripe.** The AI Desk copy-paste (about 1-2 minutes per site) covers the missing AI key; free creator sites need no billing, so live Stripe is not needed for them.

## Phase 1: launch-ready (to about Jan 4)

Done by Claude without gates (docs, tests, local code, commits to the safe branch; pushes are free while Netlify builds are OFF):
1. See the new screens: owner sends screenshots of the Light of the World store, `/owner/store-look`, `/owner/client-lifecycle` and the setup form (the sandbox cannot open the Netlify host). Fix anything wrong in ONE batched commit.
2. Draft migrations for the waitlist (03) and add-on packs (04), tested on the local Postgres harness (`docs/drafts/migrations/`).
3. Plans and maps: `docs/BUSINESS_SUITE_PLAN.md`, `docs/TABLE_MAP.md`, `docs/CREATOR_OFFER_ONE_PAGER.md`.
4. Keep `npm run test:ci-parity` green before every push.

Needs the owner (a specific yes each time, per `CLAUDE.md`):
- **Waitlist route** (Option C from chat: a free outside list tool now, an in-app list later). An outside service is a stop-and-ask item.
- **Where creator sites live:** staging (free, no backups, fake or low-stakes data only) or a separate production project before anyone real joins.
- **How many creators** in the first wave (affects Netlify credits).
- Applying any migration (waitlist, add-on packs): the owner types `APPLY-NXQ-SUPABASE-STAGING` and clicks Approve; Claude reads the log.
- One site build, only when the owner turns builds ON, then publishes by hand (Auto Publishing stays locked).

The ten clean end-to-end runs (A8) are the real "launch-ready" test, and **credits and the build guard, not code, decide their calendar**: see `docs/TEN_CLEAN_RUNS_PLAN.md` (4 of 10 done, verified in the database on 2026-11-05 UTC; a new QA site cost about 45 to 60 Netlify credits when last measured; the default build guard allows about one approve run per cycle). They are fictional clients started from Launch readiness: the APPROVE path goes through approval, a private GitHub repo, a Netlify preview and production, and maintenance; the DENY path passes only if nothing at all is created. Each needs real Supabase, GitHub and Netlify evidence, and the owner signs off after ten. Target: finished by about Jan 4.

## Phase 2: waitlist and creators (about Jan 4 to Jun 16)

- **Runbooks (written 2026-11-04):** `docs/WAVE_RELEASE_RUNBOOK.md` (wave size arithmetic, go/no-go, stop rules), `docs/CREATOR_ONBOARDING_SHEET.md` (per-creator steps) and the draft in-app waitlist package `docs/drafts/waitlist/` (switched OFF, promotion rehearsed in a scratch copy).
- **Release in waves, not all at once.** Today's caps are roughly 4-12 new sites a month (Netlify credits plus the build guard `max_builds_per_cycle`); see `docs/REAL_LAUNCH_GATE.md` section F. A list of 1,000 people cannot all get a site on day one, so the "your site is ready" email goes out in waves (for example 20-50 people), and the owner decides each wave size. The draft waitlist has `owner_waitlist_invite_wave` for exactly this.
- **Creators get a free site** and give something back (see `docs/CREATOR_OFFER_ONE_PAGER.md`). Each creator is a real client: real data, so backups and the legal wording matter before the first one.
- **Backups:** Supabase is on the Free plan with no backups. Until Pro, run the manual copy in `docs/BACKUP_AND_RESTORE.md` on a schedule.
- **Waitlist data is personal data.** The consent line, an honest "no site yet" message and a one-click removal that erases the row are the minimum. Terms and Privacy are still drafts and the lawyer review is parked.

## Money and the spending hold
The owner's hold (no card, no paid keys, no lawyer) runs to about July 2027, **after** June 16. Items that need money, from `docs/REAL_LAUNCH_GATE.md` section A: live Stripe (A1), AI key (A2), email provider and domain (A3), production Supabase (A4), lawyer (A5), paid scanner (A6), bigger Netlify plan (A7). Each needs a dated decision from the owner; none is assumed here. Prices there are unverified, check each vendor page.

## What is left, as of 2026-11-04
- [ ] Screenshots of the new screens (owner)
- [ ] Candle client: products added, one practice order, one photo upload test (the Scanii free trial has about 46 scans left)
- [ ] Waitlist route chosen; creator count; staging vs production for creators (owner)
- [ ] Theme and background picks applied to generated sites (function change plus a `deploy_functions` run; needs approval)
- [ ] Email wiring drafted OFF by default (Resend, needs the owner's account later)
- [ ] Ten clean end-to-end runs; production database and backup decision
- [ ] The decisions B1-B5 in `docs/REAL_LAUNCH_GATE.md` (what "cancel" does to a live site, deletion, product lines, SSL-expiry check)

## Finish line check (2026-11-05, owner asked "how far until only Stripe and the AI key are left?")
Code and staged migrations (checklist sections A and B) are essentially done: migrations 248-287 applied to staging, parity 74/74. The gap is live verification (section C). What stands between today and "only Stripe and the AI key left":
- [ ] Ten clean approve runs: **4 of 10** (verified in the database). About 30 credits per run IF the double-deploy fix works (fix deployed to staging in run #283; unproven until the Netlify Deploys list of run #4's QA site is read). Plan: 3 runs before Nov 22, 3 after, so roughly the end of November.
- [ ] Theme and color picks applied to generated sites (owner picks; function change + approved `deploy_functions`).
- [ ] Waitlist: owner chose a free outside tool for now (Option C); promoting the in-app draft is a gated migration and is NOT decided.
- [ ] Decisions B1-B5 in `docs/REAL_LAUNCH_GATE.md`, and staging vs a separate production project for creators.
- Not "Stripe or AI", but also not free: email (Resend + a verified domain, A3), a production database with backups (A4, about $25/mo unverified), the lawyer read (A5). All sit under the spending hold to about July 2027, so Jan 4 means "everything except Stripe, the AI key and the paid items", and these three stay open until June 16.
- The Team hours add-on was CANCELLED by the owner (2026-11-05); see `docs/BUSINESS_SUITE_PLAN.md`.
