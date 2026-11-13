# Plug-in checklist: Claude (AI), Stripe test mode, email, scanner (written 2026-11-13)

Goal (owner, 2026-11-13): when the keys exist, plugging them in is the ONLY step left. Secret NAMES only; values never go in chat, code, logs, screenshots or workflow boxes.
The owner types each value by hand into Supabase (Project settings -> Edge Functions -> Secrets) unless a line says GitHub. Every key's expiry month goes in `docs/EXPIRING_TOKENS.md`
(the exact day in the password manager); rotation is also covered by the 2027 reminder. Deep detail: `docs/STRIPE_AND_AI_PLUG_IN_DAY.md`, `docs/STRIPE_TEST_MODE_WALKTHROUGH.md`,
`docs/EMAIL_NOTIFICATIONS.md`, `docs/MALWARE_PROVIDER_SCANII_PLAN.md`.

## Before any key (owner, once)
- Migrations 288 to 293 applied and the functions deployed (`deploy_functions`), the evidence suite refreshed. Claude lists what is pending in `docs/NXQ_RUNTIME_HANDOFF.md`.

## 1. Claude as the AI provider (two readiness checks: build-plan enrichment and the change classifier)
Needs migration 293 (the build-plan check only counted the OpenAI protocol names before it).
| Edge secret | Value to enter |
|---|---|
| `NXQ_AI_MODEL_PROVIDER_URL` | `https://api.anthropic.com/v1/messages` |
| `NXQ_AI_MODEL_PROVIDER_TOKEN` | the Anthropic API key (console key, only you see it) |
| `NXQ_AI_MODEL_PROVIDER_MODEL` | a model name copied from the Anthropic console (a Sonnet-class model is the sensible first choice for build plans) |
| `NXQ_AI_MODEL_PROVIDER_PROTOCOL` | `anthropic_messages` |
Then: owner runs `prove_business_build_plan_ai` (typed phrase, Approve); Claude reads the log. Expected: a real structured build plan, and "AI build-plan enrichment" moves toward ready once a real
enrichment is seen by the build worker. The change classifier proves itself the first time a client change request is classified (it has no protocol test). Not proven until a real key is used:
the exact request shape against Anthropic's live API (it is covered by offline tests only).

## 2. Stripe, TEST mode first (the code listens to Stripe; it does not create subscriptions)
| Where | Name | Value |
|---|---|---|
| Edge secret | `STRIPE_SECRET_KEY` | the TEST secret key (`sk_test_...`) |
| Edge secret | `STRIPE_WEBHOOK_SECRET` | the `whsec_...` for the endpoint you create in Stripe pointing at `ingest-stripe-webhook` |
| Edge secret | `NXQ_BILLING_ENABLED` | `true` in STAGING only, after a test customer is linked on `/owner/billing` |
| Edge secret | `NXQ_STRIPE_LIVE_MODE_ENABLED` | stays `false` |
| Edge secret | `NXQ_REFERRAL_CREDITS_ENABLED` | stays off until the referral proof (draft migration 290 is the credit lock) |
You create the test subscription by hand in Stripe and link the customer; payments, refunds, disputes and (later) referral credits are handled and tested against a pretend Stripe.
Roll back any time by setting `NXQ_BILLING_ENABLED` to `false`.

## 3. Email (Resend) for the notification dispatcher
| Edge secret | Value |
|---|---|
| `NXQ_RESEND_API_KEY` | the Resend key |
| `NXQ_NOTIFICATION_FROM_EMAIL` | a From address on a domain verified in Resend |
| `NXQ_EMAIL_NOTIFICATIONS_ENABLED` | `true` |
Adapter token and URL secrets (`NXQ_NOTIFICATION_ADAPTER_TOKEN`, `NXQ_NOTIFICATION_ADAPTER_URL`) are internal; check them with the provider-readiness validation before the first send.

## 4. File scanner (Scanii)
| Edge secret | Value |
|---|---|
| `NXQ_SCANII_API_KEY`, `NXQ_SCANII_API_SECRET` | from the Scanii account |
| `NXQ_SCANII_REGION` | optional, default `us1` |
Then one clean test upload on staging.

## What Claude does on plug-in day
Reads each run log, reports what the proof actually showed (not just a green check), and updates the handoff and the readiness checklist. Claude never sees a key value.
