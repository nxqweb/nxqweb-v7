# Zero-spend plan: the next ~9 months with no card, no phone number, no paid keys, no lawyer (written 2026-10-18)

Owner constraint (2026-10-18): the owner will not have a payment card, a phone number for account signups, or money for services for about 9 months (until roughly July 2027).
Everything that costs money or needs a card, a phone verification or a paid key is PARKED. Do not propose a paid service in this period; propose a free alternative or a manual process.
This file is the reference for that period. Prices and free-tier terms of outside services change: re-check on the provider's own page before relying on anything marked "check".

## 1. What already works with zero spend and zero keys (use it)
| Piece | State | Notes |
|---|---|---|
| Client websites on the staging pipeline (Netlify + Supabase staging project + GitHub) | Works; the candle client runs this way | Netlify production deploys cost credits (15 per deploy, about 300 per month on the current plan); batch changes into few deploys. Credits reset monthly |
| Build plans without an AI key | **Works on STAGING only**: `generate-business-build-plan` uses a built-in fallback (`build-plan-staging-fallback.ts`) when no provider is configured | Production needs a provider key; keep operating in the staging pipeline (as the candle client does) until the owner decides otherwise |
| Commerce store, orders, stock, Venmo/PayPal/Stripe payment LINKS (the client's own), order-by-email, Menu mode | Built, tested, going live on the 22nd | No Stripe account of NXQX is needed: each client pastes their own payment link |
| Reviews (QR, card, messages by hand), Members (after promotion), Booking requests (after promotion) | Built | None needs a paid service |
| Owner screens, sales pipeline, outreach card (`/owner/outreach-card`), plans page with Web Pro "By request" | Built | All free |
| Portal assistant | Prepared answers, not an AI | Free, honest |
| Billing NXQX's own clients | **By hand** | Month one is free, then the client pays you directly. See section 3 |

## 2. What is blocked until money, a card, a phone or a key exists (parked list)
| Parked | Why | Free stand-in for now |
|---|---|---|
| Live Stripe for NXQX's own billing | Needs a bank/card and identity steps | Manual payments (section 3); Stripe SANDBOX is already proven and stays as is |
| AI features (build-plan AI, change-request classification, outreach drafting, a real assistant) | Needs a provider key | Staging fallback plan; owner writes copy; prepared assistant answers. For TESTING only, a no-card free key (for example Google AI Studio) is possible, with test data only, because free tiers may use prompts for training |
| Automatic emails (notifications, review requests, waitlist confirmations) | Needs a verified sending domain and a sending key | Messages the client copies and sends by hand (already built for Reviews); the owner replies to leads by hand |
| Texting, missed-call text-back, AI receptionist, Google Business Profile connection (Web Pro phone features) | Phone numbers, telephony, SMS registration, API access, and a lawyer's read | Stays under "Coming later" on the plans page; Pro v1 is sold without them |
| Lawyer review, LLC | Cost | Legal pages stay "draft"; keep clients few and personal (see `docs/LOCAL_OUTREACH_KIT.md`) |
| Paid domains for NXQX | Cost | Use the free Netlify address; clients who want their own domain buy it themselves |
| Booking payments (Stripe Connect), shopper accounts (needs email confirmation at volume), referral credits on invoices | Stripe live / email domain | Off; booking stays request-only; guest checkout; referral credits stay dormant |

## 3. Getting paid with no card (manual, simple, honest)
- Agree the price in writing (the outreach kit's written summary email). After the free month, the client pays you directly by a method both of you are comfortable with (cash, check, bank transfer, or a payment app). Check each app's own rules about business payments, and keep a simple record (date, client, amount, what it was for) for taxes. This is not tax or legal advice.
- Keep one habit: on the day someone says yes, put the day-30 invoice date in your phone calendar. A free first month needs no code: no invoice until day 30.
- NXQX's Stripe customer link screen and the sandbox stay as they are; nothing live is connected.

## 4. What to do month by month (all free)
| When | Do | Who |
|---|---|---|
| Now to Oct 22 | Nothing risky. Optional: build the first 30-50 businesses list | Owner |
| Oct 22+ | Deploy day (four migrations, functions, one site deploy), practice order, then tell the candle client | Owner + Claude |
| Months 1-2 | In-person and phone outreach with the printed card; aim for 3-5 pilot clients on the free first month; get the candle shop's written OK for a short case study | Owner |
| Months 2-4 | Convert pilots to paying; fix every surprise they hit (friction list); promote Booking and/or Membership only if a real client asks for it | Owner + Claude |
| Months 3-6 | Keep clients few and happy; collect referrals by hand; record what clients ask for (this is the feature list for when money exists) | Owner |
| Months 6-9 | Use real revenue (even small) to decide the purchase order in section 5 | Owner |

## 5. When money or a card finally exists: buy in this order
1. A domain and a free-tier email sender (unlocks automatic emails, shopper accounts, review requests): typically a small yearly cost (check).
2. Stripe live for NXQX's own billing (needs the card/bank); then turn on the referral program only after the test-mode proof and the lawyer read.
3. A one-document lawyer review (Terms first, then Privacy), then the LLC if not already done.
4. A paid AI plan with a no-training setting (a few dollars a month, capped by the platform cost switch), then `prove_business_build_plan_ai`.
5. A phone number and SMS registration only when the AI receptionist and text-back are really being built.

## 6. What Claude can still build for free in this period (no keys, no spend)
- AI-free improvements: template-based review-request messages, a plain-words monthly report from real data, better onboarding checklists, in-app help words.
- The first-month tracker on the owner client page (needs a migration: free but a gated step), a phone-friendly intake (collects personal data: do it with the legal parts later).
- Promote Booking or Membership when a client asks.
- Example pages for outreach (see `docs/WAITLIST_AND_EXAMPLE_PAGE_PLAN.md`), more scans, and keeping tests and docs healthy.
- Anything that would call an outside service stays a local draft with a pretend service, like the Stripe credit logic.
