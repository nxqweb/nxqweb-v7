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
| `03_journey_nxqx_wording.sql` | Client journey text says NXQX instead of NXQ, and the denied-client support link points at NXQweb@protonmail.com (the old address was lost); logic unchanged | owner request 2026-10-15 |
| `02_owner_client_directory_v2.sql` | Owner client directory v2 with `client_code` and `nxq_id`, searchable (additive) | `docs/CLIENT_ID_AND_NXQ_ACCOUNT_PLAN.md` |
| `06_booking_requests.sql` | Booking v1, request-only: public page columns on the 188 tables, owner functions (services, hours, requests) and the two public functions (page + submit request) with bot trap, rate caps, opening-hours checks; no confirmation, payment or reminder; 188 guards untouched; only runs for accounts in good standing; public form has spam brakes (not full protection, see its header); also a service-role-only `purge_old_booking_requests` (90-day retention, 30-day floor, NOT scheduled) | `docs/NEXT_PRODUCT_PLANS.md` plan 2; UI wiring steps in `docs/drafts/ui/README.md` |
| `04_store_order_number_prefix.sql` | Customer-facing order numbers use the store's own prefix (initials of the store name, or an `order_prefix` setting) instead of `NXQ-`; changes only the Stripe-ready checkout wrapper from migration 227, the order primitive is untouched, existing orders keep their numbers | owner request 2026-10-15 |
| `08_membership_tracking.sql` | Membership v1 (track only): per-store tiers (max 10), members (max 2000, one row per email), a members-only product flag, owner functions, and `get_my_membership_status` for a signed-in shopper. Deny-by-default tables, no card data. The members-only flag is a RECORD ONLY: hiding/refusing those products needs changes to the public store and order-creation functions (104/107/115/227) and is a separate owner decision | owner answers 2026-10-17 (members = client's customers, client bills outside, perk = members-only products) |

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

The shopper-accounts draft (`04_shopper_accounts`) was promoted on 2026-10-15 (owner approved in chat) to real migration `268_shopper_accounts`; its test now lives in `scripts/sql/local-full-schema/regression/`. Only the journey-wording draft (03) remains here.

The store-profile draft (`05_store_profile`) was promoted on 2026-10-16 (owner approved in chat) to real migration `269_store_profile`; its test now lives in `scripts/sql/local-full-schema/regression/`. NOT yet applied to staging (apply needs the owner's separate explicit approval and the guarded workflow).

The order-by-email draft (`05_store_order_by_email`) was promoted on 2026-10-16 (owner approved in chat) to real migration `270_store_order_by_email`; its test now lives in `scripts/sql/local-full-schema/regression/`. NOT applied to staging. Only the journey-wording draft (03) and drafts 01 and 02 remain here.

The menu-mode draft (`06_store_menu_mode`) was promoted on 2026-10-16 (owner said "promote 06" in chat) to real migration `271_store_menu_mode`; its test now lives in `scripts/sql/local-full-schema/regression/` and the 270 test was updated for the new unknown-mode wording. NOT applied to staging. Only drafts 01, 02 and 03 (journey wording) remain here.

The referral-invoice-credit draft (`07_referral_invoice_credit`) was promoted on 2026-10-17 (owner said "promote 07 and wire it") to real migration `272_referral_invoice_credit`; its test now lives in `scripts/sql/local-full-schema/regression/`. NOT applied to staging. Only drafts 01, 02 and 03 (journey wording) remain here.

The reviews draft (`05_reviews_collector`) was promoted on 2026-10-17 (owner said "promote reviews" in chat) to real migration `273_reviews_collector`; its test now lives in `scripts/sql/local-full-schema/regression/`. NOT yet applied to staging. Its page is wired at `/client/reviews` (portal link "Get reviews"). NOTE: `supabase db push` applies ALL pending migrations in order, so applying 273 also applies 272 (referral credit, dormant by design). Only draft 06 (Booking) remains here besides 01-04.


The two security drafts from the 2026-10-17 scan (`09_fix_duplicate_variant_oversell`, `10_revoke_client_direct_table_writes`) were promoted on 2026-10-18 (owner chose "A") to real migrations `274_fix_duplicate_variant_oversell` and `275_revoke_client_direct_table_writes`; their tests now live in `scripts/sql/local-full-schema/regression/`. NOT yet applied to staging; they go with 272 + 273 on deploy day.

Draft 10 (website photos at setup) was promoted on 2026-10-18 (owner said "lets do all of that") to real migration `276_site_photos`; its test lives in `scripts/sql/local-full-schema/regression/`. NOT applied yet: see `docs/PHOTO_BACKEND_RUNBOOK.md`.

Draft 09 (AI Desk build plans) was promoted on 2026-10-18 (owner chose "A") to real migration `277_ai_desk_build_plans`; its test lives in `scripts/sql/local-full-schema/regression/`. NOT applied yet: see `docs/AI_DESK_KIT.md` and `docs/OCT22_DEPLOY_DAY_CHECKLIST.md`.
