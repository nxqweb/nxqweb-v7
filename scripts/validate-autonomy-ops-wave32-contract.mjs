import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/190_client_launch_journey_read_model.sql");
const summary = read("src/components/ClientJourneySummaryCard.tsx");
const topCards = read("src/components/ClientPortalTopCards.tsx");
const page = read("src/pages/ClientLaunchJourney.tsx");
const app = read("src/App.tsx");
const tutorial = read("src/components/ClientPortalTutorialOverlay.tsx");
const security = read("scripts/audit-frontend-security.mjs");

const checks = [
  ["Journey is a stable read-only security-definer model", migration.includes("returns jsonb\nlanguage plpgsql\nstable\nsecurity definer") && !/\b(?:insert|update|delete)\s+(?:into|public\.)/i.test(migration)],
  ["Journey derives the tenant from the authenticated identity", migration.includes("where auth_user_id = auth.uid()") && migration.includes("Client account not found")],
  ["Journey reads every launch-critical evidence source", ["client_intakes","owner_approval_requests","client_onboarding_state","website_automation_runs","project_deployment_configs","website_maintenance_plans","client_domains","client_file_security_scans"].every((name) => migration.includes(name))],
  ["Denial is terminal and exposes the established support route", migration.includes("if denied then") && migration.includes("Website setup was not approved") && migration.includes("websitedesignercontact@protonmail.com")],
  ["Progress cannot count denial as launch progress", migration.includes("case when denied then 0")],
  ["Billing freezes remain human-reviewed in client language", migration.includes("NXQ never freezes service without an owner decision")],
  ["Missing onboarding becomes a concrete client action", migration.includes("needs_information") && migration.includes("Finish requested information")],
  ["Domain action is derived from automation evidence", migration.includes("automation_state = 'action_required'") && migration.includes("Open domain instructions")],
  ["Live status requires recorded publication evidence", migration.includes("last_deployment_status = 'published'") && migration.includes("run_row.status = 'published'")],
  ["Ongoing care requires an active maintenance plan", migration.includes("care_ready := live_ready and maintenance_row.status = 'active'")],
  ["Client assets report security quarantine truth", migration.includes("quarantine_status = 'released'") && migration.includes("still in security review")],
  ["Checklist separates client-required, processing, complete and optional", ["action_required","processing","complete","optional"].every((status) => migration.includes(`'${status}'`))],
  ["Six launch milestones are returned", ["'setup'","'review'","'plan'","'build'","'launch'","'care'"].every((key) => migration.includes(key))],
  ["Function permission excludes anonymous callers", migration.includes("revoke all on function public.current_client_launch_journey() from public, anon") && migration.includes("grant execute on function public.current_client_launch_journey() to authenticated, service_role")],
  ["Portal summary uses the server journey model", topCards.includes('supabase.rpc("current_client_launch_journey")') && topCards.includes("ClientJourneySummaryCard")],
  ["Summary clearly separates client work from NXQ work", summary.includes("Your next step") && summary.includes("NXQ is handling this")],
  ["Full journey renders truthful milestones and requirements", page.includes("journey.milestones.map") && page.includes("journey.requirements.map") && page.includes("Progress changes only when the real workflow evidence changes")],
  ["Journey has a dedicated client route", app.includes('path === "/client/journey"') && app.includes("ClientLaunchJourneyPage")],
  ["Tutorial teaches the action-ownership model", tutorial.includes("separates the exact actions we need from you from work NXQ is already handling")],
  ["Existing frontend direct-mutation security gate remains active", security.includes("Frontend has no direct Supabase table mutations")],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-thirty-two checks passed.`);
if (passed !== checks.length) process.exit(1);
