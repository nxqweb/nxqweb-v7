# NXQ-Web — what the code does, and what is left

Written 2026-10-02 from the code at HEAD on `safe/checkpoint-autonomy-wave35-sales`.
Source of every line: files in this repo (223 migrations, 44 Edge functions, 64 pages,
`templates/`, `scripts/`). **"Built" means the code exists and local checks pass. It does
not mean it has been proven live.** Live proof is tracked separately in the canonical
launch checklist at the top of `docs/NXQ_RUNTIME_HANDOFF.md`.

Status labels used below:

- **BUILT** — code present; local lint/type/build/validators pass.
- **STAGING** — the supporting migrations are applied to staging (`nxqweb-staging`).
- **LIVE-PROVEN** — a real run on staging/production has shown it working.
- **BLOCKED** — needs an external key/service/decision before it can run.
- **NOT BUILT** — not in the code (or catalog-only).

---

## 1. What NXQ-Web is

A multi-tenant website operations platform. A business signs up, describes itself, the
owner approves or denies it, and a backend pipeline builds a preview site, then (after
verification) promotes it to production and maintains it. Clients manage their account in
a portal; the owner runs everything from an owner portal.

Hard rules in the code (README + migrations):

- Signup makes a lead; finished intake makes exactly one owner APPROVE/DENY decision.
- **DENY is a hard stop** — no provider infrastructure is created.
- One APPROVE starts an idempotent, checkpointed lifecycle (retries reuse resources).
- Supabase is the source of truth; the browser never holds service-role credentials.
- Preview and production are separate. Production promotion is exact-commit,
  fast-forward-only, and locked until verified.
- Clients own and renew their own domains; NXQ never registers or holds them.

## 2. Products and plans (from `src/lib/productCatalog.ts`)

| Product | Catalog status |
|---|---|
| NXQ-Business (managed websites for service businesses) | **available** |
| NXQ-Commerce (online storefront) | catalog says *planned*, but a full Commerce stack is built (see 4) |
| NXQ-Booking | planned — schema/blueprint scaffold only (`templates/booking-v1`, migration blueprint) |
| NXQ-Menu, NXQ-Property, NXQ-Membership | planned — catalog entries only |
| NXQ-Multi-Location | planned in catalog; self-serve add-on exists in code (migrations 251/252) |
| NXQ-Enterprise Systems | private (custom quote) |

Plan tiers: **Starter $50/mo**, **Growth $100/mo**, **Intelligence $150/mo**,
**Enterprise $300+/mo** (public starting price; the database floor stays $150). Tier limits are enforced on the server, not just in the UI
(migrations "server_side_tier_entitlements", "enforce_paid_capability_boundaries",
"enforce_economic_hard_ceiling").

Note: the catalog marks Commerce "planned" while the code has a complete Commerce
portal. That is a product-status decision for you, not a bug.

## 3. NXQ-Business pipeline — BUILT, STAGING

1. **Signup + intake** — public signup with plan/product-family choice; intake questions
   per product; bot protection (Cloudflare Turnstile verified server-side).
2. **Owner decision** — one APPROVE/DENY per client (`/owner/preview-requests`,
   `/owner/production-launches`). Denial blocks the pipeline.
3. **Infrastructure** — `provision-project-infrastructure` creates the project resources
   after approval.
4. **Build plan** — `prepare-build-plan`, `generate-business-build-plan` (AI enrichment is
   optional and fails closed without a provider key).
5. **Website build** — `build-business-website` from `templates/business-v1` (pages, lead
   form, accessibility, analytics, privacy/terms, niche presets: tree service, roofing,
   auto detailing); plus `build-business-location-pages` and `build-business-seo-artifacts`.
6. **Preview** — `prepare/execute-preview-netlify-build`, `check-preview-netlify-status`,
   `check-preview-deployment-safety`.
7. **Production** — `check-production-launch-audit`, `promote-business-production`
   (exact commit), `execute-production-netlify-build`, `publish-production-netlify-deploy`,
   `verify-deployment-connection`.
8. **Maintenance** — `run-website-maintenance`, change requests
   (`classify-business-change-request`, `apply-business-change-request`), SEO publish
   lane, domain reconciliation (`reconcile-domain`).

Netlify spending is guarded (credit-guard migration; `nxq_reserve_netlify_build`
reserves a budget before every build).

## 4. NXQ-Commerce — BUILT, STAGING

Client side (11 pages under `/client/commerce/*`): setup, catalog, products, categories,
inventory, images, website content, orders, requests, usage, readiness, preview, live
store, tutorial. Public side: storefront, checkout, customer request form.
Backend: product images/media with protected uploads, inventory controls, direct-payment
orders with fulfillment transitions, monthly usage limits, storefront provisioning
(`provision-storefront`, fixed and redeployed this chat), owner review/build queue
(`/owner/commerce*`). **No payment processor is connected** (checkout is "non-payment
launch readiness"; Stripe is separate, see 7).

## 5. Client portal (33 pages) — BUILT

Dashboard/portal home, launch journey, value & history, website health, domain status and
recheck, files (private bucket, virus-scan gate), billing status, notifications and
preferences, security & privacy (data-subject requests), rewards/referrals, settings,
plan change requests; Business pages: dashboard, leads, analytics, SEO, reports, change
requests, locations (multi-location add-on).

## 6. Owner portal (20 pages) — BUILT

Command center, exception center (now also reads `automation_escalations`), automation
health, provider health, deployments, preview requests, production launches/status,
launch readiness + signoff, plan changes, billing lifecycle, files, growth center, sales
pipeline (AI prospect finder + outreach drafts, owner-approved), product families,
commerce hub/usage/builds/reviews, storefront provisioning.

## 7. Billing, referrals, economics

- **Billing foundation — BUILT, STAGING**: manual billing state machine, grace periods,
  human billing freeze, verified provider events, ordered event processing, notification
  events (253/254). `ingest-stripe-webhook` verifies the Stripe HMAC with a 5-minute
  window. **Stripe test mode is not set up → BLOCKED**; no live billing.
- **Referrals & grants — BUILT, STAGING**: credits, grant ceilings, quotas, invoice
  floor, per-client cost guards (migration "referrals_grants_and_cost_guards").
- **Economic hard ceiling — BUILT**: server refuses actions that would breach the
  per-client cost margin, including at the $50 Starter tier.

## 8. Security and privacy — BUILT

Row-level security on all 178 public tables (static analysis: 178/178). Tenant-derived
reads, storage isolation, SSRF guard on 12 outbound-capable functions (the other 6
call fixed provider hosts, 1 has its own inline guard), timing-safe token checks,
CORS/OPTIONS handling, JWT boundaries declared per function, step-up auth hooks,
privacy/GDPR request processing (`process-data-subject-request`), file malware scanning
(**BLOCKED** until a scanner key is set), explicit Data-API grants (migrations 255).

## 9. Automation and operations — BUILT, STAGING

Job queue + workers with leases and heartbeats, dispatcher watchdog, provider health
checks and owner recheck controls, notification dispatcher (email through Resend —
**BLOCKED** until configured) with preferences/digests, backup/restore drills, staged
scale controls (allocator, paginated read models), launch-readiness evidence and a
strict **ten-clean-run gate**, owner signoff record.

## 10. Verification that exists

17 `npm run test:*` scripts, a 223-migration disposable-database test, RPC argument
contract validators, trigger-field validators, a lint/type/build gate, a 67-route
browser smoke test. Latest run (2026-10-02): all pass locally. **These are not external
QA evidence and do not count toward the ten required runs.**

## 11. What is left

External / needs you:

- Malware-scan provider key (Cloudmersive — support message sent, no reply yet)
- AI provider URL/token/model/protocol (build-plan enrichment, change classifier,
  sales finder)
- Resend (or other) email sender configuration
- Stripe test mode, then later a payout account
- Netlify credits; one controlled build + "Publish deploy" to get current frontend live
- Company/product name and domain; support identity
- **Ten consecutive clean external QA runs** (real Supabase + GitHub + Netlify), then
  recovery proof and your explicit signoff — this is the production gate
- Legal/sales copy review

Product decisions still open:

- Whether Commerce is "available" (catalog says planned)
- Booking, Menu, Property, Membership: catalog only — decide whether any ship at launch
- Orphaned `commerce_cart_items` / `commerce_carts` tables (cleanup needs a migration)
- Fuller notification center (mark-as-seen/unread badge)
- Optional anon-grant revokes on 7 tables (not approved)

Known stale data on the owner pages (harmless): old `pd.published_url` errors (fixed by
migration 233), old Netlify-credit and backup-metadata alerts.
