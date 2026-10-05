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

Note: the pgcrypto search_path repair was promoted from a draft to real migration 257 on 2026-10-05
(approved by the owner; not yet applied to staging). Its regression test lives in
`scripts/sql/local-full-schema/regression/`. Draft numbering for the rest is assigned on approval (258+).
