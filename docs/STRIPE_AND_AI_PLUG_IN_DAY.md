# Stripe and AI key plug-in day (audit written 2026-10-17)

What is really ready, what is NOT, and the exact order for the day the owner has a card. Secret NAMES only; values never go in chat, code, logs
or workflow inputs. The owner enters secrets in Supabase (Edge function secrets) and GitHub Environment `nxq-staging` by hand.

## 1. Referrals: honest status
| Piece | Status |
|---|---|
| Referral profiles and share codes (`NXQ` + 9 characters) | Built and applied (migration 229). A client sees their link on `/client/rewards` |
| Friend opens the link `/portal/signup?ref=CODE` | **Was broken, fixed 2026-10-17.** The signup page ignored `ref`, so the code was lost. Now it is read, shown ("You were invited by a friend"), kept in the browser, stored on the new account (works if the email is confirmed on another device), and applied once after the first sign-in by a silent `ReferralClaimer`. Tests: `npm run test:referral-link`; real-browser script `scripts/manual/referral-e2e.mjs` |
| Friend's first-invoice discount and the referrer's reward | Recorded in the credit ledger (`nxq_referral_credit_ledger`) with a 14-day hold, fraud signals, refund and dispute reversal. Rules: non-cash, non-transferable, an invoice can never go below the $10 protected minimum |
| Program switch | **OFF** (`referral_program_enabled`). The runbook also wants terms, a fraud policy, a Stripe webhook and invoice-credit integration tests before turning it on, plus legal review |
| Turning a held referral into a usable reward (`nxq_mature_referral_credits`) | **Nothing calls it.** Needs a scheduled job (service role) |
| Taking the credit off a real bill (`nxq_apply_referral_credit`) | **Nothing calls it.** There is no code that touches an invoice. So today credits would sit in the ledger and never reduce anyone's bill |
| Stripe webhook (`ingest-stripe-webhook`) | Records the friend's first payment (starts the hold) and flags refunds and disputes. It ignores `invoice.created`, which is where a credit would be added |

**The gap that matters:** the money-back step does not exist yet. The database can account for credits, but nothing sends a credit to Stripe.

### Design options for "give them their money back" (owner decision, not built)
- **Option A (recommended): negative invoice line on each new draft invoice.** On Stripe's `invoice.created` event (invoice still draft for about an
  hour), NXQX calls `nxq_apply_referral_credit` (idempotent per invoice id, enforces the $10 floor), then adds a negative invoice item through the Stripe API
  with an idempotency key. Exact per invoice. Needs: `STRIPE_SECRET_KEY`, an Edge function change, a small database function to give the credit back if the Stripe call
  fails (otherwise credit is used but not shown), an owner alert if it fails, and test-mode proof.
- **Option B: Stripe customer balance credit.** Grant a credit balance that Stripe applies by itself to the next invoice. Simpler timing, but the $10 floor is
  not enforced by Stripe, so NXQX would have to grant only (plan price minus $10) per cycle and would have to track plan changes.
- **Either way:** add a scheduled call to `nxq_mature_referral_credits`, and keep the program OFF until the test-mode proof passes.

## 2. Stripe: ready vs not
| Piece | Status |
|---|---|
| Webhook function: signature check (5 minute window), idempotent events, customer to client mapping, QA clients blocked, billing off by default | Built, local tests only; never run with real Stripe events |
| Owner screen to link a Stripe customer to a client (`/owner/billing`, migration 261) | Built and applied |
| Stripe Payment Links in client stores (paste a public link) | Built; accepts `https://buy.stripe.com/...` only |
| NXQX creating customers, subscriptions, invoices or credits through the Stripe API | **Not built. The code never calls the Stripe API.** `STRIPE_SECRET_KEY` is required by the readiness check but unused today, so billing a client still means the owner creating the Stripe subscription by hand and linking the customer |
| Live mode | Off: needs `NXQ_STRIPE_LIVE_MODE_ENABLED=true` plus a separate production approval |

## 3. AI key: ready vs not
| Piece | Status |
|---|---|
| One secret: `NXQ_AI_MODEL_PROVIDER_TOKEN` | Used by `generate-business-build-plan`, `classify-business-change-request`, `draft-sales-outreach-ai` |
| Proof run `prove_business_build_plan_ai` | Exists; cannot run without the key |
| OpenAI vs Claude | OpenAI protocols are proven; the Claude (`anthropic_messages`) protocol exists but migration 179's readiness only recognises the OpenAI ones, so using Claude needs one more migration (owner approval) |
| Portal assistant | Instant prepared answers today (not an AI). A real model plugs into `answerQuestion()` in `src/lib/assistantAnswers.ts`; that would need an Edge function that holds the key and a daily cost cap per client |

## 4. Plug-in day order (after the owner has a card)
1. Stripe test mode only. Create the account, bank account, webhook endpoint pointing at `ingest-stripe-webhook`, subscribe only to the invoice and subscription events the adapter uses.
2. Owner adds `STRIPE_SECRET_KEY` (test) and `STRIPE_WEBHOOK_SECRET` as Edge secrets. Keep `NXQ_BILLING_ENABLED=false` and `NXQ_STRIPE_LIVE_MODE_ENABLED=false`.
3. Link a TEST Stripe customer to a non-QA staging client (owner screen), then set `NXQ_BILLING_ENABLED=true` in STAGING only.
4. Send signed test events; check idempotency, out of order events, refund and dispute handling.
5. Only then decide Option A or B for referral credits, build it, prove it in test mode, and turn the referral program on in staging.
6. AI: add `NXQ_AI_MODEL_PROVIDER_TOKEN`, run `prove_business_build_plan_ai` once, read the result, then decide whether to wire the assistant.
7. Production stays off until every launch check is ready and the owner records final signoff. Roll back by setting `NXQ_BILLING_ENABLED=false`.

## 5. What can be done now without a card
- Referral link capture (done today).
- Writing and testing the credit functions against a pretend Stripe (stubbed requests), so plug-in day is only "add the key and prove it".
- The scheduled maturation job (draft).
- Owner alerts for failed credit applications.
Everything involving a migration or a deploy stays a draft until the owner approves it.
