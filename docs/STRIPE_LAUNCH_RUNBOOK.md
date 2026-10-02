# NXQ Stripe launch runbook

Stripe is prepared but intentionally disabled. Do not enable live billing until the legal account owner is eligible, the payout bank account exists, and NXQ staging is otherwise launch-ready.

## Already implemented

- Stripe-first provider registration with billing disabled by default.
- Raw-body webhook signature verification with a five-minute tolerance.
- Server-side Stripe-customer-to-NXQ-client mapping; webhook payloads cannot choose a client.
- Idempotent, ordered normalized billing events.
- Disposable QA billing hard stop.
- No automatic service freeze after one failed payment.
- Public Stripe Payment Link support without accepting secrets in the browser.
- Legacy PayPal/Venmo values remain readable for existing clients but are no longer the preferred setup.

## Secrets to add later

Add these only to Supabase Edge Function Secrets, never to source code or a browser form:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NXQ_BILLING_ENABLED` — keep `false` until the final activation step
- `NXQ_STRIPE_LIVE_MODE_ENABLED` — keep `false` throughout staging and until the separate production launch approval

Price IDs should be stored as protected plan configuration when products are created. Do not hard-code them in the frontend.

## Test-mode activation order

1. Create the eligible Stripe business account and attach the payout bank account.
2. Use Stripe test mode.
3. Create the webhook endpoint for `ingest-stripe-webhook`.
4. Subscribe only to invoice and customer subscription events used by the adapter.
5. Add the test secret and webhook signing secret.
6. Link a test Stripe Customer ID to a non-QA NXQ staging client in `billing_provider_customer_links`.
7. Set `NXQ_BILLING_ENABLED=true` in staging only.
8. Send signed test events and verify idempotency, out-of-order handling, recovery, and failure behavior.
9. Confirm the billing readiness check becomes ready.
10. Keep production disabled until every required launch check is ready and the owner records the final signoff.

## Emergency rollback

1. Set `NXQ_BILLING_ENABLED=false` immediately.
2. Disable the Stripe webhook endpoint in Stripe.
3. Do not delete provider events; retain them for audit and reconciliation.
4. Mark affected customer links inactive only after exporting their mapping evidence.
5. Reconcile Stripe invoices against NXQ billing state manually.
6. Re-run staging tests before any reactivation.

This rollback does not delete customer data, issue refunds, cancel subscriptions, or change production automatically.

## Evidence gates before launch

Stripe activation does not bypass launch readiness. Staging runners must publish
fresh, zero-failure, SHA-256-addressed evidence for the template repository,
tenant RLS, storage isolation, domain simulation, and maintenance/restore suites.
Evidence expires automatically and only the service role may record it. The final
owner launch signoff remains a separate human action after every required check is
ready.
