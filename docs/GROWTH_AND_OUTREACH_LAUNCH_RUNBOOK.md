# NXQ growth and outreach launch runbook

This system is implemented to fail closed. Database migrations and Edge Functions do not turn on public referrals, grant enrollment, Stripe billing, or external outreach by themselves.

## What is built

- A unique referral profile and share code for each client.
- A $10 referred-client first-invoice credit and a separate $10 referrer reward.
- Referrer rewards mature only after a verified first payment, a 14-day hold, and automated risk review.
- A non-cash ledger with pending, available, applied, blocked, and reversed evidence.
- FIFO credit application that always leaves at least $10 due and can never create cash value or an amount owed by NXQ.
- Refund and dispute reversal handling from the verified Stripe webhook.
- Server-enforced monthly resource reservations with 80% warnings, 100% hard stops, idempotency, and provider-cost ceilings designed to preserve at least $40 per ordinary client before referral credits.
- The application-based NXQ Founding Business Grant, limited to ten awards inside the first 10,000 eligible clients and capped at $50 of NXQ cost per awarded client per month.
- An approval-first Client Finder with approved niches, provider imports, factual website audits, deterministic zero-key drafting, optional model-assisted drafting, suppression, duplicate prevention, business hours, daily caps, follow-ups, reply classification, and an emergency stop.
- Fictional `example.invalid` QA that cannot deliver externally.

## Safety defaults

Keep these defaults until their prerequisites are complete:

| Control | Safe value | Required before enabling |
|---|---:|---|
| Referral program | Off | Terms, fraud policy, Stripe webhook, invoice-credit integration tests |
| Founding Grant enrollment | Off | Legal review and written award terms |
| Founding Grant legal review | Incomplete | Qualified attorney approval |
| Stripe billing | Off | Adult-owned verified Stripe account and bank settlement |
| Outreach automation mode | Review only | Ten clean owner-reviewed runs and compliance review |
| Outreach emergency stop | On | Healthy mailbox/provider and owner decision |
| External email delivery | Off | OAuth mailbox, unsubscribe handling, DNS authentication, and owner decision |

## Protected configuration names

Set values only in Supabase Edge Function Secrets or Vault. Never put secret values in GitHub, the browser, screenshots, or client-side environment variables.

- `NXQ_AI_MODEL_PROVIDER_URL`
- `NXQ_AI_MODEL_PROVIDER_TOKEN`
- `NXQ_AI_MODEL_PROVIDER_MODEL`
- `NXQ_PROSPECT_DISCOVERY_PROVIDER_URL`
- `NXQ_PROSPECT_DISCOVERY_PROVIDER_TOKEN`
- `NXQ_OUTREACH_PROVIDER_URL`
- `NXQ_OUTREACH_PROVIDER_TOKEN`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

The Client Finder works without the optional AI and discovery keys by using fictional discovery and deterministic drafts. It does not work around missing provider credentials by scraping or guessing emails.

## Activation order

1. Apply migrations 229 and 230 in staging.
2. Deploy the three Client Finder Edge Functions and the updated Stripe webhook in staging.
3. Seed resource policies for each staging client with `nxq_seed_client_resource_policies`.
4. Run `npm run test:growth` and the full `npm run test:release` gate.
5. Run fictional discovery, website-audit rejection tests, deterministic draft tests, unsubscribe tests, duplicate tests, quota exhaustion tests, referral refund/dispute tests, and invoice-floor tests.
6. Complete legal review for referrals, promotional terms, privacy, outreach, and the Founding Business Grant.
7. When an adult-owned bank/Stripe account is available, configure Stripe in staging and test signed webhooks plus refunds/disputes.
8. Connect an OAuth business mailbox, configure SPF/DKIM/DMARC, and keep external delivery off while reviewing the first ten campaigns.
9. Begin with 10–20 owner-reviewed messages per business day. Increase only while bounce and complaint rates remain below the configured emergency thresholds.
10. Require ten clean disposable lifecycle runs, complete launch-readiness evidence, and explicit owner launch approval before production.

## Referral economics example

For a $50 monthly invoice and $100 of available referral credit, the protected $10 minimum produces $40 credit in month one, $40 in month two, and $20 in month three. The client never receives cash, and NXQ never owes a negative balance.

## Outreach rules

- Use only lawful, approved public-business-data providers and business contact information.
- Every claim must come from a stored source or a factual website audit.
- Do not fabricate performance problems, guaranteed results, identities, or customer relationships.
- Do not buy random lists, scrape private data, spoof senders, or bypass provider terms.
- Honor unsubscribe, hard bounce, complaint, and do-not-contact signals permanently.
- Describe NXQ as a premium done-for-you website service; AI is internal tooling, not the sales promise.
- The 50-client-per-month target is a goal, not a guarantee. Measure qualified replies, appointments, closes, refunds, complaints, acquisition cost, and capacity.

## Remaining external blockers

- Adult-owned banking and Stripe onboarding.
- Legal review before public referral or grant advertising.
- Netlify production-deploy credits.
- Real discovery-data and email-provider credentials.
- Owner approval of each launch switch and the final production launch.
