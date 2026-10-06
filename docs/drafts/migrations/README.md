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
| `04_owner_link_stripe_customer.sql` | Owner-only link / unlink / list of a Stripe customer for a non-QA client (`owner_link_stripe_customer`, `owner_disable_stripe_customer_link`, `owner_list_stripe_customer_links`); no keys, prices or payments | `docs/STRIPE_LAUNCH_RUNBOOK.md` step 6 |
| `02_owner_client_directory_v2.sql` | Owner client directory v2 with `client_code` and `nxq_id`, searchable (additive) | `docs/CLIENT_ID_AND_NXQ_ACCOUNT_PLAN.md` |

Note: the pgcrypto search_path repair was promoted from a draft to real migration 257 on 2026-10-05
(approved by the owner; not yet applied to staging). Its regression test lives in
`scripts/sql/local-full-schema/regression/`. Draft numbering for the rest is assigned on approval (258+).

Drafts 04, 05 and 06 were promoted on 2026-10-06 (owner approved) to real migrations `258_nxqx_display_names`, `259_client_lead_sources` and `260_monthly_report_covers_previous_month`; their tests now live in `scripts/sql/local-full-schema/regression/`. The remaining drafts (01-03) apply after all real migrations and pass their sidecar tests in `npm run test:local-full-schema` (needs a local PostgreSQL; run as root with `NXQ_LOCAL_PG_OS_USER=postgres`). Nothing here is applied to staging or production.
