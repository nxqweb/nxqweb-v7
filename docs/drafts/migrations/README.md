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
| `02_owner_client_directory_v2.sql` | Owner client directory v2 with `client_code` and `nxq_id`, searchable (additive) | `docs/CLIENT_ID_AND_NXQ_ACCOUNT_PLAN.md` |

Note: the pgcrypto search_path repair was promoted from a draft to real migration 257 on 2026-10-05
(approved by the owner; not yet applied to staging). Its regression test lives in
`scripts/sql/local-full-schema/regression/`. Draft numbering for the rest is assigned on approval (258+).

Drafts 04, 05 and 06 were promoted on 2026-10-06 (owner approved) to real migrations `258_nxqx_display_names`, `259_client_lead_sources` and `260_monthly_report_covers_previous_month`; their tests now live in `scripts/sql/local-full-schema/regression/`. The remaining drafts (01-03) apply after all real migrations and pass their sidecar tests in `npm run test:local-full-schema` (needs a local PostgreSQL; run as root with `NXQ_LOCAL_PG_OS_USER=postgres`). Nothing here is applied to staging or production.

Draft 04 (`owner_link_stripe_customer` and friends) was promoted on 2026-10-06 (owner approved) to real migration `261_owner_link_stripe_customer`; its test now lives in `scripts/sql/local-full-schema/regression/`.

Draft 05 (revoke the `anon` role's privileges on 7 core tables) was promoted on 2026-10-06 (owner approved) to real migration `262_revoke_anon_table_grants`; its test now lives in `scripts/sql/local-full-schema/regression/`.

Draft 03 (Scanii counts for the database launch-readiness check) was promoted on 2026-10-06 (owner approved) to real migration `263_malware_provider_scanii_readiness`; its test now lives in `scripts/sql/local-full-schema/regression/`.

Draft 05 (hide `data_subject_requests.last_error` from clients) was promoted on 2026-10-06 (owner approved, after the front-end change was published) to real migration `264_hide_data_request_internal_errors`; its test now lives in `scripts/sql/local-full-schema/regression/`.

Draft 03 (QA-only clients pass `client_feature_access`) was promoted on 2026-10-07 (owner approved) to real migration `265_qa_clients_pass_feature_access`; its test now lives in `scripts/sql/local-full-schema/regression/`. Only drafts 01 and 02 remain.


The claim-skip draft (`03_claim_next_job_skips_guard_denied`) was promoted on 2026-10-08 (owner approved) to real migration `266_claim_next_job_skips_guard_denied`; its test now lives in `scripts/sql/local-full-schema/regression/`. Only drafts 01 and 02 remain.

The top-pages draft (`03_rollup_top_pages`) was promoted on 2026-10-09 (owner approved) to real migration `267_rollup_top_pages`; its test now lives in `scripts/sql/local-full-schema/regression/`. Only drafts 01 and 02 remain.
