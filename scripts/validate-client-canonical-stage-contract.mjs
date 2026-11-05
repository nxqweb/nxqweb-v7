import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const portal = read("src/pages/ClientPortal.tsx");
const topCards = read("src/components/ClientPortalTopCards.tsx");
const journeyPage = read("src/pages/ClientLaunchJourney.tsx");
const journeyMigration = read("supabase/migrations/218_canonical_journey_signed_setup_evidence.sql");
const app = read("src/App.tsx");

const failures = [];
function requireMatch(condition, message) {
  if (!condition) failures.push(message);
}

requireMatch(portal.includes('supabase.rpc("current_client_launch_journey")'), "ClientPortal must read the canonical launch journey RPC.");
requireMatch(portal.includes('const projectStage = journey?.stage_key || rawProjectStage;'), "ClientPortal stage must prefer journey.stage_key over raw project status.");
requireMatch(portal.includes('const projectStageLabel = journey?.stage_title || formatStatus(rawProjectStage);'), "ClientPortal header must prefer canonical journey.stage_title.");
requireMatch(portal.includes('data-canonical-journey-stage={projectStage}'), "ClientPortal tracker must declare its canonical journey stage source.");
requireMatch(!portal.includes('projectStage === "planning"'), "Legacy raw planning tracker check must not return.");
requireMatch(!portal.includes('projectStage === "building"'), "Legacy raw building tracker check must not return.");
requireMatch(!portal.includes('projectStage === "live"'), "Legacy raw live tracker check must not return.");
requireMatch(!portal.includes('<strong>{formatStatus(projectStage)}</strong>'), "Header must not render raw projectStage directly.");

requireMatch(topCards.includes('supabase.rpc("current_client_launch_journey")'), "Client journey summary card path must use the canonical journey RPC.");
requireMatch(journeyPage.includes('supabase.rpc("current_client_launch_journey")'), "Full journey page must use the canonical journey RPC.");
requireMatch(app.includes('<><ClientPortalTopCards /><ClientPortal /><ClientPortalTutorialOverlay /></>'), "Client portal route must keep the journey summary mounted with the portal.");

requireMatch(journeyMigration.includes("exists(select 1 from public.client_intakes"), "Canonical journey must retain legacy client_intakes compatibility.");
requireMatch(journeyMigration.includes("NXQ WEB WEBSITE SETUP REPORT"), "Canonical journey must recognize signed website setup reports.");
requireMatch(journeyMigration.includes("set search_path = public"), "Canonical journey SECURITY DEFINER function must pin search_path.");
requireMatch(journeyMigration.includes("revoke all on function public.current_client_launch_journey() from public, anon"), "Canonical journey RPC must remain unavailable to public/anon roles.");

if (failures.length) {
  console.error("Client canonical stage contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Client canonical stage contract passed: header, tracker, summary card, full journey, and signed setup evidence share one authoritative journey model.");
