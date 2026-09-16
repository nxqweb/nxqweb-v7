import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));

const app = read("src/App.tsx");
const lifecycle = read("scripts/simulate-business-lifecycle-e2e.mjs");
const commandCenter = read("src/components/OwnerCommandCenter.tsx");
const clientTopCards = read("src/components/ClientPortalTopCards.tsx");
const businessDashboard = read("src/pages/ClientBusinessDashboard.tsx");
const productCatalog = read("src/lib/productCatalog.ts");
const publicHome = read("src/pages/PublicHome.tsx");
const neuralGlass = read("src/styles/nxqx-neural-glass.css");
const buildPlanRouter = read("supabase/functions/generate-business-build-plan/index.ts");
const prepareBuildPlan = read("supabase/functions/prepare-build-plan/index.ts");
const commerceContext = read("supabase/functions/prepare-commerce-reference-build-context/index.ts");
const commerceUpload = read("supabase/functions/upload-commerce-request-reference/index.ts");
const growthContract = read("scripts/validate-growth-and-outreach-contract.mjs");
const familyContract = read("scripts/validate-autonomy-ops-wave30-contract.mjs");
const launchHardening = read("scripts/validate-launch-hardening-pack.mjs");
const businessTemplate = read("templates/business-v1/site.config.js");
const tree = json("templates/business-v1/niches/tree-service.json");
const roofing = json("templates/business-v1/niches/roofing.json");
const detailing = json("templates/business-v1/niches/auto-detailing.json");

const checks = [
  ["Business lifecycle simulator requires ten clean runs by default", lifecycle.includes("--runs=10") || read("package.json").includes("simulate-business-lifecycle-e2e.mjs --runs=10")],
  ["Owner approval, denial, idempotency, GitHub and Netlify checkpoints are modeled", ["owner_approval_accepted", "owner_denied_pipeline_stopped", "githubRepoId", "netlifySiteId", "idempotencyKey"].every((token) => lifecycle.includes(token))],
  ["Cross-tenant promotion and exact-commit verification fail closed", lifecycle.includes("Cross-tenant preview promotion is blocked") && lifecycle.includes("production commit mismatch")],
  ["Client and owner command surfaces are mounted behind existing routes", app.includes("<OwnerCommandCenter />") && app.includes("<ClientPortalTopCards />") && app.includes('path === "/client/business"')],
  ["Owner command center treats failed reads as unknown rather than zero", commandCenter.includes('type SourceState = "idle" | "loading" | "ready" | "error"') && commandCenter.includes("Unknown values are shown as unavailable instead of zero")],
  ["Client portal exposes Business leads, changes, locations, analytics, SEO and reports", ["/client/business/leads", "/client/business/changes", "/client/business/locations", "/client/business/analytics", "/client/business/seo", "/client/business/reports"].every((route) => businessDashboard.includes(route))],
  ["Business workspace does not surface provider error text", !businessDashboard.includes("problem.message") && businessDashboard.includes("could not be verified right now")],
  ["Client action center preserves denial hard stop", clientTopCards.includes("Website setup was not approved") && clientTopCards.includes("!denied")],
  ["Public pricing remains 50 / 100 / 150 / 150+", ["$50/mo", "$100/mo", "$150/mo", "$150+/mo"].every((price) => productCatalog.includes(price))],
  ["Only launch-authorized product-family statuses are publicly selectable", productCatalog.includes('family.status === "available" || family.status === "beta"')],
  ["Public frontend is using the NXQX neural-glass theme", app.includes('import "./styles/nxqx-neural-glass.css"') && neuralGlass.includes("NXQX Neural Glass") && neuralGlass.includes("nxq-metal-edge")],
  ["Public experience keeps the managed lifecycle story", ["Build", "Get found", "Convert", "Understand", "Improve"].every((label) => publicHome.includes(label))],
  ["Business AI router supports external provider and non-production local adapter", buildPlanRouter.includes('type ProviderRoute = "external_provider" | "local_adapter"') && buildPlanRouter.includes("Local AI adapter is forbidden outside non-production environments")],
  ["Business AI contract forbids provider or production actions", buildPlanRouter.includes("production_or_provider_actions_forbidden: true") && buildPlanRouter.includes("legal_financial_medical_guarantees_forbidden: true")],
  ["Grounded build-plan worker rejects unapproved services and pages", prepareBuildPlan.includes("attempted to add or rename an approved service") && prepareBuildPlan.includes("describe every approved page exactly once")],
  ["Commerce reference handoff is tenant-bound and provider-disabled", commerceContext.includes("tenant_bound: true") && commerceContext.includes("provider_invoked: false") && commerceContext.includes("clean_released_only: true")],
  ["Commerce upload path is implemented as a dedicated protected worker", commerceUpload.includes("NXQ_AUTOMATION_WORKER_TOKEN") && commerceUpload.toLowerCase().includes("commerce")],
  ["Growth/outreach foundation remains review-only with external delivery disabled", growthContract.includes("review_only") && growthContract.includes("external_delivery_enabled boolean not null default false") && growthContract.includes("owner-review drafts")],
  ["Product-family launch gates require ten disposable external passes", familyContract.includes("required_clean_runs") && familyContract.includes("ten disposable external passes")],
  ["Launch hardening keeps external/high-risk features disabled by default", launchHardening.includes("external and high-risk features start disabled")],
  ["Business template ships with leads and analytics disabled by default", businessTemplate.includes("enabled: false") && businessTemplate.includes("consentRequired: true")],
  ["Tree, roofing and detailing niche packs exist and are demo-only", [tree, roofing, detailing].every((pack) => pack.schema_version === "nxq-business-niche-pack-v1" && pack.demo_only === true && pack.launch_enabled === false)],
  ["Niche packs prohibit invented trust claims", [tree, roofing, detailing].every((pack) => pack.content_rules.some((rule) => /Never invent/i.test(rule)))],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} pre-18 launch-readiness contract checks passed.`);
if (failed) process.exit(1);
