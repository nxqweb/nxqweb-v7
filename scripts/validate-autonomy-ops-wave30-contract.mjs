import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const migration = read("supabase/migrations/188_guarded_product_family_blueprints_and_booking_scaffold.sql");
const ownerUi = read("src/pages/OwnerProductFamilies.tsx");
const blueprintText = read("templates/booking-v1/blueprint.json");
const blueprint = JSON.parse(blueprintText);
const ci = read(".github/workflows/ci-mega-extended.yml");
const pkg = read("package.json");

const familySlugs = [
  "business",
  "booking",
  "commerce",
  "menu",
  "property",
  "multi-location",
  "membership",
  "enterprise-systems",
];

const checks = [
  ["Family blueprints and external QA evidence have distinct governed tables", migration.includes("create table if not exists public.nxq_product_family_blueprints") && migration.includes("create table if not exists public.product_family_qa_runs")],
  ["All eight product families have distinct safe branch prefixes", familySlugs.every((slug) => migration.includes(`'safe/family/${slug}'`))],
  ["Blueprint seeds never enable launch", migration.includes("definition.template_key,definition.worker_key,10,false") && !migration.includes("required_clean_runs,launch_enabled\n  )\nvalues")],
  ["Launch requires launch-ready status plus distinct template and worker", migration.includes("new.lifecycle_status<>'launch_ready'") && migration.includes("btrim(new.template_key)") && migration.includes("btrim(new.worker_key)")],
  ["Launch requires ten disposable external passes and every required scenario", migration.includes("run.disposable and run.external_evidence") && migration.includes("verified_runs<new.required_clean_runs") && migration.includes("jsonb_array_elements_text(new.required_qa_scenarios)") && migration.includes("missing_scenarios>0")],
  ["Catalog beta or availability is blocked without family launch authority", migration.includes("guard_product_family_public_release") && migration.includes("new.public_status in ('available','beta')") && migration.includes("blueprint.launch_enabled")],
  ["Local simulations cannot masquerade as external evidence", migration.includes("external_evidence boolean not null default false") && migration.includes("local simulations never set external_evidence true")],
  ["Booking workspace enforces the project/client relationship at the database layer", migration.includes("projects_id_client_unique") && migration.includes("foreign key(project_id,client_id) references public.projects(id,client_id)")],
  ["Booking has five separate tenant-scoped entities", ["booking_workspaces","booking_service_definitions","booking_staff_profiles","booking_availability_rules","booking_appointment_requests"].every((table) => migration.includes(`public.${table}`))],
  ["Booking child records carry composite workspace client and project keys", migration.includes("unique(id,workspace_id,client_id,project_id)") && migration.includes("foreign key(service_definition_id,workspace_id,client_id,project_id)") && migration.includes("foreign key(staff_profile_id,workspace_id,client_id,project_id)")],
  ["Booking has RLS and no anonymous or authenticated mutation grant", migration.includes("alter table public.booking_appointment_requests enable row level security") && migration.includes("from public,anon,authenticated") && migration.includes("grant select on public.booking_workspaces") && !migration.includes("grant insert on public.booking_appointment_requests to authenticated")],
  ["Appointment intake is request-only and tenant-idempotent", migration.includes("confirmation_mode text not null default 'request_only'") && migration.includes("status text not null default 'requested'") && migration.includes("unique(workspace_id,idempotency_key)")],
  ["Booking validates IANA zones and blocks unverified confirmed states", migration.includes("select 1 from pg_timezone_names") && migration.includes("guard_booking_appointment_request") && migration.includes("Confirmed Booking state requires a launched workspace and protected provider evidence")],
  ["Booking workspace launch is chained to the family launch gate", migration.includes("guard_booking_workspace_launch") && migration.includes("family.slug='booking' and blueprint.launch_enabled")],
  ["Booking tiers are useful design contracts but remain planned", migration.includes("Booking tier definitions are distinct design contracts and remain planned") && migration.includes("'confirmation_mode','request_only'") && migration.includes("'launch_enabled',false") && migration.includes("public_status='planned'")],
  ["Booking explicitly refuses Business worker reuse", migration.includes('"reuse_business_worker":false') && blueprint.invariants.includes("Business and Commerce workers are never reused")],
  ["Booking blueprint is valid, launch-locked, and excludes unsafe unfinished work", blueprint.family === "booking" && blueprint.lifecycle_status === "schema_design" && blueprint.public_launch_enabled === false && blueprint.non_goals.includes("Calendar provider credentials in the browser") && blueprint.release_gates.required_disposable_external_runs === 10],
  ["Owner UI loads the protected family status RPC", ownerUi.includes('supabase.rpc("owner_product_family_foundation_status")') && ownerUi.includes("Live family readiness")],
  ["Owner UI shows all eight families, evidence, next gates, and launch locks", familySlugs.every((slug) => ownerUi.includes(`\"${slug}\"`)) && ownerUi.includes("verified_external_runs") && ownerUi.includes("next_gate") && ownerUi.includes("Launch locked")],
  ["Package and extended CI enforce the Wave 30 family contract", pkg.includes('"test:families"') && ci.includes("npm run test:families")],
];

let passed = 0;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${name}`);
  }
}

console.log(`\n${passed}/${checks.length} guarded product-family checks passed.`);
if (passed !== checks.length) process.exit(1);
