# Creator early-access offer: DRAFT one-pager (written 2026-11-04)

**Status: DRAFT for the owner to edit. Nothing here is a contract and none of it is sent anywhere.** Blanks marked **[OWNER]** are decisions only the owner can make. Terms and Privacy are still drafts, the lawyer review is parked, and this page is not legal advice; do not send it as a binding promise until the owner has decided every blank.

**Related:** `docs/FOUNDING_CLIENT_PROGRAM_PLAN.md` (the 10 free founding spots and 5 half-price testing spots you already decided; creators should be counted against these unless you decide otherwise), `docs/CREATOR_ONBOARDING_SHEET.md` (the per-creator steps) and `docs/WAVE_RELEASE_RUNBOOK.md` (how many people to invite at once).

## What a creator gets
- A website built for them by NXQX Web, **free**. [OWNER: for how long, for example the first N months, then what price?]
- Hosting, and changes handled for them (they send a request, we do it).
- A client portal where they see their leads and messages.
- An early place in line for everything new.

## What we ask in return
- Honest feedback while we are still polishing (a short note after setup and after the first month). [OWNER: how often?]
- Permission, in writing and per item, before we show their site as an example or use their name (the repo's rule in `src/lib/socialProof.ts`: no entry without the client's written agreement and a verifiable figure).
- [OWNER: a shout-out, a link to the waitlist, or nothing at all. If a creator posts about us for free access, the platform and the law may require a clear "free/sponsored" label; check before agreeing.]

## Dates (targets, not promises)
- Early access for creators: from about January 2027. [OWNER: confirm]
- Public launch: **June 16, 2027**. Everyone on the waitlist is invited in **waves** (a few dozen at a time), because sites are built by hand and a person at the front of the line has to be served before the next wave goes out.

## What we do NOT promise yet (from `docs/REAL_LAUNCH_GATE.md` section E)
Cancel in one click (cancelling is a request to the owner today); an AI chatbot on the site; heat-map pictures; monthly optimization by AI (the monthly report is automatic and rule-based); online booking, members-only areas or property listings. Online checkout is request-only for now: order-by-email or a payment link.

## About the waitlist
- What we collect: email address, where they came from, and the date they agreed. No phone number, no free text.
- Why: to email them once when their site is ready to be set up. Nothing else.
- Removal: one click, and the row is erased (not just hidden).
- [OWNER: the exact consent sentence next to the sign-up button; it needs a lawyer's read before the list goes public.]

## Before the first creator joins (checklist)
- [ ] The owner picked staging vs a production project for creator data, and backups exist (Supabase Free has none; see `docs/BACKUP_AND_RESTORE.md`).
- [ ] The free-site terms above are filled in and read once by someone who can advise.
- [ ] A creator onboarding sheet exists (reuse `docs/NEXT_LOCAL_CLIENT_PLAYBOOK.md`).
- [ ] Netlify credits can cover the number of creators (a production build costs 15 credits; the free plan gives 300 a month; check the live balance).
