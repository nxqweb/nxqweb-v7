# NXQ-Web handoff — upload this file to a new chat

Repository: `nxqweb/nxqweb-v7` · Branch: `safe/checkpoint-autonomy-wave35-sales` (never `main`).
Full rules: `CLAUDE.md`. Full live state: `docs/NXQ_RUNTIME_HANDOFF.md` (canonical launch checklist near the top).
This file is a portable copy of the "START HERE" section, written 2026-10-05.

**First steps for the new session:** read `CLAUDE.md` and `docs/NXQ_RUNTIME_HANDOFF.md`, run `git fetch origin
safe/checkpoint-autonomy-wave35-sales` and confirm local HEAD matches `git ls-remote`, then follow "Next 3 highest-priority
tasks" below. Never ask for or accept secret values in chat.

**CI incident + fix (2026-10-05):** my first NXQ->NXQX pushes turned GitHub CI red (about 14 workflows per push because open PR #11 doubles every run; each failure emailed the owner). Causes, all mine: (1) 7 contract validators pin exact wording in functions/src, (2) lint with `--max-warnings=0` (I had run `--quiet`), (3) THREE real functional bugs from over-broad renaming, caught by this audit and reverted: owner UI typed phrases `CONFIGURE-NXQ-STAGING-RUNTIME` and `APPROVE-NXQ-AUTONOMOUS-LAUNCH` (server/migration 226 require the NXQ spelling), and stored data markers `NXQ TARGETED MORE INFO REQUEST` / `NXQ MORE INFO REQUEST` (written by migrations 182/183, parsed in `ClientPortal.tsx` and `prepare-build-plan`). Also fixed a stale validator from an earlier session (`validate-maintenance-recovery-contract` expected the old column name). **New rule: run `npm run test:ci-parity` (runs the exact 64 commands CI runs, parsed from the workflow files) before every push; `npm run test:*` alone is NOT enough.** Rename rule: never rename a string that is stored data, a typed confirmation phrase, or compared against backend output; display copy only. Known gap: DB-generated visible text (journey read-model stages in migrations 190/218, capability copy stored in rows) still says NXQ; draft migration 04 covers only product/outreach display names, not the journey/read-model functions (would need a function-rewrite migration; not drafted, gated).

**Scanii deploy done on STAGING (2026-10-05, owner approved):** `NXQ Manual Supabase Stage` run #233 (`deploy_provider_readiness`, commit 6d8f2e3) succeeded in 50s; only the 'Deploy provider-readiness functions only' step ran (bootstrap-runtime-vault, check-provider-health, dispatch-notifications, malware-scan-provider-adapter, notification-provider-adapter, scan-client-file); every other step skipped (no migrations applied). The 'Verify staging Edge secret names' step did NOT run for this action, so Scanii secret presence is unverified by this run. **Scanii is NOT yet proven**: still needs the manual staging proof (clean file must come back clean, EICAR must come back infected) via `/client/files` as a staging client. **PR #11 was closed by the owner's decision** (draft; branch and 933 commits intact; reopen any time) to stop every push running CI twice. CI on 6d8f2e3 is green (Safe CI, Mega Extended, Security Audit, Portal Scale, Canonical Stage; three needed one re-run after a GitHub queue timeout). Owner turned off Actions emails and PR-push emails in GitHub notification settings; check CI via the Actions tab / tools.

**Draft-PR CI skip (2026-10-05, owner approved workflow edit):** 7 CI workflows (`ci`, `ci-mega-extended`, `security-audit`, `client-canonical-stage-contract`, `client-lead-pagination-contract`, `client-file-domain-isolation-contract`, `portal-scale-contract`) got one job-level line: `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`. Push runs are unchanged; runs triggered by a DRAFT PR are skipped, so an open draft PR #11 no longer doubles CI. PR #11 was reopened as a draft afterwards (cosmetic: the Claude app shows a red 'closed' badge for a closed PR). If #11 is ever marked ready for review, CI runs on it again.

**Scanii staging proof status (2026-10-05):** CLEAN-file half: owner's unsent chat draft said the clean upload 'came back clean' (not re-confirmed in a later message; treat as reported, not verified by me). INFECTED half: NOT proven. Owner downloaded the EICAR text file; Windows Defender blocked Notepad ('file contains a virus') and then removed the file, so it could not be uploaded (Defender stays ON by owner's choice). Remaining proof: upload EICAR from a machine/VM without real-time AV in the way and confirm it ends infected/blocked and never released. Notes: the client file bucket allows jpeg/png/webp/text-plain (migration 235) and the upload input has no type filter; Scanii scans by content, so image uploads use the same scan path.

**Lead funnel shipped in code (2026-10-05, NOT published):** `src/pages/ClientBusinessFunnel.tsx` + `src/lib/leadFunnel.ts` (pure maths) at `/client/business/funnel`, linked from the Business workspace. Owner decision: visible to ALL plans (built only from leads every plan already sees). Funnel counts use each lead's CURRENT status (Won also counts as Contacted/Qualified; spam excluded; Lost/Archived count only as Received); step rates show an em dash, never a fake 0%; up to 500 most recent leads (disclosed when capped); any failed fetch shows no figures. Tests: `npm run test:lead-funnel` (18 logic + 9 wiring checks); rendered and eyeballed in headless Chromium (dark, light, empty, error, 360px: no overflow). **Open (needs migration + ingest change, gated):** real lead SOURCE/campaign view. `client_leads.source` is always 'website' and `utm` is not returned by any client RPC. Plan: new RPC (or extend `current_client_leads_page`) to return `source`, `utm`, `contacted_at`, `converted_at`; make ingest derive `source` from `utm_source`; then add a Source/campaign panel (natural Intelligence-tier upgrade). Public Intelligence copy still promises 'Lead-source and funnel insights'.

**Reports monthly-cycle status shipped in code (2026-10-05, NOT published):** Reports page (`src/pages/ClientBusinessReports.tsx`) now has a 'Monthly report cycle' panel built by `src/lib/reportCycle.ts` from the client's own maintenance plan + `website_monthly_reports` (RLS reads): next report date, latest report, last 6 months, honest paused/off/no-plan/error states; the old combined list is retitled 'Business summary reports'. Tests: `npm run test:report-cycle` (18 logic + 5 wiring checks); rendered in headless Chromium (healthy, paused, dark, light). **Two report-generation gaps found, NOT fixed (owner/product decision, one is migration-level):** (1) NOTHING writes `client_monthly_business_reports` (the combined SEO/analytics/leads report), so that list is permanently empty; (2) `queue_due_website_maintenance()` (migration 102) creates the report row for the CURRENT month on the 1st and `monthlyReport` in `run-website-maintenance` summarizes tasks created in that same month, so a generated report would be almost empty (likely should cover the previous month), and the queued 'monthly_report' task starts as 'blocked' awaiting a reporting worker. Needs a decision before any client is promised monthly reports.

**Migration batch DRAFTED and DB-TESTED, NOT applied (2026-10-05; awaiting owner approval; each apply is a gated guarded-workflow run):** `docs/drafts/migrations/`: `04_nxqx_display_names` (NXQ-* -> NXQX-* display names; ids untouched; sent/approved outreach never rewritten; idempotent), `05_client_lead_sources` (`current_client_lead_sources(days)`: aggregated, sanitized UTM source/medium/campaign counts for the signed-in client, no personal data, authenticated-only), `06_monthly_report_covers_previous_month` (replaces `queue_due_website_maintenance()` so each monthly report covers the PREVIOUS complete month; test verified to FAIL on the old function and pass on the new). All three have sidecar tests; the official harness reports **21/21** (`NXQ_LOCAL_PG_OS_USER=postgres node scripts/test-local-full-schema.mjs`; the earlier 'no Postgres' failure was only this container: PostgreSQL 16 is installed, start it with `pg_ctlcluster 16 main start`). Not yet done: no UI calls `current_client_lead_sources` (it must NOT be wired until 05 is applied, the RPC-resolution checks would fail); the queued 'monthly_report' task still starts 'blocked' awaiting a reporting worker and `client_monthly_business_reports` still has no writer (separate decisions). To apply: promote 04/05/06 to `supabase/migrations/258+`, run `check-migration-integrity`, then the guarded `apply_migrations` workflow with the owner's explicit approval; afterwards wire the Source panel in `ClientBusinessFunnel.tsx`.

## LATEST UPDATE — NXQ→NXQX rename + Commerce launch prep (2026-10-05, read this first)

**Branch discipline note:** this session's container checkout was a stale, unrelated history (no merge-base with origin). It was
saved locally as `backup/local-e8c9594` (local only, never pushed; holds ~50 older commits incl. a "read-only staging migration
history" workflow step that is NOT on origin — cherry-pick only if wanted) and the working branch was reset to `origin` (`a6d1e26`) with
the owner's explicit approval ("Option A"). Always verify with `git fetch` + `git ls-remote` before work.

**Owner decision (legal):** every customer-facing "NXQ" brand name becomes **NXQX** (parent NXQX; branch **NXQX-Web**; products
**NXQX-Business/Booking/Commerce/Menu/Property/Multi-Location/Membership/Enterprise Systems**). This supersedes the old "NXQ-*"
branch naming in `scripts/validate-nxqx-brand-contract.mjs` (updated). Not legal advice; owner will confirm with a lawyer.

**Done (code only, local checks green, NOT published to Netlify):** visible brand text renamed in `src/`, `index.html`, `templates/`,
`README.md`, Edge-function copy (`supabase/functions/**`), and `docs/drafts/*.md`. The built bundle has 0 visible "NXQ" and 265 "NXQX".
**Deliberately NOT renamed (breaking/real identifiers):** DB tables/columns/RPCs (`nxq_*`), env/secret names (`NXQ_SCANII_*` etc.),
CSS vars/data-attributes (`--nxq-*`, `data-nxq-theme`), workflows, applied migrations, the setup-evidence marker
`NXQ WEB WEBSITE SETUP REPORT` (stored data code matches), the typed confirmation `CONFIGURE-NXQ-STAGING-RUNTIME`, and the real mailbox
`NXQweb@protonmail.com`. Other remote branches (47) were NOT touched (only the designated branch may be pushed).

**Still shows "NXQ" until applied (gated):** DB-sourced display names — `product_families.name`, `nxq_products.product_name`, outreach
sender names — via drafted `docs/drafts/migrations/04_nxqx_display_names.sql` (needs owner approval + staged apply). Edge-function copy
changes also need a deploy to take effect (gated; `deploy_functions` or scoped actions).

**Checks:** eslint 0, `tsc -b` 0, build OK, 26/27 local test scripts pass (only `test:local-full-schema` fails: no Postgres server in this
container — environment, unchanged), migration integrity 224/224.

**Commerce launch (client waiting) — findings:** Commerce is built (20+ client pages, owner hub, public storefront/checkout, migrations
036-257) but catalog status is `planned` ("In development", "owner review only"), owner product table marks it `qa`, public checkout is
`protected_test` (NO real payments), and live storefront provisioning is not yet proven end to end. Storefront payment links (Stripe/PayPal/
Venmo https only) already work. **DECISION (owner, 2026-10-05): Option A — private onboarding of ONE free test/showcase Commerce client.** She will not be charged; the owner builds her site manually; it must be hooked into the system so it works when NXQX-Web launches. No public flip of Commerce to `available` and no Stripe checkout for now. Findings: Commerce is ALREADY allowed through the guarded plan-change gate (`plan_change_enabled=true`, migration 040) while public status stays `planned`, so her path needs no code change: client requests plan change to Commerce -> owner approves in OwnerPlanChanges (approval touches no Stripe/billing, so she is not charged) -> migration 041 auto-creates her Commerce setup -> owner builds/provisions the storefront. Per-client limits can be raised with `commerce_usage_limit_overrides` (migration 051; owner-only). Remaining blockers are all gated/live: deploy `provision-storefront` (`deploy_provision_storefront`), a live staging dry run of the whole path, and the Netlify publish. Header decision: public header now shows NXQX with just "Web" beneath (commit 1131991).

**Analytics chart shipped in code (2026-10-05, after commit 2c4ce70; NOT published):** `ClientBusinessAnalytics` now has a real daily page-view + click chart (`src/components/DailyTrendChart.tsx`, `src/styles/trend-chart.css`), 30/90-day filter, 5-minute polling with "Updated N min ago", honest empty/refresh-failed states, keyboard + tooltip, light/dark skins. Rendered and eyeballed in headless Chromium (dark, light, 90-day, all-zero, sparse, 360px width: no overflow). New guard `npm run test:analytics-chart`; local gate: eslint, tsc, build OK, 27/28 tests (only `test:local-full-schema` fails: no Postgres in this container). `docs/PROMISE_AUDIT.md` row updated. Not proven with real traffic yet. Next safe tasks unchanged except (2): remaining dashboard work = mini-trend on `/client/business`, lead-source/funnel view (audit row "Not found"), monthly-cycle status on reports page.

**Next 3 safe tasks:** (1) Commerce free test client: with approval deploy `provision-storefront`, then a staging dry run of the plan-change -> setup -> storefront path; (2) real client dashboard from existing data (`docs/PROMISE_AUDIT.md`);
(3) with approval: draft-04 display-name migration + function deploys, Scanii deploy + EICAR test. Page title still reads "NXQX-Web by NXQX" (owner may want it shorter).

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
