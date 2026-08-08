import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sources = {
  analytics: read("supabase/migrations/131_privacy_safe_website_analytics_foundation.sql"),
  locations: read("supabase/migrations/132_enterprise_multi_location_business_foundation.sql"),
  growth: read("supabase/migrations/133_business_growth_operations_foundation.sql"),
  providers: read("supabase/migrations/134_provider_observability_and_recovery_foundation.sql"),
  governance: read("supabase/migrations/135_automation_governance_privacy_security.sql"),
  usage: read("supabase/migrations/136_usage_quotas_and_reporting_foundation.sql"),
  changes: read("supabase/migrations/137_autonomous_change_request_routing.sql"),
  leads: read("supabase/migrations/138_public_business_lead_intake_foundation.sql"),
  analyticsKeys: read("supabase/migrations/139_privacy_safe_analytics_ingest_keys.sql"),
  enterprise: read("supabase/migrations/140_privacy_requests_and_enterprise_identity_hooks.sql"),
  leadWorker: read("supabase/functions/ingest-business-lead/index.ts"),
  analyticsWorker: read("supabase/functions/ingest-business-analytics/index.ts"),
  changeWorker: read("supabase/functions/apply-business-change-request/index.ts"),
  locationWorker: read("supabase/functions/build-business-location-pages/index.ts"),
  notifications: read("supabase/functions/dispatch-notifications/index.ts"),
  template: read("templates/business-v1/index.html"),
  analyticsJs: read("templates/business-v1/analytics.js"),
  leadJs: read("templates/business-v1/lead-form.js"),
  headers: read("templates/business-v1/_headers"),
  a11y: read("templates/business-v1/a11y.css"),
  app: read("src/App.tsx"),
};

const checks = [
  ["Analytics has explicit consent mode", sources.analytics.includes("consent_mode") && sources.analytics.includes("consent_version")],
  ["Analytics raw events prohibit direct public insert", sources.analytics.includes("revoke all on table public.website_analytics_events")],
  ["Heatmap tracking is independently gated", sources.analytics.includes("mouse_tracking_enabled")],
  ["Analytics ingest requires project-specific public key", sources.analyticsKeys.includes("public_ingest_key") && sources.analyticsWorker.includes("public_ingest_key")],
  ["Analytics ingest enforces origin allowlist", sources.analyticsKeys.includes("allowed_origins") && sources.analyticsWorker.includes("Origin is not allowed")],
  ["Analytics ingest has bounded hourly limits", sources.analyticsKeys.includes("hourly_event_limit") && sources.analyticsWorker.includes("Analytics rate limit reached")],
  ["Analytics browser hook never captures input values", !sources.analyticsJs.includes("input.value") && !sources.analyticsJs.includes("keylog")],
  ["Analytics browser hook requires endpoint and ingest key", sources.analyticsJs.includes("config.ingestKey") && sources.analyticsJs.includes("enabled && endpoint && ingestKey")],
  ["Multi-location records are tenant scoped", sources.locations.includes("client_id uuid not null references public.clients")],
  ["Location pages are project + location scoped", sources.locations.includes("unique(project_id, location_id, page_slug)")],
  ["Location changes queue automatic SEO refresh", sources.locations.includes("website_location_seo_refresh")],
  ["Location worker writes only generated location pages", sources.locationWorker.includes("client_location_pages") && sources.locationWorker.includes("locations/")],
  ["Business lead records are tenant scoped", sources.growth.includes("business_leads") && sources.growth.includes("client_id uuid not null")],
  ["Public lead intake uses a non-authentication site key", sources.leads.includes("public_form_key")],
  ["Public lead intake has bounded abuse controls", sources.leads.includes("hourly_submission_limit") && sources.leadWorker.includes("rate limit")],
  ["Lead ingest does not store raw IP addresses", !sources.leadWorker.includes("remote_addr") && !sources.leadWorker.includes("x-forwarded-for")],
  ["Change requests carry risk classification", sources.growth.includes("risk_level") || sources.changes.includes("risk_level")],
  ["Low-risk changes route through automation instead of direct production", sources.changes.includes("apply_business_change_request") && sources.changeWorker.includes("build_plan")],
  ["Change worker never writes production main directly", !sources.changeWorker.includes("refs/heads/main") && !sources.changeWorker.includes("force: true")],
  ["Notification delivery supports retry state", sources.growth.includes("notification_deliveries") && sources.notifications.includes("max_attempts")],
  ["Missing notification provider blocks honestly", sources.notifications.includes("Notification provider adapter is not configured")],
  ["Provider registry supports health state", sources.providers.includes("provider_connections") && sources.providers.includes("provider_health")],
  ["Worker heartbeat observability exists", sources.providers.includes("automation_worker_heartbeats")],
  ["Disaster recovery restore-point records exist", sources.providers.includes("restore_points") || sources.providers.includes("recovery")],
  ["Automation governance has kill switches", sources.governance.includes("kill_switch") || sources.governance.includes("automation_enabled")],
  ["Automation rule versions are modeled", sources.governance.includes("automation_rule") && sources.governance.includes("version")],
  ["Trusted credentials store references, not raw biometrics", sources.governance.includes("credential") && !sources.governance.includes("raw_biometric")],
  ["Usage accounting is client scoped", sources.usage.includes("client_usage") || sources.usage.includes("usage_key")],
  ["Usage layer supports quota/limit state", sources.usage.includes("limit") && sources.usage.includes("usage")],
  ["Monthly reporting foundation exists", sources.usage.includes("report")],
  ["Privacy requests include export/delete style workflows", sources.enterprise.includes("data_export") || sources.enterprise.includes("deletion") || sources.enterprise.includes("privacy_request")],
  ["Enterprise identity has SSO hook", sources.enterprise.includes("saml") || sources.enterprise.includes("oidc")],
  ["Enterprise identity has SCIM hook", sources.enterprise.toLowerCase().includes("scim")],
  ["Generated site ships security headers", sources.headers.includes("Content-Security-Policy") && sources.headers.includes("Strict-Transport-Security")],
  ["Generated site has legal surfaces", sources.template.includes("/privacy.html") && sources.template.includes("/terms.html") && sources.template.includes("/accessibility.html")],
  ["Generated site has keyboard skip link", sources.template.includes("Skip to content")],
  ["Generated site honors reduced motion", sources.a11y.includes("prefers-reduced-motion")],
  ["Generated site lead form degrades when ingest is unavailable", sources.leadJs.includes("lead") && sources.leadJs.includes("endpoint")],
  ["Client Business routes exist", sources.app.includes("/client/business/leads") && sources.app.includes("/client/business/changes") && sources.app.includes("/client/business/locations")],
  ["Client privacy/security route exists", sources.app.includes("/client/security") || sources.app.includes("/client/security-privacy")],
  ["Owner operations routes exist", sources.app.includes("/owner/providers") && sources.app.includes("/owner/automation-health") && sources.app.includes("/owner/launch-readiness")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${label}`);
  }
}

console.log(`\n${passed}/${checks.length} mega autonomy checks passed.`);
if (passed !== checks.length) process.exit(1);
