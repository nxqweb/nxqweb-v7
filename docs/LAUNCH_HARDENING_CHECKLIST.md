# Launch hardening checklist

This checklist is evidence-based. A missing external provider, credential, browser deployment, or runtime observation stays blocked or unknown; it must never be reported as ready from code presence alone.

## Permanent operating rules

- Clients purchase, own, and renew their domains through a registrar they choose.
- NXQ never purchases, registers, owns, renews, transfers, or collects registrar passwords for client domains.
- NXQ may provide exact DNS records, verify ownership/control, reconcile DNS, verify SSL, and monitor connection health.
- Preview sites may run without a client domain. Production launch requires a client-owned domain when a custom domain is desired.
- No live email, outreach, billing, provider mutation, or production deployment occurs without the applicable configured gate.
- Never use placeholder secrets or fabricated evidence to make a readiness check pass.

## Proved locally or in staging

- Database migrations and Edge Functions can be applied to staging through the guarded workflow.
- Zero-key validation, JWT boundaries, migration integrity, and Turnstile server verification pass.
- APPROVE and DENY lifecycle foundations exist with owner-controlled production gates.
- Referral credits, grant ceilings, quotas, invoice floor, and outreach suppression controls exist.
- Tenant/RLS, storage isolation, provider health, recovery simulation, and ten-clean-run gates have deterministic contract validators.

## Work that can be proved without Netlify credits

- Run lint, TypeScript/build, migration integrity, Edge Function checks, security audits, and contract validators.
- Apply migration 231 to staging after review and confirm new domain writes must be client-owned.
- Run tenant/RLS, storage, recovery, provider-health, notification, classifier, quota, referral, and webhook simulations that do not require provider calls.
- Refresh the readiness read model only from recorded staging evidence.

## Externally blocked or credential-dependent

- Fresh Netlify frontend build and browser Turnstile submission test.
- Real AI build-plan and classifier runtime using an approved provider key.
- Real notification delivery, bounce, unsubscribe, and complaint processing.
- Production-approved malware scanning.
- Stripe test-mode webhook and payment lifecycle, followed later by an eligible adult-owned payout account.
- Client-owned production domain DNS and SSL runtime test.
- Ten clean disposable end-to-end runs with all required providers available.

## Final production gates

- Final company/product name and support identity configured through environment values.
- All required runtime evidence is recent, tenant-safe, and free of unresolved blockers.
- Legal/sales copy reviewed, including outreach and referral terms.
- Explicit owner production-launch approval recorded independently of automated checks.
- Production deploy performed through the guarded workflow; rollback evidence verified afterward.
