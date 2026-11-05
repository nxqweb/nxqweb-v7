# NXQX-Web Referral Program: terms (DRAFT for a lawyer, 2026-10-17)

**This is a plain-words draft written from how the program is actually built. It is not legal advice and must be reviewed by a qualified attorney
before the program is switched on or advertised.** Square brackets are decisions or facts for the owner and the lawyer. Every rule below is a rule
the code enforces today (migration 229 and the Stripe invoice credit in 272); anything the code does not enforce is marked.

## 1. What the program is
A current NXQX-Web client can share a personal referral link. If someone signs up with it and becomes a paying client, both get a credit on their
NXQX-Web bill. Credits reduce your NXQX-Web invoice. They are never money.

## 2. What you get
- **Your friend:** a credit of $[10] toward their first eligible invoice after joining. (Built: the credit is added when the friend's code is applied and is taken off the next draft renewal invoice. A new subscription's first invoice is charged immediately, so in practice the friend's credit lands on their next renewal invoice, unless NXQX gives a coupon at signup.)
- **You:** a credit of $[10] after your friend's first payment is verified and a [14]-day review period passes without a refund or dispute.
- Amounts and the review period are set by NXQX and can change for new referrals. [Lawyer: how to word "can change" fairly.]

## 3. Rules that always apply (enforced by the system)
1. Credits are **not cash**, cannot be withdrawn, sold, or transferred, and have no value outside your NXQX-Web bill.
2. A credit can never take an invoice below **$[10]**. Anything left over waits for a later invoice. NXQX never owes you money.
3. Credits are used oldest first and only on invoices for NXQX-Web service (draft renewal invoices of at least $[10], in US dollars).
4. If your friend's payment is refunded or disputed, the related credit is cancelled. (Built.)
5. You cannot refer yourself, and accounts used for testing cannot take part. (Built.)
6. A referral code must be added **before** the new client's first payment. (Built.)
7. Each new client can have only one referrer. (Built.)
8. NXQX may hold or cancel a referral it reasonably believes is fake, abusive, or a copy of the same payment method or owner. (Built as an automatic review; the exact signals are not published.)

## 4. Things the code does NOT enforce yet (decide before launch)
- [ ] What happens to unused credit if you cancel your service (kept for [90] days? lost?). Not built.
- [ ] Whether credit expires. The ledger supports expiry but no expiry is applied.
- [ ] Tax treatment and any reporting duty for credits. [Lawyer/accountant]
- [ ] Rules for advertising your link (no spam, no fake reviews, no pretending to be NXQX). Not built; outreach rules exist for NXQX's own marketing only.
- [ ] Age and eligibility of the people referred (adult business owners only?).
- [ ] How you dispute a decision, and who decides. [Owner: contact address]
- [ ] Which state's law applies and whether any state requires special wording for referral rewards. [Lawyer]

## 5. Program changes
NXQX may pause, change, or end the program at any time. Credits already earned stay usable under these rules unless you misused the program. [Lawyer: confirm.]

## 6. Where this appears (after review)
- A short "Referral terms" page linked from the Rewards page (`/client/rewards`) and from the signup page when a referral link is used.
- The line on the Rewards page, "Rewards are credit on your bill. They are not cash... can never lower a bill below $10.00", already matches rules 1 and 2.

## 7. Related but separate: Founding Business Grant
Ten owner-selected awards among the first 10,000 paying clients, one basic website per business, up to $50 of NXQX cost per month, no cash value. The code
requires "legal review complete" before applications open. This draft does not cover it; it needs its own written award terms from an attorney.
