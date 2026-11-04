# Table map: what the ~188 database tables are for

Written 2026-11-04. **How this was made:** a script read every `create table` in `supabase/migrations/` (253 files, through 286) and grouped the table names by prefix. Descriptions say what the NAME suggests; the migration that creates a table is the source of truth, so read it before relying on a table. **This lists the design, not live data.** Real rows (clients, messages, logs) live in the staging database and are only visible through the guarded workflows and their logs.

**Regenerate it** after new migrations are applied: list the `create table` names the same way (`grep -rhoiE "create table( if not exists)? +(public\.)?[a-z_0-9]+" supabase/migrations`), then re-group.

Where the things you asked about live: **account security** is `account_security_events` and `step_up_auth_requirements`; **activity logs** is `activity_logs`; **AI rules** is `ai_rules` (with `ai_worker_logs`, `automation_governance_rules` and `automation_kill_switches` next to it); the owner's AI chat is `owner_ai_messages`. All are in the groups below.

### Clients and signup (15)
The people and businesses that sign up, their intake answers, messages and onboarding state.

`client_domains`, `client_file_security_scans`, `client_files`, `client_infrastructure_placements`, `client_intakes`, `client_messages`, `client_notification_preferences`, `client_onboarding_state`, `client_plan_change_requests`, `client_site_photos`, `clients`, `owner_approval_requests`, `owner_users`, `packages`, `privacy_consents`

### Plans, tiers and products (18)
What is for sale, which features each plan includes, and the product families.

`client_location_addon_events`, `client_location_addons`, `client_location_pages`, `client_location_services`, `client_locations`, `nxq_feature_flags`, `nxq_product_family_blueprints`, `nxq_product_memberships`, `nxq_product_verification_requirements`, `nxq_products`, `nxq_scale_modes`, `nxq_tier_economic_policies`, `nxq_tier_entitlements`, `nxq_tier_resource_defaults`, `nxq_trusted_credentials`, `nxq_verification_claims`, `product_families`, `product_family_tiers`

### Billing and money (24)
Subscriptions, payment attempts and events from Stripe, invoice credits, referrals and founding grants.

`billing_notification_events`, `billing_payment_attempts`, `billing_provider_customer_links`, `billing_provider_events`, `billing_subscriptions`, `client_cost_profiles`, `client_monthly_usage_costs`, `client_usage_counters`, `nxq_economic_usage_reservations`, `nxq_founding_grant_applications`, `nxq_founding_grant_awards`, `nxq_growth_program_settings`, `nxq_invoice_credit_applications`, `nxq_netlify_budget_settings`, `nxq_netlify_build_reservations`, `nxq_platform_cost_reservations`, `nxq_platform_cost_settings`, `nxq_referral_attributions`, `nxq_referral_credit_ledger`, `nxq_referral_profiles`, `nxq_referral_risk_signals`, `nxq_usage_credit_ledger`, `nxq_usage_credit_purchases`, `payment_records`

### Websites, builds and hosting (14)
Projects, preview and production deployments, restore points, content revisions and change requests.

`automation_jobs`, `nxq_automation_jobs_v2`, `preview_deployment_requests`, `production_launch_requests`, `project_deployment_configs`, `project_deployments`, `project_restore_points`, `project_seo_artifacts`, `project_seo_refresh_runs`, `projects`, `website_automation_runs`, `website_automation_steps`, `website_change_requests`, `website_content_revisions`

### Website health, analytics and reports (17)
Uptime checks, security incidents, visitor analytics, monthly reports and SEO.

`business_seo_issues`, `client_improvement_recommendations`, `client_monthly_business_reports`, `nxq_behavior_events`, `nxq_observability_metrics`, `nxq_optimization_findings`, `website_analytics_daily_rollups`, `website_analytics_events`, `website_analytics_ingest_windows`, `website_analytics_profiles`, `website_health_checks`, `website_maintenance_alerts`, `website_maintenance_plans`, `website_maintenance_tasks`, `website_monthly_reports`, `website_security_incidents`, `website_security_profiles`

### Leads and the website assistant (9)
Contact forms, leads that come in, and the visitor Q&A assistant.

`business_lead_forms`, `business_lead_intake_attempts`, `client_assistant_entries`, `client_assistant_settings`, `client_assistant_unanswered`, `client_leads`, `client_review_settings`, `nxq_lead_intelligence`, `nxq_reputation_items`

### Online store (Commerce) (28)
Storefronts, products, carts, orders, inventory, shopper accounts and store requests.

`commerce_cart_items`, `commerce_carts`, `commerce_categories`, `commerce_customer_request_reference_files`, `commerce_customer_requests`, `commerce_customers`, `commerce_intakes`, `commerce_inventory_movements`, `commerce_member_only_products`, `commerce_member_tiers`, `commerce_members`, `commerce_notification_events`, `commerce_order_events`, `commerce_order_items`, `commerce_orders`, `commerce_product_attributes`, `commerce_product_media`, `commerce_product_variants`, `commerce_products`, `commerce_request_reference_upload_tickets`, `commerce_request_settings`, `commerce_shopper_profiles`, `commerce_storefront_build_jobs`, `commerce_storefront_provisioning`, `commerce_storefronts`, `commerce_usage_events`, `commerce_usage_limit_overrides`, `commerce_website_content`

### Booking (5)
Booking tables (request-only; Booking is not for sale yet).

`booking_appointment_requests`, `booking_availability_rules`, `booking_service_definitions`, `booking_staff_profiles`, `booking_workspaces`

### Security, audit and privacy (17)
Security events, activity logs, step-up login, data requests and retention rules.

`account_security_events`, `activity_logs`, `data_retention_policies`, `data_subject_requests`, `disaster_recovery_runs`, `enterprise_directory_users`, `enterprise_identity_connections`, `nxq_accounts`, `nxq_consent_records`, `nxq_enterprise_account_policies`, `nxq_enterprise_members`, `nxq_integration_connections`, `nxq_organization_memberships`, `nxq_organizations`, `nxq_storage_upload_tickets`, `organization_role_permissions`, `step_up_auth_requirements`

### AI, automation and the owner desk (13)
AI rules, worker logs, automation guards, kill switches and the owner AI messages.

`ai_desk_build_plans`, `ai_rules`, `ai_worker_logs`, `automation_audit_log`, `automation_escalations`, `automation_governance_rules`, `automation_kill_switches`, `automation_worker_heartbeats`, `client_automation_controls`, `nxq_change_impact_assessments`, `nxq_experiment_variants`, `nxq_experiments`, `owner_ai_messages`

### Providers, capacity and limits (10)
Outside-service connections, health, capacity windows and resource reservations.

`nxq_client_resource_policies`, `nxq_client_resource_reservations`, `nxq_client_value_snapshots`, `nxq_ingress_capacity_windows`, `nxq_metered_job_policies`, `nxq_provider_adapter_registry`, `nxq_provider_capacity_windows`, `nxq_provider_connections`, `nxq_provider_health_events`, `nxq_provider_pools`

### Sales outreach (10)
Prospects, outreach drafts, replies, suppressions and delivery jobs.

`nxq_sales_contact_permissions`, `nxq_sales_delivery_jobs`, `nxq_sales_outreach_drafts`, `nxq_sales_outreach_events`, `nxq_sales_outreach_settings`, `nxq_sales_prospects`, `nxq_sales_reply_events`, `nxq_sales_source_runs`, `nxq_sales_suppressions`, `nxq_sales_website_audits`

### Notifications (3)
What gets sent to clients and owners.

`notification_deliveries`, `notification_digest_batches`, `nxq_platform_events`

### QA and launch readiness (5)
Test fixtures, QA runs and the launch checks.

`launch_readiness_checks`, `nxq_qa_fixture_registry`, `product_family_qa_runs`, `qa_lifecycle_runs`, `staging_readiness_evidence_runs`


## Drafts not applied yet (not in the 188)
`nxq_waitlist_signups` (pre-launch waitlist) and `nxq_addon_pack_catalog`, `client_addon_packs`, `client_addon_pack_events` (add-on packs) exist only as drafts in `docs/drafts/migrations/` (03 and 04). Nothing is applied to staging or production.
