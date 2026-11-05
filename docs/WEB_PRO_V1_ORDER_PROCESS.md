# NXQX Web Pro v1: how to sell and set it up by hand (written 2026-10-18)

Decisions behind this (owner, 2026-10-18): sell it as an **owner-approved Enterprise package** (no new tier in the database), **Pro v1 first, phone features later**, price **from $300/month**,
and the public plans page shows it as **"By request"**. The plan with all the options is `docs/WEB_PRO_PLAN.md`.

## What the client sees
- Public `/plans`: a "By request" card: from $300/mo, version 1 (Everything in Intelligence; lead dashboard and monthly report; review link, QR code and printable review card) and a clearly separate
  "Coming later (planned, not available yet)" list (AI receptionist with a fair-use minute cap, missed-call text-back, automatic review requests, Google Business Profile connection, booking requests then payments).
  The card says the price is set per business and the later $500/mo is a plan that may change. The button goes to the contact page. There is no checkout and no signup link for Pro.
- Client portal, plan change screen: a line explaining "choose Enterprise, write NXQX Web Pro in your note, and we will confirm what is included and the price before anything changes".

## Steps for a new Pro v1 client (O = owner, C = Claude)
| # | Who | Step |
|---|---|---|
| 1 | O | Talk to the business first (the page invites that). Agree what v1 includes and the monthly price (from $300). Do not promise anything from the "coming later" list as available |
| 2 | client | In the client portal: Plan -> request a change -> choose **Enterprise**, write "NXQX Web Pro" and anything agreed in the note |
| 3 | O | Owner screen -> Plan changes: open the request, type the agreed price in **Approved Enterprise monthly price** (placeholder shows "e.g. 300 for NXQX Web Pro v1"), accept. The system sets the client's monthly price to that amount (this is the existing guarded flow) |
| 4 | O | Billing is unchanged: you invoice from Stripe as for every client (link the Stripe customer on `/owner/billing`; keep the temporary "Activate billing (no charge)" section out of real launches) |
| 5 | O/C | After the change, open the client's owner view and confirm they now show as Enterprise with the agreed price. Note in the client's notes: "Pro v1, $X/mo, agreed DATE, includes: ..." so the package is recorded (there is no package column in the database) |
| 6 | O | When a "coming later" feature ships (for example Booking after it is promoted), tell the client and switch it on; update the card (`byRequestTiers` in `src/lib/productCatalog.ts`) in the same change so the page never claims more than exists |

## Rules (same as the rest of NXQX)
- Never state a price for the later features as final. The $500 is a plan.
- Never promise the AI receptionist, text-back or the Google connection until they work; they need outside services, API keys, a lawyer's read (call recording and texting consent) and a fair-use cap first.
- Never take a card or payout through the app for Pro; invoices are handled in Stripe as for everyone.
- The first Pro clients tell you what to build next. Keep a short list of what they ask for.

## What is deliberately NOT built (and why)
- No new database tier or constraint (the tier key is a fixed list in about a dozen places; see the plan, section 3). This keeps the 22nd untouched.
- No "package" column, so the package is recorded in the client's notes by hand.
- No automatic checkout. If three or more clients take Pro, promote it to a real add-on or tier with real usage data (plan options B and A).
