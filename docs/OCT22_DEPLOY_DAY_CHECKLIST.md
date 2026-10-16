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

## Database (already done)
Migrations 269, 270 and 271 were applied to staging on 2026-10-16 (run #260, log confirmed). Nothing to do here. If someone adds a newer migration,
run `validate_foundation` first and read the "Migration dry run" list before any apply.

## Edge functions (only if needed) (C then O)
| # | Step | Notes |
|---|---|---|
| 1.1 | C: check whether anything under `supabase/functions/` changed since the last functions deploy (`git log -- supabase/functions`) | If nothing changed, skip 1.2 and 1.3 |
| 1.2 | C: start `validate_foundation` (read-only), give O the run link, O approves, C reads the result | Green, all required secret names present |
| 1.3 | C: start `deploy_functions` only after O says "yes, deploy functions" and types the confirmation | Read the log: only the expected functions deployed |

## The one site deploy (C then O)
| # | Step | Notes |
|---|---|---|
| 2.1 | C: run `npm run test:ci-parity` and `npm run test:store`, confirm the branch tip on origin equals local HEAD | All green before anything is published |
| 2.2 | O: tell Claude "go, one deploy" | One production deploy costs 15 credits |
| 2.3 | O: publish the branch build (Netlify: the one-time "Activate builds" for the safe branch, then publish that deploy) | Write down the credits after; expect about 285 |

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

## Only then
| # | Step |
|---|---|
| 4.1 | O tells the client the store is public (only after the practice order passed) |
| 4.2 | C writes every surprise into `docs/NXQ_RUNTIME_HANDOFF.md` (friction list) and cancels all practice orders |
| 4.3 | Remove the temporary "Activate billing (no charge)" button before any real launch |

## If something goes wrong
- A page looks broken: do not deploy again right away (each deploy costs credits). Screenshot it, tell Claude, fix locally, batch the fix.
- A database function errors in the app: stop and send Claude the exact on-screen message; do not paste SQL by hand.
- Credits run low again: stay on branch previews (free) and wait for the next reset.
