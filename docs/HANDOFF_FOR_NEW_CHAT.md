# NXQ-Web handoff — upload this file to a new chat

Repository: `nxqweb/nxqweb-v7` · Branch: `safe/checkpoint-autonomy-wave35-sales` (never `main`).
Full rules: `CLAUDE.md`. Full live state: `docs/NXQ_RUNTIME_HANDOFF.md` (canonical launch checklist near the top).
This file is a portable copy of the "START HERE" section, written 2026-10-05.

**First steps for the new session:** read `CLAUDE.md` and `docs/NXQ_RUNTIME_HANDOFF.md`, run `git fetch origin
safe/checkpoint-autonomy-wave35-sales` and confirm local HEAD matches `git ls-remote`, then follow "Next 3 highest-priority
tasks" below. Never ask for or accept secret values in chat.

## Latest session state (2026-10-05, end of the long design/security session)

**Branch:** `safe/checkpoint-autonomy-wave35-sales`. **HEAD:** the commit that added this section (check `git log -1`).
Working tree clean at handoff. Verify against `origin` before doing anything (`CLAUDE.md`).

**Live site:** `nxqweb-v9-staging.netlify.app` is PUBLISHED from branch deploy `@3581cf1` (premium UI) and **locked**; Netlify builds
are **stopped**. Everything committed after `3581cf1` is NOT live (Enterprise $300+, client IDs, founding program, owner graph,
password re-check, link safety, the server-function fixes below). To publish: Active builds -> one safe-branch build -> Publish
deploy -> lock -> stop builds. Do not merge PR #11 (production branch is `main`; auto publishing would put everything live).

**Done this session (all committed, local checks green):**
- Premium "Obsidian & Champagne" UI for public pages + portal skin; owner Log out; client "At a glance" graph with NXQ ID and
  client ID (copy); owner header graph (clients, income, approvals, messages) from the real owner summary; Enterprise public
  price `$300+/mo` with "Everything in Intelligence"; text-only Founding client program (5 testers 50% off 12 months, 10 free
  spots under terms; no counter); promise audit (`docs/PROMISE_AUDIT.md`).
- **Security/function scan:** new `npm run test:select-columns` checks 929 database reads and 411 writes against the migrations and
  found 3 real bugs, now fixed in code: privacy **export always failed** (`process-data-subject-request` read non-existent
  `nxq_accounts.status` and `nxq_product_memberships.product_key/status/verification_level`); `provision-storefront` owner path read
  non-existent `owner_users.role` (owner-started runs refused); `run-website-maintenance` backup check read
  `last_production_commit` (real column `last_deployed_commit`). All 281 RPC calls, 17 Edge-function calls and 3 storage buckets
  resolve. Email/password changes now re-check the current password (`ClientSettings.tsx`, guarded by `test:auth-guards`).
  Public storefront payment buttons only show https links on Stripe/PayPal/Venmo hosts (`src/lib/safeUrl.ts`, `test:safe-url`),
  and store owners are told when a link would be hidden.
- Scanii malware scanning supported in the adapter (fail-closed, `test:scanii`); owner set `NXQ_SCANII_API_KEY`,
  `NXQ_SCANII_API_SECRET`, `NXQ_SCANII_REGION=us1` in Supabase (values never in chat); no Cloudmersive key exists anywhere.
- Plans: `docs/MALWARE_PROVIDER_SCANII_PLAN.md`, `docs/FOUNDING_CLIENT_PROGRAM_PLAN.md`, `docs/WAITLIST_AND_EXAMPLE_PAGE_PLAN.md`,
  `docs/NXQX_UMBRELLA_SITE_AND_DOMAIN_PLAN.md` (one domain with paths; name/trademark check steps; USPTO was not reachable here).

**Checks at handoff:** 104/106 local validators/tests pass (the 2 failures need staging credentials:
`audit-commerce-reference-remote-auth`, `validate-paid-capability-guards-staging`); `npm audit` 0 vulnerabilities; lint, `tsc -b`,
build, routes, accessibility 19/19, security audit, local full-schema harness 15/15; release gate unchanged (1,273 PASS, stops at
`protected-staging-configuration`).

**Server fixes NOT deployed yet (each needs owner approval + guarded workflow):**
`malware-scan-provider-adapter` (Scanii) and `scan-client-file` via the existing `deploy_provider_readiness` action;
`provision-storefront` via `deploy_provision_storefront`; `process-data-subject-request` and `run-website-maintenance` have no
scoped deploy action (only `deploy_functions`, which deploys all no-verify-jwt functions; adding a scoped action is a workflow edit).

**Open findings (not fixed):** (1) clients can read their own `data_subject_requests.last_error` through the API even though the page
hides it (low; needs a view/column grant = migration). (2) 7 anon table grants (RLS blocks them; revoke = migration). (3) wildcard CORS
on bearer-token functions (low). (4) staging "Worker Dispatcher" fails in ~2 s on schedule from `main`; likely the `nxq-staging`
environment branch rule; owner to read the run's red message. (5) Supabase server-side "secure password change" setting not checked
(external). (6) readiness/secret-profile lists and workflows still name `NXQ_CLOUDMERSIVE_API_KEY` (see Scanii plan). (7) privacy
export is "bounded" (no files/messages) - matches its note, but the public promise should not imply a full export.

**Owner decisions in force:** Enterprise $300+; founding program as above; no export lock (owner proposed 5-year lock - advised
against, decision pending: options free export + paid migration service / annual prepay / setup fee); one domain with paths
preferred (plan written); outreach email only, US only, lawyer review before any send; never paste secrets in chat.

**Next 3 highest-priority tasks:**
1. With owner approval: deploy `deploy_provider_readiness` (Scanii) and run the clean-file + EICAR test in staging; then decide on
   the readiness-list change and draft migration 03.
2. Real client dashboard from existing data (analytics rollups chart, leads, health, change requests; tier-gated; honest empty
   states) - no migration needed (`docs/PROMISE_AUDIT.md` fix list).
3. Outreach: promote draft 01 (unsubscribe + inbound reply) with approval; build the dispatch and unsubscribe functions held behind
   the emergency stop; "preview site for a prospect" flow.

**Exact instruction for the next session:** read `CLAUDE.md` and this file, verify live git state against `origin`, ask the owner
(1) whether the deploy approval for `deploy_provider_readiness` is given, (2) the red message on a failed "Staging Worker Dispatcher"
run, (3) any news on card/domain/lawyer; then resume with the next task above.

## Done / left (this session)
- [x] Premium UI published (deploy `3581cf1`, locked; builds stopped)
- [x] Owner Log out, client graph + IDs, owner graph, Enterprise $300+, founding program, promise audit (code; not published)
- [x] Full scan: 3 broken server functions fixed in code; schema checker (929 reads, 411 writes, 428 filters)
- [x] Current-password re-check for email/password changes; storefront payment-link allowlist
- [x] Scanii support in code; Scanii secrets set by owner in Supabase
- [ ] Owner approval + guarded deploys (Scanii adapter, storefront, export worker, maintenance worker)
- [ ] Staging test: clean file + EICAR
- [ ] Publish the newer code to Netlify (owner)
- [ ] Red message from a failed "Staging Worker Dispatcher" run (owner)
- [ ] Name/trademark check, domain purchase, lawyer review, payment card (owner)
