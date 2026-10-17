# Data API grant audit — public tables (Supabase 2026-10-30 change)

Branch `safe/checkpoint-autonomy-wave35-sales`. Source-level audit only: it
parses `supabase/migrations/*.sql` in order and scans `src/` and
`supabase/functions/`. **It is not proof of live database state.** No staging
connection, migration apply, deploy, or billing change was made. Re-run with
`node scripts/audit-data-api-grants.mjs --report` (or `--markdown` / `--json`).

## Model

Supabase is changing so that **new** public tables no longer get automatic Data
API grants. A fresh project or `db reset` built from these migrations therefore
only has the grants the migrations state explicitly. Existing live tables keep
whatever grants they already have, so a gap here may be invisible on staging
today. Whether any live table actually lacks a grant is **unverified**.

- `service_role`: migration 195 grants all tables and sets default privileges
  for the migration role. Tables created after 195 depend on that default
  (role-specific; not provable locally) unless they grant explicitly.
- RPCs: 315 of 338 parsed functions are `SECURITY DEFINER` (run as owner, no
  caller table grants needed). 0 of the 23 invoker functions are executable by
  `anon`/`authenticated` or called from the frontend.
- Edge Functions: every table access found uses the service-role client; the
  user-scoped clients only call `auth.getUser()` or definer RPCs (plus the
  evidence-suite test sessions).

## Status after migration 255 (staged locally, NOT applied anywhere)

Migration `255_explicit_data_api_grants_for_owner_reads.sql` (approved by the
user) adds `grant select` to `authenticated` on `automation_jobs` and
`automation_escalations`, and explicit `service_role` grants on the two
`nxq_netlify_*` tables. With it, the validator reports 0 proven gaps. It was
exercised only against a disposable local Postgres (exact grants produced,
idempotent on re-run). **Update: 255 was applied to `nxqweb-staging` in run #223 and the
resulting privileges were read back from the live database in run #224
(`authenticated: SELECT` on both owner tables; `service_role` full on both
`nxq_netlify_*` tables). That is metadata evidence, not an owner-page load.** The findings below describe the tree *before* 255.

## Result summary (178 tables after migrations 001–254)

- RLS enabled: 178/178.
- **Proven source-level gaps (2):** `automation_jobs`
  (`OwnerAutomationHealth.tsx`, select) and `automation_escalations`
  (`OwnerExceptionCenter.tsx`, select; added by commit `1ba8d1e` in this
  session). Both have owner-only RLS policies but no explicit grant to
  `authenticated`; today they work only through platform default grants.
- **Latent (7), no frontend/Edge-user use found:** `automation_audit_log`,
  `billing_notification_events`, `billing_payment_attempts`,
  `billing_subscriptions`, `client_automation_controls`,
  `client_onboarding_state`, `payment_records` — owner/client policies exist but
  no grant; access is via definer RPCs or service role. Not a functional gap.
- **Deliberately revoked, vestigial policy (9):** explicit `revoke` from
  authenticated, service-role only by design.
- **Over-grant, RLS-contained (7):** `anon` holds table grants from temporary
  migration 003 on `activity_logs`, `client_intakes`, `client_messages`,
  `clients`, `owner_ai_messages`, `owner_approval_requests`, `projects` with no
  anon policy, so RLS denies all rows. Defense depends on RLS alone.
- **service_role via default privileges only (2):**
  `nxq_netlify_budget_settings`, `nxq_netlify_build_reservations`.

## Migrations 248–254 recheck

Only 251 creates tables. `client_location_addons` and
`client_location_addon_events`: RLS enabled, `revoke all` from
public/anon/authenticated, `grant select` to authenticated, explicit
`service_role` grants (addons: select/insert/update/delete; events:
select/insert), owner + own-client select policies. Adequate and minimal for
a fresh project. The frontend does not read them directly (access is through
definer RPCs). 248, 249, 250, 252, 253, 254 create no tables; 253 only replaces
the `notification_deliveries` policy (that table has an explicit
`select` to authenticated from migration 133).

## Table-by-table checklist

Privilege columns are the explicit grants left after every grant/revoke in
migration order. `Flags` of `ok` means no finding.

| Table | Mig | RLS | anon | authenticated | service_role | Frontend (ops) | Edge fns | Flags |
|---|---|---|---|---|---|---|---|---|
| account_security_events | 135 | yes | - | select | all | select | 1 fn | ok |
| activity_logs | 001 | yes | insert,select | select | all | - | - | ANON_GRANT_WITHOUT_ANON_POLICY |
| ai_rules | 001 | yes | select | select | all | - | - | ok |
| ai_worker_logs | 001 | yes | - | insert,select | all | - | - | ok |
| automation_audit_log | 097 | yes | - | - | all | - | 4 fn | LATENT_POLICY_WITHOUT_GRANT |
| automation_escalations | 097 | yes | - | select | all | select | 1 fn | ok |
| automation_governance_rules | 135 | yes | - | - | all | - | - | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| automation_jobs | 097 | yes | - | select | all | select | 2 fn | ok |
| automation_kill_switches | 135 | yes | - | - | all | - | - | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| automation_worker_heartbeats | 134 | yes | - | select | all | select | - | ok |
| billing_notification_events | 100 | yes | - | - | all | - | - | LATENT_POLICY_WITHOUT_GRANT |
| billing_payment_attempts | 100 | yes | - | - | all | - | - | LATENT_POLICY_WITHOUT_GRANT |
| billing_provider_customer_links | 176 | yes | - | - | all | - | 2 fn | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| billing_provider_events | 171 | yes | - | - | all | - | 2 fn | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| billing_subscriptions | 100 | yes | - | - | all | - | - | LATENT_POLICY_WITHOUT_GRANT |
| booking_appointment_requests | 188 | yes | - | select | all | - | - | ok |
| booking_availability_rules | 188 | yes | - | select | all | - | - | ok |
| booking_service_definitions | 188 | yes | - | select | all | - | - | ok |
| booking_staff_profiles | 188 | yes | - | select | all | - | - | ok |
| booking_workspaces | 188 | yes | - | select | all | - | - | ok |
| business_lead_forms | 138 | yes | - | select | all | - | 2 fn | ok |
| business_lead_intake_attempts | 138 | yes | - | - | all | - | 1 fn | ok |
| business_seo_issues | 147 | yes | - | select | all | select | - | ok |
| client_automation_controls | 097 | yes | - | - | all | - | - | LATENT_POLICY_WITHOUT_GRANT |
| client_cost_profiles | 038 | yes | - | delete,insert,select,update | all | - | - | ok |
| client_domains | 001 | yes | - | select | all | - | 1 fn | ok |
| client_file_security_scans | 144 | yes | - | select | all | select | 4 fn | ok |
| client_files | 001 | yes | - | select | all | select | 6 fn | ok |
| client_improvement_recommendations | 136 | yes | - | select | all | select | - | ok |
| client_infrastructure_placements | 202 | yes | - | - | all | - | - | ok |
| client_intakes | 001 | yes | insert,select,update | insert,select,update | all | - | 1 fn | ANON_GRANT_WITHOUT_ANON_POLICY |
| client_leads | 133 | yes | - | select | all | - | - | ok |
| client_location_addon_events | 251 | yes | - | select | all | - | - | ok |
| client_location_addons | 251 | yes | - | select | all | - | - | ok |
| client_location_pages | 132 | yes | - | select | all | - | 1 fn | ok |
| client_location_services | 132 | yes | - | select | all | - | 1 fn | ok |
| client_locations | 132 | yes | - | select | all | - | 3 fn | ok |
| client_messages | 001 | yes | insert,select | insert,select | all | - | - | ANON_GRANT_WITHOUT_ANON_POLICY |
| client_monthly_business_reports | 136 | yes | - | select | all | select | - | ok |
| client_monthly_usage_costs | 038 | yes | - | delete,insert,select,update | all | - | - | ok |
| client_notification_preferences | 154 | yes | - | insert,select,update | all | select | - | ok |
| client_onboarding_state | 099 | yes | - | - | all | - | 1 fn | LATENT_POLICY_WITHOUT_GRANT |
| client_plan_change_requests | 028 | yes | - | delete,insert,select,update | all | select | - | ok |
| client_usage_counters | 136 | yes | - | select | all | - | - | ok |
| clients | 001 | yes | select | select | all | select | 14 fn | ANON_GRANT_WITHOUT_ANON_POLICY |
| commerce_cart_items | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_carts | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_categories | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_customer_request_reference_files | 240 | yes | - | select | all | - | 2 fn | ok |
| commerce_customer_requests | 060 | yes | - | insert,select,update | all | - | 2 fn | ok |
| commerce_customers | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_intakes | 037 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_inventory_movements | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_notification_events | 093 | yes | - | select | all | - | - | ok |
| commerce_order_events | 053 | yes | - | select | all | - | - | ok |
| commerce_order_items | 036 | yes | - | select | all | - | - | ok |
| commerce_orders | 036 | yes | - | select | all | - | - | ok |
| commerce_product_attributes | 039 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_product_media | 044 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_product_variants | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_products | 036 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_request_reference_upload_tickets | 240 | yes | - | - | all | - | 1 fn | ok |
| commerce_request_settings | 060 | yes | - | insert,select,update | all | - | - | ok |
| commerce_storefront_build_jobs | 050 | yes | - | - | all | - | - | ok |
| commerce_storefront_provisioning | 109 | yes | - | - | all | - | 1 fn | ok |
| commerce_storefronts | 036 | yes | - | delete,insert,select,update | all | - | 1 fn | ok |
| commerce_usage_events | 051 | yes | - | select | all | - | - | ok |
| commerce_usage_limit_overrides | 051 | yes | - | delete,insert,select,update | all | - | - | ok |
| commerce_website_content | 108 | yes | - | - | all | - | - | ok |
| data_retention_policies | 135 | yes | - | - | all | - | - | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| data_subject_requests | 140 | yes | - | insert,select | all | select | 1 fn | ok |
| disaster_recovery_runs | 134 | yes | - | select | all | - | 1 fn | ok |
| enterprise_directory_users | 140 | yes | - | select | all | - | - | ok |
| enterprise_identity_connections | 140 | yes | - | select | all | - | - | ok |
| launch_readiness_checks | 134 | yes | - | select | all | select | 1 fn | ok |
| notification_deliveries | 133 | yes | - | select | all | select | 2 fn | ok |
| notification_digest_batches | 154 | yes | - | select | all | - | - | ok |
| nxq_accounts | 125 | yes | - | select | all | - | 1 fn | ok |
| nxq_automation_jobs_v2 | 243 | yes | - | select | all | - | - | ok |
| nxq_behavior_events | 243 | yes | - | - | all | - | - | ok |
| nxq_change_impact_assessments | 244 | yes | - | select | all | - | - | ok |
| nxq_client_resource_policies | 229 | yes | - | select | all | - | - | ok |
| nxq_client_resource_reservations | 229 | yes | - | select | all | - | - | ok |
| nxq_client_value_snapshots | 244 | yes | - | select | all | - | - | ok |
| nxq_consent_records | 243 | yes | - | - | all | - | - | ok |
| nxq_economic_usage_reservations | 243 | yes | - | select | all | - | - | ok |
| nxq_enterprise_account_policies | 243 | yes | - | select | all | - | - | ok |
| nxq_enterprise_members | 244 | yes | - | select | all | - | - | ok |
| nxq_experiment_variants | 243 | yes | - | select | all | - | - | ok |
| nxq_experiments | 243 | yes | - | select | all | - | - | ok |
| nxq_feature_flags | 243 | yes | - | select | all | - | - | ok |
| nxq_founding_grant_applications | 229 | yes | - | select | all | - | - | ok |
| nxq_founding_grant_awards | 229 | yes | - | select | all | - | - | ok |
| nxq_growth_program_settings | 229 | yes | - | select | all | - | - | ok |
| nxq_ingress_capacity_windows | 204 | yes | - | - | all | - | - | ok |
| nxq_integration_connections | 244 | yes | - | select | all | - | - | ok |
| nxq_invoice_credit_applications | 229 | yes | - | select | all | - | - | ok |
| nxq_lead_intelligence | 244 | yes | - | select | all | - | - | ok |
| nxq_metered_job_policies | 246 | yes | - | - | all | - | - | ok |
| nxq_netlify_budget_settings | 234 | yes | - | - | all | - | - | ok |
| nxq_netlify_build_reservations | 234 | yes | - | - | all | - | - | ok |
| nxq_observability_metrics | 244 | yes | - | select | all | - | - | ok |
| nxq_optimization_findings | 243 | yes | - | select | all | - | - | ok |
| nxq_organization_memberships | 125 | yes | - | select | all | - | - | ok |
| nxq_organizations | 125 | yes | - | select | all | - | - | ok |
| nxq_platform_cost_reservations | 246 | yes | - | - | all | - | - | ok |
| nxq_platform_cost_settings | 246 | yes | - | - | all | - | - | ok |
| nxq_platform_events | 243 | yes | - | select | all | - | - | ok |
| nxq_product_family_blueprints | 188 | yes | - | - | all | - | - | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| nxq_product_memberships | 125 | yes | - | select | all | - | 1 fn | ok |
| nxq_product_verification_requirements | 125 | yes | - | select | all | - | - | ok |
| nxq_products | 125 | yes | - | select | all | - | - | ok |
| nxq_provider_adapter_registry | 243 | yes | - | select | all | - | - | ok |
| nxq_provider_capacity_windows | 202 | yes | - | - | all | - | - | ok |
| nxq_provider_connections | 134 | yes | - | select | all | select | 6 fn | ok |
| nxq_provider_health_events | 134 | yes | - | - | all | - | 1 fn | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| nxq_provider_pools | 202 | yes | - | - | all | - | - | ok |
| nxq_qa_fixture_registry | 244 | yes | - | select | all | - | - | ok |
| nxq_referral_attributions | 229 | yes | - | select | all | - | - | ok |
| nxq_referral_credit_ledger | 229 | yes | - | select | all | - | - | ok |
| nxq_referral_profiles | 229 | yes | - | select | all | - | - | ok |
| nxq_referral_risk_signals | 229 | yes | - | - | all | - | - | ok |
| nxq_reputation_items | 244 | yes | - | select | all | - | - | ok |
| nxq_sales_contact_permissions | 192 | yes | - | select | all | - | - | ok |
| nxq_sales_delivery_jobs | 230 | yes | - | select | all | - | - | ok |
| nxq_sales_outreach_drafts | 192 | yes | - | select | all | - | - | ok |
| nxq_sales_outreach_events | 192 | yes | - | select | all | - | - | ok |
| nxq_sales_outreach_settings | 192 | yes | - | select | all | - | - | ok |
| nxq_sales_prospects | 192 | yes | - | select | all | - | 2 fn | ok |
| nxq_sales_reply_events | 230 | yes | - | select | all | - | - | ok |
| nxq_sales_source_runs | 230 | yes | - | select | all | - | 1 fn | ok |
| nxq_sales_suppressions | 230 | yes | - | select | all | - | - | ok |
| nxq_sales_website_audits | 230 | yes | - | select | all | - | 1 fn | ok |
| nxq_scale_modes | 202 | yes | - | - | all | - | - | ok |
| nxq_storage_upload_tickets | 246 | yes | - | - | all | - | - | ok |
| nxq_tier_economic_policies | 243 | yes | - | select | all | - | - | ok |
| nxq_tier_entitlements | 130 | yes | - | select | all | - | - | ok |
| nxq_tier_resource_defaults | 229 | yes | - | - | all | - | - | ok |
| nxq_trusted_credentials | 135 | yes | - | select | all | select | - | ok |
| nxq_usage_credit_ledger | 243 | yes | - | select | all | - | - | ok |
| nxq_usage_credit_purchases | 243 | yes | - | select | all | - | - | ok |
| nxq_verification_claims | 125 | yes | - | select | all | - | - | ok |
| organization_role_permissions | 140 | yes | - | select | all | - | - | ok |
| owner_ai_messages | 001 | yes | insert,select | insert,select | all | - | - | ANON_GRANT_WITHOUT_ANON_POLICY |
| owner_approval_requests | 001 | yes | select | select | all | - | 9 fn | ANON_GRANT_WITHOUT_ANON_POLICY |
| owner_users | 001 | yes | - | select | all | select | 22 fn | ok |
| packages | 001 | yes | select | select | all | - | - | ok |
| payment_records | 010 | yes | - | - | all | - | - | LATENT_POLICY_WITHOUT_GRANT |
| preview_deployment_requests | 020 | yes | - | select | all | select | 8 fn | ok |
| privacy_consents | 135 | yes | - | insert,select | all | select | 1 fn | ok |
| product_families | 026 | yes | select | select | all | select | 4 fn | ok |
| product_family_qa_runs | 188 | yes | - | - | all | - | - | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| product_family_tiers | 026 | yes | select | select | all | select | 1 fn | ok |
| production_launch_requests | 024 | yes | - | select | all | select | 6 fn | ok |
| project_deployment_configs | 018 | yes | - | select | all | select | 19 fn | ok |
| project_deployments | 018 | yes | - | select | all | select | 9 fn | ok |
| project_restore_points | 134 | yes | - | select | all | - | - | ok |
| project_seo_artifacts | 147 | yes | - | select | all | select | 1 fn | ok |
| project_seo_refresh_runs | 160 | yes | - | select | all | select | 1 fn | ok |
| projects | 001 | yes | insert,select,update | insert,select,update | all | select | 7 fn | ANON_GRANT_WITHOUT_ANON_POLICY |
| qa_lifecycle_runs | 141 | yes | - | select | all | select | - | ok |
| staging_readiness_evidence_runs | 228 | yes | - | - | all | - | - | ok |
| step_up_auth_requirements | 135 | yes | - | - | all | - | - | DELIBERATELY_REVOKED_VESTIGIAL_POLICY |
| website_analytics_daily_rollups | 131 | yes | - | select | all | select | - | ok |
| website_analytics_events | 131 | yes | - | - | all | - | 1 fn | ok |
| website_analytics_ingest_windows | 139 | yes | - | - | all | - | - | ok |
| website_analytics_profiles | 131 | yes | - | select | all | select | 2 fn | ok |
| website_automation_runs | 101 | yes | - | delete,insert,select,update | all | - | 4 fn | ok |
| website_automation_steps | 101 | yes | - | delete,insert,select,update | all | - | 2 fn | ok |
| website_change_requests | 133 | yes | - | insert,select,update | all | select | 2 fn | ok |
| website_content_revisions | 133 | yes | - | select | all | - | - | ok |
| website_health_checks | 025 | yes | - | delete,insert,select,update | all | - | - | ok |
| website_maintenance_alerts | 126 | yes | - | select | all | - | - | ok |
| website_maintenance_plans | 102 | yes | - | select | all | - | 2 fn | ok |
| website_maintenance_tasks | 102 | yes | - | select | all | - | 1 fn | ok |
| website_monthly_reports | 102 | yes | - | delete,insert,select,update | all | - | 1 fn | ok |
| website_security_incidents | 025 | yes | - | delete,insert,select,update | all | - | - | ok |
| website_security_profiles | 025 | yes | - | delete,insert,select,update | all | - | - | ok |
