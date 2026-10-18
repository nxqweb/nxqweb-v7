# Oct 22+ deploy day checklist (written 2026-10-16)

Goal: get everything built since Oct 6 live on `nxqweb-v9-staging.netlify.app` in ONE production deploy, then prove it works before the candle
client is told. Use this top to bottom. Tick each row. Claude does the "C" rows, the owner does the "O" rows (the owner always clicks
Review deployments -> nxq-staging -> Approve and deploy; Claude never does).

## Before anything (O)
| # | Check | Pass looks like |
|---|---|---|
| 0.1 | Oct 22 or later, and the Netlify team page shows credits reset (not "used its full credit allowance") | A fresh number near 300. Do NOT trust a number from days ago: Netlify's display can lag |
| 0.2 | Write the number down | e.g. "300 before" |
| 0.3 | Candle client has not asked for anything urgent | Nothing to wait for |

## Database (UPDATED 2026-10-18: migration 276 promoted)
- Migrations 269, 270 and 271 were applied to staging on 2026-10-16 (run #260, log confirmed).
- **2026-10-18: migration 276 (website photos at setup) was promoted on the owner's go ("lets do all of that"), so the plan is now FIVE migrations: 272, 273, 274, 275 and 276.** The owner must approve this exact list on the day (the earlier approval covered 272-275). 276 changes nothing a client can see until the photo panel switch is turned on later; what it does and the separate steps it needs (scanner secrets, function deploy, the switch) are in `docs/PHOTO_BACKEND_RUNBOOK.md`. If the owner prefers to keep deploy day to four, 276 can simply be applied in its own later run. Earlier: **Owner chose Option A on 2026-10-17: apply 272, 273, 274 and 275 together on deploy day** (a plan; the apply still needs the steps below in that day's chat). 274 and 275 were promoted from drafts the same day after an independent security scan (owner chose "A").
- **Five migrations are now pending: 272 (referral credit on Stripe invoices, dormant), 273 (Reviews collector), 274 (closes a checkout oversell hole: one added check inside the public order function) and 275 (closes a cross-client write hole: revokes direct insert/update/delete from signed-in clients on the 10 Commerce tables and direct insert on two privacy tables; the app never used those grants, every save goes through definer functions) and 276 (website photos at setup: lets a PAID client in setup upload images before approval, creates their storage allowance when billing turns active, adds the photo tagging tables and functions; nothing visible changes until the panel is switched on).** The guarded workflow runs `supabase db push --linked`, which applies ALL pending migrations, so they go together. 272 is inert: service-role-only functions, off unless `NXQ_REFERRAL_CREDITS_ENABLED`, a Stripe secret key and the referral program are all switched on. 274 and 275 take effect immediately; after the apply, the candle store's checkout and the owner's product/order pages must be re-proved (steps in 'Prove it').
- Order: (1) `validate_foundation`, read the "Migration dry run" list: it must list exactly `272_referral_invoice_credit.sql`, `273_reviews_collector.sql`, `274_fix_duplicate_variant_oversell.sql`, `275_revoke_client_direct_table_writes.sql` and `276_site_photos.sql`, nothing else (anything else: STOP and ask). (2) `apply_migrations`: owner fills the form, branch `safe/checkpoint-autonomy-wave35-sales`, types `APPLY-NXQ-SUPABASE-STAGING` exactly, Approves; Claude reads the log for "Applying migration 272..." through "Applying migration 276...". (3) Only then deploy functions and the site (a site deployed before 273 exists shows a calm "could not be loaded" on `/client/reviews`).
- **Extra proof for 276 (C, read-only):** the log shows `Applying migration 276_site_photos.sql` and no error. Nothing else changes for clients until the switch is turned on, so there is no phone proof for 276 itself; the photo proof is runbook step F.
- **Extra proof for 274 and 275 (O on a phone, C watching):** place a practice order for ONE product (works as before, stock goes down by that amount); open Products and Orders as the candle client and save a product and an order update (still works, because saves go through functions). Nothing else on the site should change.
- Booking draft 06 stays a draft (never part of an apply); the Booking pages have no route.

## Edge functions (only if needed) (C then O)
| # | Step | Notes |
|---|---|---|
| 1.1 | C: check whether anything under `supabase/functions/` changed since the last functions deploy (`git log -- supabase/functions`) | **It did (checked 2026-10-17).** The last deploy was run #263 (~04:00 UTC on 2026-10-17). Commit `8a6559e` (06:06 UTC) changed `ingest-stripe-webhook/index.ts` and `_shared/referral-invoice-credit.ts` (dispute handling, $0 invoices, coupon floor, stale-retry safety). So 1.2 and 1.3 are NEEDED unless the owner decides the webhook fixes can wait for real Stripe day (the webhook is test-mode only and nothing else depends on it) |
| 1.2 | C: start `validate_foundation` (read-only), give O the run link, O approves, C reads the result | Green, all required secret names present, "Migration dry run" lists exactly 272, 273, 274, 275 and 276 |
| 1.3 | C: start `deploy_functions` only after O says "yes, deploy functions" and types `APPLY-NXQ-SUPABASE-STAGING` exactly (O fills the form, branch `safe/checkpoint-autonomy-wave35-sales`; O does the Approve click) | It redeploys all 44 functions. If the log shows `toomanyrequests: Data limit exceeded` (Amazon registry throttle on shared runners, happened once on 2026-10-17), nothing changed: wait ~30 minutes and "Re-run all jobs" |
| 1.4 | O (optional, 10 min, Stripe sandbox): after 1.3, run the dispute test card `4000 0000 0000 0259` on a test invoice | `charge.dispute.created` should now return 200 (before the fix every dispute returned 400). Needs `STRIPE_SECRET_KEY` (sandbox key) in Supabase secrets to find the customer; without it the delivery fails loudly, which is expected |

## The one site deploy (C then O)
| # | Step | Notes |
|---|---|---|
| 2.0 | C: run `npm run ready` (preflight + the 66 CI commands, one verdict: READY / NOT READY, plus the human reminders). For reading the GitHub run screenshots see `docs/HOW_TO_READ_THE_RUN_LOGS.md` | READY |
| 2.1 | C: run `npm run preflight` (read-only: branch tip on origin equals local HEAD, clean tree, pending migrations are exactly 272 + 273 + 274 + 275 + 276, whether `deploy_functions` is needed, and a production-style rehearsal of ~36 pages under Netlify's real security headers), then `npm run test:ci-parity` and `npm run test:store` | All green before anything is published. If preflight says a migration other than 272, 273, 274, 275 or 276 is pending, STOP and ask |
| 2.2 | O: tell Claude "go, one deploy" | One production deploy costs 15 credits |
| 2.3 | O: publish the branch build (Netlify: the one-time "Activate builds" for the safe branch, then publish that deploy) | Write down the credits after; expect about 285 |

## What this deploy puts on the site (so nothing is a surprise)
Public: `/examples` (five fictional example sites with screenshots, built from the real template; static pages under `/examples/<name>/`, hidden from search engines); an 'Examples' link on `/plans`; a 'By request' card for NXQX Web Pro (from $300/mo; version 1 only lists what exists; later features clearly marked planned; contact button, no checkout) at the bottom of `/plans`; `/about`, `/contact`, `/privacy`, `/terms` (draft banner until a lawyer reviews them), referral links (`/portal/signup?ref=CODE`), Order-by-email and Menu store modes, the store page that waits for its ordering style.
Client portal: Rewards page, AI assistant chat, Report a problem button, "?" help words, store profile (About/contact), the new owner guards (cannot switch an open store to online ordering without a saved payment link).
NOT on the site: Booking (no route), referral credits on invoices (off), live Stripe (not connected), shopper accounts (leave off).
NEW on the site once 273 is applied: `/client/reviews` ("Get reviews" link in the client portal): paste a review link, get a printable QR card and messages. Proof: open it on a phone, save a real review link, press "Test my link", scan the printed or on-screen QR with a second phone.

## Quick automatic check right after the site is live (C, read-only)
Run `npm run smoke -- https://nxqweb-v9-staging.netlify.app <store-slug>` (plain GET requests only, no login). It proves the public pages load, the built scripts load with the right type, every security header from `netlify.toml` is present with the same value (including the strict Content-Security-Policy), and the home page is not cached. Needs the owner's OK before it contacts the staging site. It cannot see anything behind a login, so the phone proof below is still needed.
If anything is red, read `docs/ROLLBACK_AND_EMERGENCY_PLAN.md` before doing anything else.

## Prove it (O on a real phone, C watching screenshots) - use `docs/COMMERCE_TEST_PLAN.md`
Order of importance:
1. **E (public store):** open the candle store link in a private window: light look, store name as tab title, products, sold-out text, sticky cart bar on a phone.
2. **D7/J1-J6 (new):** Live store shows "How do customers order?". Try By email: save a contact email first, Open my store, then place a practice order
   from a second browser; the email panel opens a pre-filled email. Switch back to Online afterwards if the client wants payment links.
3. **J7 (Menu):** only if wanted for a test store; pick Menu only and look at the public page (no cart, how to order card).
4. **A/B/C (client flow):** setup form prefill, quick-start note, products and photos.
5. **J8-J11 (new):** assistant answer, the refund question reaches the owner's messages, Report a problem arrives, "?" help works.
6. **F (orders):** practice order shows in Orders, dashboard card counts it, cancel it afterwards.
7. **G (shopper accounts):** leave OFF for the candle store until a verified email domain exists.
8. **Legal and referral pages (new):** open `/privacy`, `/terms`, `/about`, `/contact` on a phone (draft banner shows, footer links work); open `/portal/signup?ref=NXQ1A2B3C4D5` and see the "invited by a friend" note.
9. **Billing safety (new, 2 min):** `/owner/billing` still loads; the candle client shows active; "Stripe customer links" shows only the sandbox test link, never the candle client.
10. **Phone checks (new):** a long email order (8+ items) opens with the customer's name, email and phone at the TOP of the email.

## Only then
| # | Step |
|---|---|
| 4.1 | O tells the client the store is public (only after the practice order passed); the friendly guide to send is `docs/CANDLE_CLIENT_QUICK_START.md` (delete its Reviews section if Reviews is not live) |
| 4.2 | C writes every surprise into `docs/NXQ_RUNTIME_HANDOFF.md` (friction list) and cancels all practice orders |
| 4.3 | Remove the temporary "Activate billing (no charge)" button before any real launch |

## Rollback (O does the clicks) - the full symptom-by-symptom guide is `docs/ROLLBACK_AND_EMERGENCY_PLAN.md`
- The site: Netlify -> Deploys -> open the previous good deploy -> "Publish deploy". Publishing an older deploy does not run a new build, but Netlify's credit rules for that could not be verified from the repo: check the Netlify credit page before relying on it.
- Edge functions: there is no one-click rollback; set `NXQ_BILLING_ENABLED` to `false` in Supabase (stops the Stripe webhook doing anything) and tell Claude, who fixes locally and redeploys once.
- Never apply, un-apply or edit migrations as a rollback; stop and ask.

## If something goes wrong
- A page looks broken: do not deploy again right away (each deploy costs credits). Screenshot it, tell Claude, fix locally, batch the fix.
- A database function errors in the app: stop and send Claude the exact on-screen message; do not paste SQL by hand.
- Credits run low again: stay on branch previews (free) and wait for the next reset.
