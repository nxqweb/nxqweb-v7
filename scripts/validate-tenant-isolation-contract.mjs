import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const identity = read("supabase/migrations/125_nxq_universal_identity_foundation.sql");
const analytics = read("supabase/migrations/131_privacy_safe_website_analytics_foundation.sql");
const locations = read("supabase/migrations/132_enterprise_multi_location_business_foundation.sql");
const growth = read("supabase/migrations/133_business_growth_operations_foundation.sql");
const privacy = read("supabase/migrations/140_privacy_requests_and_enterprise_identity_hooks.sql");

const checks = [
  ["NXQ account table has RLS", identity.includes("alter table public.nxq_accounts enable row level security")],
  ["NXQ account users can read only their own account", identity.includes("auth_user_id = auth.uid()")],
  ["Verification claims are RLS protected", identity.includes("alter table public.nxq_verification_claims enable row level security")],
  ["Verification claims do not grant client mutation", !identity.includes("grant insert on public.nxq_verification_claims to authenticated") && !identity.includes("grant update on public.nxq_verification_claims to authenticated")],
  ["Analytics event table has RLS", analytics.includes("alter table public.website_analytics_events enable row level security")],
  ["Raw analytics events are not granted to authenticated clients", analytics.includes("revoke all on table public.website_analytics_events from public, anon, authenticated")],
  ["Analytics rollups are scoped to current client", analytics.includes("client_view_own_website_analytics_rollups") && analytics.includes("c.auth_user_id = auth.uid()")],
  ["Locations table has RLS", locations.includes("alter table public.client_locations enable row level security")],
  ["Location services table has RLS", locations.includes("alter table public.client_location_services enable row level security")],
  ["Location pages table has RLS", locations.includes("alter table public.client_location_pages enable row level security")],
  ["Clients can manage only their own locations", locations.includes("client_manage_own_locations") && locations.includes("c.id = client_locations.client_id") && locations.includes("c.auth_user_id = auth.uid()")],
  ["Clients can manage only their own location services", locations.includes("client_manage_own_location_services") && locations.includes("c.id = client_location_services.client_id")],
  ["Clients can only view their own generated location pages", locations.includes("client_view_own_location_pages") && locations.includes("c.id = client_location_pages.client_id")],
  ["Leads table has RLS", growth.includes("alter table public.client_leads enable row level security")],
  ["Lead reads are tenant scoped", growth.includes("client_read_own_leads") && growth.includes("c.id = client_id and c.auth_user_id = auth.uid()")],
  ["Lead updates are tenant scoped", growth.includes("client_manage_own_leads") && growth.includes("with check")],
  ["Change requests table has RLS", growth.includes("alter table public.website_change_requests enable row level security")],
  ["Change request insertion validates client + project ownership", growth.includes("client_insert_own_change_requests") && growth.includes("p.id = project_id and p.client_id = client_id")],
  ["Content revision reads are tenant scoped", growth.includes("client_read_own_content_revisions") && growth.includes("c.id = client_id and c.auth_user_id = auth.uid()")],
  ["Notification reads are tenant scoped", growth.includes("client_read_own_notifications") && growth.includes("client_id is not null")],
  ["Public/anon roles have no direct lead table access", growth.includes("revoke all on table public.client_leads from public, anon")],
  ["Public/anon roles have no direct change request access", growth.includes("revoke all on table public.website_change_requests from public, anon")],
  ["Data subject requests have RLS", privacy.includes("alter table public.data_subject_requests enable row level security")],
  ["Data requests require current NXQ account or owned client", privacy.includes("account_manage_own_data_requests") && privacy.includes("current_nxq_account_id()")],
  ["Enterprise identity connections are organization scoped", privacy.includes("org_members_view_identity_connections") && privacy.includes("m.organization_id=enterprise_identity_connections.organization_id")],
  ["Enterprise directory reads are organization scoped", privacy.includes("org_members_view_directory") && privacy.includes("m.organization_id=enterprise_directory_users.organization_id")],
  ["Organization role permissions are organization scoped", privacy.includes("org_members_view_role_permissions") && privacy.includes("m.organization_id=organization_role_permissions.organization_id")],
  ["Enterprise secrets are not stored in connection rows", privacy.includes("required_secret_names") && privacy.includes("Provider secrets remain in protected secret stores")],
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

console.log(`\n${passed}/${checks.length} tenant isolation checks passed.`);
if (passed !== checks.length) process.exit(1);
