# Email notifications: how they work and how to turn them on

Written 2026-10-06. Code: `supabase/functions/_shared/notification-email.ts` (pure logic), `supabase/functions/dispatch-notifications/index.ts` (the sender),
`supabase/functions/notification-provider-adapter/index.ts` (the Resend call). Tests: `npm run test:notification-email` (34 checks, negative controls verified).

## What was wrong before
The sender needs the recipient's address on every email row, but nothing ever filled `notification_deliveries.recipient_reference`, and almost every
notification is created in-app only. So no email could have gone out end to end, and the earlier "1 notification delivered" in dispatcher logs was an
in-app notice.

## What happens now (only after the owner switches it on)
1. When the sender delivers an in-app notice whose template is on the allow-list, it first creates an **email copy** with the address filled in
   (idempotent: never twice for the same recipient), then marks the in-app notice delivered. A failure creating the copy never blocks the in-app notice.
   - Client allow-list: `billing_payment_succeeded`, `billing_payment_failed`, `billing_past_due_reminder`, `client_file_quarantined`, `new_commerce_request`.
   - Owner allow-list (one copy per distinct valid owner address, at most 5): `billing_freeze_review_owner_attention`, `billing_processor_connection_required`.
   - Everything else stays in-app. Extend the lists deliberately in `notification-email.ts`.
2. The existing preference rules still apply to every email row (client email off, quiet hours, digest batching, via `notification_delivery_decision`).
   Clients turn email off on their notification-preferences page.
3. Email rows with no address (the batched digests) fall back to the client's contact email at send time; if there is none the row is blocked with a reason.

## Safety rules enforced in code
- **Off by default.** Nothing is emailed unless the Supabase Edge secret `NXQ_EMAIL_NOTIFICATIONS_ENABLED` is exactly `true` AND the notification adapter is configured.
  With it off, email rows are blocked with an explanatory message and in-app notices are unaffected.
- Never to QA-only clients (also blocked by a database trigger), never to archived/dormant clients, never to reserved test domains (`.invalid`, example.com/org/net).
- No secret or key is logged; the owner address comes from the owner's sign-in account at send time, it is not stored anywhere new except on the email row itself.

## Turning it on (owner steps, after the function deploy)
1. Deploy through the guarded workflow action `deploy_provider_readiness` (also ships the notification adapter and the Scanii functions); Claude starts it, the owner approves `nxq-staging`.
2. In Supabase Edge Function secrets add `NXQ_EMAIL_NOTIFICATIONS_ENABLED` = `true` (not a secret value, but keep it in the same place).
3. Cause one allow-listed event for a client whose contact email is yours (for example an infected test upload makes `client_file_quarantined`), run the dispatcher,
   and check the inbox. Confirm the in-app notice and the email both arrive and that a second dispatcher run sends nothing new.

## Turning it off
Set `NXQ_EMAIL_NOTIFICATIONS_ENABLED` to anything but `true` (or delete it). Takes effect on the next dispatcher run; no deploy needed.

## Not covered yet
Real delivery, bounce, unsubscribe-link and complaint handling for these emails (provider-side events) are not proven; the Resend sender domain and the From address
must be verified in Resend before real clients are emailed.

## Live test finding (2026-10-06, staging)

First live run: a denied test client got an email copy (queued) but it was never sent. The database paid-capability guard (migration 246, `nxq_guard_notification_transition`) refuses to move any non-in-app notification to `sending` unless the client is approved with active billing (billing/security/privacy/account templates are checked against platform usage instead). So:

- `business_setup_denied` was removed from the email list: a denied client can never pass the guard. Telling a denied client by email would need a deliberate migration (a product decision), not a code tweak.
- A send the guard refuses is now recorded as `blocked` with the reason instead of being skipped silently and retried forever.
- To prove delivery end to end, use an event for a client that is approved with active billing and whose contact email is the Resend test address (for example an infected test upload, `client_file_quarantined`).


## Result (2026-10-06)

Proven on staging: an infected test upload for an approved, billing-active, non-QA test client produced a real email in the owner's inbox. Resend's free test sender only delivers to the Resend account's own email (HTTP 403 otherwise), so real customers need a verified sending domain. Not proven: bounces, complaints, unsubscribe link.
