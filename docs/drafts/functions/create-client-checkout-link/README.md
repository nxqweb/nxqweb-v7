# Draft: hosted checkout links (billing model A1)

Owner decision 2026-11-26: **NXQX creates a hosted Stripe checkout link for a client.** This folder is finished, tested source that is NOT deployed and NOT in
`supabase/functions`. Nothing in it has talked to Stripe. It is built so that plug-in day is "add the test key, switch it on, prove it".

## What it does (one client, one plan, one subscription)
1. The OWNER presses "Create checkout link" for a client (screen not built yet, see "Not built").
2. `index.ts` checks the signed-in owner, then `core.ts` runs the steps below. The amount is read from the client's plan price in the database, never from the caller.
3. Database: **reserve** an attempt (refuses QA-only, denied, archived and dormant clients, prices under $10, and clients that already finished a checkout; a repeat request reuses the open attempt).
4. Stripe: create ONE customer for the client (or reuse the linked one) and **link it in the database first**, because the webhook only accepts events from linked customers.
5. Stripe: create a subscription Checkout Session (monthly, USD, no promo codes, link lasts about 23 hours). Only a Stripe-hosted `checkout.stripe.com` page is ever handed back.
6. The owner sends the link to the client (by hand). The client pays on Stripe's page, so no card detail ever touches NXQX.
7. Webhook: `checkout.session.completed` marks the attempt completed (patch below). Money events (`invoice.paid`, subscription events) keep using the existing, tested webhook paths.

## Files
| File | Purpose |
|---|---|
| `stripe.ts` | Pure request builders and answer readers: key mode, amount range, return addresses, hosted-page check |
| `core.ts` | The orchestration with every outside call passed in (database, Stripe), so it runs against fakes |
| `index.ts` | The thin Edge handler: owner sign-in, two off switches, real calls. 503 unless `NXQ_BILLING_ENABLED` and `NXQ_STRIPE_CHECKOUT_ENABLED` are both `true` |
| `checkout-completed.ts` | Reads a `checkout.session.completed` event (copy to `supabase/functions/_shared/` on adoption) |
| `ingest-stripe-webhook.checkout-completed.patch` | The small webhook change that records a finished checkout (`git apply`, checked to apply today) |
| `docs/drafts/migrations/13_stripe_checkout_links.sql` (+ `.test.sql`) | The attempts table and five service-role-only functions |

Tests: `npm run test:checkout-link` (`scripts/test-client-checkout-link.mjs`, pretend Stripe, no network or keys, 50+ checks, also in `npm run test:store`) and the database test inside `npm run test:local-full-schema` (67/67).
A control run (a deliberately broken copy of each rule) is recorded in `docs/NXQ_RUNTIME_HANDOFF.md`.

## Rules proven offline
Test key by default (a live key is refused unless `NXQ_STRIPE_LIVE_MODE_ENABLED=true`, and every Stripe answer must match the key's mode); amount only from the database, $10 to $10,000; return addresses only
https on one allowed host; hosted page only; one customer per client and one session per attempt even across retries and network failures; Stripe "definitely no" marks the attempt failed, "unknown" leaves it open and retry-safe;
a session that cannot be recorded is never handed out; the secret key never appears in any result, body, URL or error.

## Adopting (every step is gated: needs the owner's explicit go in chat)
1. Owner decides the open points below.
2. Promote draft 13 to a real migration (number on approval), apply through the guarded staging workflow (validate first, then the owner types the phrase and clicks Approve).
3. Copy this folder to `supabase/functions/create-client-checkout-link/` (without the test-only files), copy `checkout-completed.ts` to `supabase/functions/_shared/`, add `entry("create-client-checkout-link", ...)` to `scripts/edge-function-manifest.mjs`
   and `[functions.create-client-checkout-link]` to `supabase/config.toml` (this function checks the owner's sign-in itself, so `verify_jwt = true` is the safer choice), apply the webhook patch, flip the "still a draft" checks in the test, then `npm run test:ci-parity`.
4. Guarded deploy of the two functions.
5. Plug in (Stripe TEST mode only): Supabase function secrets `STRIPE_SECRET_KEY` (test key) and `STRIPE_WEBHOOK_SECRET`; settings `NXQ_BILLING_ENABLED=true`, `NXQ_STRIPE_CHECKOUT_ENABLED=true`, `NXQ_CHECKOUT_RETURN_BASE_URL` (the staging site address); live mode stays `false`.
   Add `checkout.session.completed` to the events the Stripe webhook endpoint sends. The owner enters secrets by hand; no value goes in chat, files or logs.
6. Prove it on one non-QA staging client with Stripe's test card, read the attempt row and the webhook log, then decide about production. Roll back by setting `NXQ_STRIPE_CHECKOUT_ENABLED=false`.

## Open owner decisions
- Which clients get a checkout link and who sends it (today: the owner, by hand).
- The return address (`NXQ_CHECKOUT_RETURN_BASE_URL`) and whether `/client/billing` is the right landing page (it exists today).
- Free first month or trial: not built; a Stripe trial would be added to the session request on request.
- Plan price source: the client's `monthly_price`. If a plan change should re-price an open link, the database already closes an open attempt when the price changes.

## Not built (needs the owner's go, or is outside this task)
- The owner screen with the "Create checkout link" button (a screen calling the new function; parked until the function is adopted).
- Switching a client to billing-active from the checkout itself: the existing `invoice.paid` and subscription events already do this.
- Cancel, refund and plan-change through the Stripe API (the owner still does these inside Stripe, per the standing decisions).
- Live mode.
