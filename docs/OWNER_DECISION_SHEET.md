# Owner decision sheet: everything Claude is waiting on, one page (written 2026-11-05)

Goal (owner, 2026-11-05): get to the point where the owner only does a few things before launch. Everything Claude can do alone is already done or listed under "Claude, no approval needed". Each row below has a **recommended default**: replying "take the defaults" accepts every recommendation. Anything marked GATED still needs the owner's typed phrase and Approve click when it runs.

## 1. Decisions (no money, a sentence each)
| # | Question | Recommended default | Why |
|---|---|---|---|
| B1 | What does "cancel" do to a live site? | Owner switches the site OFF by hand (take-down to-do from migration 285 already exists); data is kept 30 days | Nothing is deleted by accident; costs nothing to build |
| B2 | How does deletion work? | Client asks in the portal; owner verifies by replying from the account email; owner runs deletion by hand | No automated deleter to get wrong; revisit after the lawyer read |
| B3 | Free first month / founding discounts | Track by hand in the lifecycle screen (free-first-month flag exists from 285); no auto-invoicing until Stripe is live | Stripe is not live yet, nothing to enforce |
| B4 | Which product lines to sell | Business website now; Commerce and Menu request-only; Booking, Membership, Property: do not sell yet | Matches the proven, tested paths |
| B5 | Real SSL-expiry check | Park it: Netlify renews certificates itself; look at Netlify by hand monthly | Needs an outside service call; low risk |
| T | Theme and color picks on generated sites | Option C now (hand-set per creator), Option A after the first creators | Zero risk; see `docs/THEME_PICKS_PLAN.md` |
| W | Waitlist route | Keep the free outside list tool for now; in-app waitlist (draft, tested, OFF) stays a draft | No migration needed before launch |
| P | Where do creators' sites live? | Staging first (free, no backups: fake or low-stakes content only); move to a production project before anyone real depends on it | Production DB is about $25/mo (unverified) under the spending hold |
| N | How many creators in wave 1? | 5 | At about 30 credits a site that is 150 credits, inside one cycle's headroom |

## 2. Owner-only actions (each a click or a paste, nothing to figure out)
1. **Read the Netlify numbers** for run #4: the QA site's Deploys list and the credits page (proves the double-deploy fix).
2. **Start each remaining approve run** on Launch readiness and approve it in the queue (6 left; about 3 before Nov 22, 3 after). 16 minutes each last time.
3. **Re-run the evidence suite once a week.** Six staging evidence checks expire after 7 days (Launch readiness shows "unknown" for storage isolation, RLS and the SEO publish lane today). GATED: `run_evidence_suite`, owner types `APPLY-NXQ-SUPABASE-STAGING` and clicks Approve; Claude starts it and reads the log.
4. **Screenshots** of the logged-in screens Claude cannot open (`/owner/store-look`, `/owner/client-lifecycle`, the setup form) so any visual bug gets fixed in one batch.

## 3. Money items (parked by the spending hold; none block "ready", all block launch day)
Live Stripe (A1), AI key (A2), email provider and a verified domain (A3), production Supabase with backups (A4), lawyer review (A5). The owner enters keys by hand, never in chat.

## 4. Claude, no approval needed (done or doing)
Parity 74/74 on every push; the ten-runs ledger and checklists kept current; builds stay OFF; no Netlify credits spent by pushes.

## 5. Known small limit shipped on 2026-11-05 (not a blocker)
The promotion fix waits at most 60 seconds in total for Netlify's own build (the budget added after run #283 was deployed). That budget is in the repo but NOT yet deployed, so it rides the next `deploy_functions` run (no separate approval needed just for it; bundle it with the next function change).
