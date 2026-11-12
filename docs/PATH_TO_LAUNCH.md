# Path to launch: one page (written 2026-11-12; facts come from the other docs, none are new decisions)

**Where we are (verified 2026-11-12):** 6 of 10 clean QA runs (database count). Launch readiness 20/26. Netlify credits 42.8 (reset to 300 on 2026-11-23). Provider health: GitHub, Netlify, health adapter healthy. Owner dashboard exceptions: 11 (all explained, none live). Branch `safe/checkpoint-autonomy-wave35-sales`, parity 74/74.

## The 6 readiness checks still open
| Check | What unlocks it | Needs money? | Who |
|---|---|---|---|
| Ten clean runs | 4 more approve runs (30 or 45 Netlify credits each) | no (credits only) | owner starts + approves each, Claude reads results |
| Owner launch signoff | last: unlocks only after the other 5 are ready | no | owner |
| Website change classifier + AI build-plan enrichment (2 checks) | the AI model key | yes (about $3-14 per site build, unverified) | owner enters the key by hand |
| Notification dispatcher | an email provider (Resend) + a verified sending domain | free tier, domain cost | owner |
| Client file scanner | a scanner provider account (Scanii) + one clean staging scan | trial then paid | owner |
Live Stripe is NOT required in the current launch mode (the billing check is optional).

## Calendar
| When | What | Gated? | Credits |
|---|---|---|---|
| Now to Nov 22 | free work only; no QA runs (42.8 credits left, they expire Nov 22) | | 0 |
| About Nov 19 | refresh the staging evidence (`run_evidence_suite`; the six evidence checks expire after 7 days) and, with it, deploy the sturdier cleanup (`deploy_zero_netlify_readiness`) | yes: owner types the phrase and clicks Approve | 0 |
| Nov 23 | credits reset to 300; run the 4 remaining approve runs (budget 45 each = 180) | each run: owner starts + approves | 120-180 |
| Late Nov | 10 of 10; owner records the launch signoff only when the other 5 are ready | owner | 0 |
| Weekly | evidence refresh (7-day expiry) | yes, free | 0 |
| By about Jan 4 | "launch-ready": everything built and tested except the AI key, email and scanner (money items) | | |
| Jan to Jun 2027 | creators (wave 1 = 5 sites, on STAGING first: Free plan, no backups, low-stakes content only; about 150-225 credits); waitlist via the free outside tool; backups by hand | | 30-45 per site |
| About Jul 2027 | the owner's spending hold ends (it runs AFTER the Jun 16 date: decide whether to lift it earlier for the AI key and email) | owner | |
| Before anyone real depends on it | move creators to a separate production Supabase project with backups (about $25/mo, unverified) | owner decision | |
| Jun 16, 2027 | launch: waitlist invited in waves; AI Desk copy-paste covers the missing AI key; live Stripe once it exists | | |

## Recurring chores (so nothing silently dies again)
- Tokens (names and dates only, in `docs/EXPIRING_TOKENS.md`): Supabase (10 Nov 2027), Netlify (11 Nov 2027), GitHub verify (11 Nov 2027); phone reminders about 2 weeks before each.
- Netlify credit cycle: 300 free credits, resets on the 23rd; production deploys 15 each; previews not billed; builds stay OFF on the main staging site.
- Before every push: `npm run test:ci-parity` (74 commands).

## Open decisions that are the owner's
- Lift the spending hold early for the AI key and email? (launch is Jun 16, the hold ends about Jul)
- Lawyer read of Terms and Privacy (parked; needed before real clients rely on the legal wording).
- The creation-time duplicate Netlify build (15 credits per site) is researched but unsolved; parked until the ten runs are done (`docs/PROMOTION_DOUBLE_DEPLOY_PLAN.md`).
- Housekeeping: Proton Pass notes for the three new tokens, delete the old expired Netlify and GitHub tokens, delete the unused full-access `cli_eyetw...` Supabase tokens if they are yours (unconfirmed).
Decisions already settled (2026-11-12): `docs/OWNER_DECISION_SHEET.md`.
