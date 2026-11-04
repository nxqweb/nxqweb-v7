# Wave release runbook: how the waiting list becomes real clients (written 2026-11-04)

**Status: PLAN ONLY.** Nothing here is built into the product except the existing client flow. It says how to turn a long waiting list into clients without running out of build credits or owner time. Numbers marked (unverified) must be re-checked on the day. Related: `docs/LAUNCH_PLAN_JUNE16.md`, `docs/drafts/waitlist/README.md`, `docs/NEXT_LOCAL_CLIENT_PLAYBOOK.md`, `docs/REAL_LAUNCH_GATE.md` section F.

## Why waves
Sites are built one at a time, and the accounts, not the software, are the limit. Today: Netlify's free plan gives 300 credits a month and one production build costs 15 credits, so about 20 production deploys a month across ALL sites (the main site included); the database build guard `max_builds_per_cycle` defaults to 4 per cycle (`docs/UNIT_ECONOMICS_AND_SCALE.md`); the AI Desk step takes the owner about 1-2 minutes per client; billing is confirmed by hand. A list of 1,000 people therefore has to be released in small waves.

## How big is the next wave? (do this arithmetic every time)
1. **Credits left** (Netlify -> Team -> Billing). Keep a reserve of at least **4 builds (60 credits)** for fixes and the main site's own deploys.
2. **Builds each new client needs:** assume 2 (the first build, plus one change after they see the preview) (unverified; measure it on the first creators and update this line).
3. **Wave size = (credits left - 60) / 15 / 2**, rounded down, and never above the build guard's cycle limit. Example: 210 credits left gives (210 - 60) / 15 / 2 = 5 clients.
4. **Owner time:** budget about 20 minutes of owner attention per client across the whole flow (approval, AI Desk, preview check, billing step) (unverified). A wave of 5 is about 100 minutes spread over the week.
5. If the answer is under 3, wait for the credits to reset or buy a bigger Netlify plan first (decision A7, `docs/REAL_LAUNCH_GATE.md`). Do not invite a wave you cannot build.

## Before each wave
- [ ] Credits and the wave size worked out above.
- [ ] A backup exists (Supabase Free has none): run the manual copy in `docs/BACKUP_AND_RESTORE.md` or have Pro in place.
- [ ] The previous wave's clients are all either live or have a named reason they are stuck.
- [ ] An email sender exists. **Without one, a wave cannot reach anyone:** the owner waiting-list screen shows counts only, never addresses, on purpose. (A launch gate: A3 in `docs/REAL_LAUNCH_GATE.md`. An owner-only address export would be a separate, privacy-reviewed decision; it is not built.)
- [ ] The honesty list in `docs/CREATOR_OFFER_ONE_PAGER.md` ("What we do NOT promise yet") has been re-read.

## Running the wave
1. Owner screen `/owner/waitlist` -> "Mark this wave as invited" with the wave number and size (it takes the oldest confirmed people first and cannot invite anyone twice).
2. The invite email goes out (copy below). It links to the normal signup (`/portal/signup`); nothing else is different for a waiting-list client.
3. Each person then follows the usual flow in `docs/NEXT_LOCAL_CLIENT_PLAYBOOK.md`: signup, billing step (by hand, complimentary where it applies), website request, approval, AI Desk, build, preview check, publish.
4. Keep a one-line-per-client sheet: name, wave, signed up, approved, preview sent, published, anything that confused them.

## Go / no-go for the next wave (look after about 7 days)
Go only if ALL are true: at least 80% of the last wave reached a published site or have a named reason; no unresolved data problem or complaint; credits and backups are still in order; the friction list from the last wave has been read. Any "no" means pause, fix, and tell the list honestly if they were promised a date.

## Stop rules (pause invites at once)
Credits under the reserve; a security or data problem; the build guard refusing real clients; two clients in a row failing at the same step (fix the step first, then continue).

## Draft invite email (owner to edit; promises only what exists today)
> Subject: Your NXQX Web spot is ready
> Hi, you joined our waiting list and it is now your turn. Set up your account here: [signup link]. It takes about 3 minutes, then you tell us about your business and we build your site by hand. We will write to you at each step. If you no longer want a site, use this link to be removed from the list: [removal link]. - NXQX Web

(Do not add promises about cancelling in one click, an AI chatbot, heat maps, AI-written monthly reviews, booking or members areas: see `docs/REAL_LAUNCH_GATE.md` section E. The removal link needs the removal page that the waitlist package does not have yet.)
