# Draft migrations (NOT real migrations)

SQL here is **not** in `supabase/migrations/`, so it is never picked up by the migration integrity check,
the guarded workflows, or any apply step. `scripts/test-local-full-schema.mjs` applies each draft (sorted
by file name) to its disposable local database AFTER all real migrations, then runs the sidecar
`<name>.test.sql`, which must end by selecting `DRAFT_TEST_OK`.

Moving a draft into `supabase/migrations/` (with its final number) and applying it is a stop-and-ask
gate: it needs the owner's explicit approval and the guarded staging workflow.

| Draft | Purpose | Plan |
|---|---|---|
| `01_outreach_inbound_and_unsubscribe.sql` | Opt-out and inbound-reply service functions plus an index | `docs/OUTREACH_MIGRATION_PLAN.md` section 3 |
| `03_malware_provider_scanii_readiness.sql` | Malware readiness accepts clean scans from Cloudmersive or Scanii; provider row made provider-neutral | `docs/MALWARE_PROVIDER_SCANII_PLAN.md` |
| `02_owner_client_directory_v2.sql` | Owner client directory v2 with `client_code` and `nxq_id`, searchable (additive) | `docs/CLIENT_ID_AND_NXQ_ACCOUNT_PLAN.md` |
| `04_nxqx_display_names.sql` | Customer-facing product/branch display names NXQ-* become NXQX-* (display values only; identifiers untouched; sent/approved outreach never rewritten) | owner decision 2026-10-05 |
| `05_client_lead_sources.sql` | `current_client_lead_sources(days)`: aggregated, sanitized lead channel / UTM source / medium / campaign counts for the signed-in client (no personal data) | `docs/PROMISE_AUDIT.md` (lead-source row) |
| `06_monthly_report_covers_previous_month.sql` | Scheduler creates each monthly report for the PREVIOUS (complete) month instead of the just-started current month | `docs/PROMISE_AUDIT.md` (monthly cycle row) |

Note: the pgcrypto search_path repair was promoted from a draft to real migration 257 on 2026-10-05
(approved by the owner; not yet applied to staging). Its regression test lives in
`scripts/sql/local-full-schema/regression/`. Draft numbering for the rest is assigned on approval (258+).

All six drafts apply after the 224 real migrations and pass their sidecar tests in `npm run test:local-full-schema` (needs a local PostgreSQL; run as root with `NXQ_LOCAL_PG_OS_USER=postgres`). Nothing here is applied to staging or production.
