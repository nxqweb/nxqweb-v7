# Stripe sandbox (test mode) walkthrough (written 2026-10-17)

The owner created a Stripe **sandbox** ("NXQX sandbox"). A sandbox never touches real money or real customers. This is the order to prove the Stripe
connection safely on STAGING. Nothing here turns on live payments, the referral program, or production.

**Golden rule: never paste a Stripe key, a webhook secret (`whsec_...`) or any password into chat, code, a workflow box or a screenshot.** The owner types
them straight into Supabase. If one is ever pasted somewhere by mistake, roll (regenerate) it in Stripe right away.

## 0. You cannot be locked out, and you do not pay (proved by `npm run test:store`, file `test-owner-billing-safety`)
- **Your login is the owner list, not billing.** Owner access is decided only by a row in `owner_users`. No client's billing state, and no Stripe event, can remove it.
- **You are not a billed client.** Stripe events only touch a client that **you linked** to a Stripe customer on `/owner/billing` ("Stripe customer links"). Only an owner can link one, QA-only test clients can never be linked, and an event for an unlinked customer is rejected. **So: never link your own accounts or the complimentary candle client to Stripe.**
- **Nothing freezes automatically.** A failed payment can only move a linked client to "past due". The overdue job moves accounts to "review for a human". Freezing or cancelling needs a logged-in owner and a written reason, and a verified payment brings a client back to active.
- **Optional extra guard (not built, owner decision):** a "billing exempt" switch per client so even a mistaken link could never change an exempt client. Needs a database change (draft first, your approval to promote).

## 1. In the Stripe sandbox (owner)
1. Stay in the sandbox (blue banner "You're testing in a sandbox").
2. **Developers, then Webhooks, then Add endpoint.**
   - **Endpoint URL:** `https://<your-staging-project-ref>.supabase.co/functions/v1/ingest-stripe-webhook` (the project ref is in your Supabase URL).
   - **Events to send** (exactly these; they are the ones the code understands):
     `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`,
     `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
     and, only for the later referral credit step, `invoice.created`.
3. Open the new endpoint and **Reveal the signing secret** (starts with `whsec_`). Keep that tab open; you will paste it in step 2 below, not here.
4. **Customers, then Add customer** (any fake name and email). Copy the id that looks like `cus_...` (an id is fine to share; it is not a secret).

## 2. In Supabase, staging project only (owner types these, never in chat)
**Edge Functions, then Secrets:**
| Secret name | Value | Notes |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | the `whsec_...` from Stripe | required |
| `NXQ_BILLING_ENABLED` | `true` | staging ONLY. This is the master switch. Rollback is setting it to `false` |
| `STRIPE_SECRET_KEY` | the sandbox secret key `sk_test_...` | not needed for this first test (the webhook only listens); the readiness check expects it and the later referral credit step uses it |
| `NXQ_STRIPE_LIVE_MODE_ENABLED` | leave `false` / unset | sandbox events are not live-mode, so they pass without it |
| `NXQ_REFERRAL_CREDITS_ENABLED` | leave unset | referral credit stays off until its own test |

## 3. Deploy the webhook to staging (needs your approval each time)
The code is in the branch but the staging function may not be deployed yet. The guarded workflow `NXQ Manual Supabase Stage` deploys functions:
1. Claude runs the read-only `validate_foundation` first (you click Approve); we read the result together.
2. You say "yes, deploy functions to staging". Run `deploy_functions` (branch `safe/checkpoint-autonomy-wave35-sales`, confirmation `APPLY-NXQ-SUPABASE-STAGING` typed exactly, no extra letters), then Approve and deploy.
3. It deploys the whole set of Edge functions, not only the webhook. Only two changed recently, both safely: `ingest-stripe-webhook` (new, off by default) and `dispatch-notifications` (a type-only change).
Claude cannot read the Actions log (blocked), so afterwards send a screenshot of the deploy step.

## 4. Link a TEST client to the sandbox customer (owner)
On `/owner/billing`, use "Stripe customer links": pick a **non-QA test client that is not you and not the complimentary candle client**, paste the `cus_...` id, link.

## 5. Make Stripe send events (owner, in the sandbox)
| Try | How | What should happen in NXQX |
|---|---|---|
| Good payment | Customers, your test customer, Create subscription (any test product and price), pay with test card `4242 4242 4242 4242` (any future date, any CVC) | `invoice.paid`: the client's billing becomes **active**; in Stripe the endpoint shows delivery **200** |
| Failed payment | Next customer, card `4000 0000 0000 0341` (Stripe's "payment fails" test card) | `invoice.payment_failed`: client goes **past due**, never frozen |
| Refund | Refund the first payment | `charge.refunded`: logged; related referral credit (if any) cancelled |
| Dispute | Card `4000 0000 0000 0259` (Stripe's dispute test card) | `charge.dispute.created`: logged and flagged |
Stripe's testing page lists these cards. Each delivery should show **200** under the endpoint's "Event deliveries". A **400** with "Stripe customer is not linked" means step 4 was skipped; a **503** means `NXQ_BILLING_ENABLED` is not `true`; a **401** means the `whsec_` secret does not match.

## 6. Check and finish
- `/owner/billing`: the test client's billing state matches the table above.
- Roll back any time: set `NXQ_BILLING_ENABLED` to `false` and disable the endpoint in Stripe. This changes no client data.
- Production stays off. Going live later needs a separate approval, the live-mode switch, a real Stripe account verification, and the lawyer-reviewed terms.

## 7. Dark mode for the Stripe dashboard
I could not confirm a dashboard "dark mode" setting from here. Look under the gear icon (Settings), Personal details, for an appearance or theme option. If there is none,
use your browser: Chrome, `chrome://flags`, search "Auto Dark Mode for Web Contents", set Enabled and relaunch. That darkens Stripe without any NXQX change.
