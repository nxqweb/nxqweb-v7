import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const catalog = read("src/lib/productCatalog.ts");
const home = read("src/pages/PublicHome.tsx");
const app = read("src/App.tsx");
const businessDashboard = read("src/pages/ClientBusinessDashboard.tsx");
const domainStatus = read("src/pages/ClientDomainStatus.tsx");
const ownerCommand = read("src/components/OwnerCommandCenter.tsx");
const manualSupabase = read(".github/workflows/manual-supabase-stage.yml");

const checks = [
  [
    "Public pricing remains exactly Starter $50, Growth $100, Intelligence $150, Enterprise $150+",
    catalog.includes('key: "starter"') &&
      catalog.includes('priceLabel: "$50/mo"') &&
      catalog.includes('key: "growth"') &&
      catalog.includes('priceLabel: "$100/mo"') &&
      catalog.includes('key: "intelligence"') &&
      catalog.includes('priceLabel: "$150/mo"') &&
      catalog.includes('key: "enterprise"') &&
      catalog.includes('priceLabel: "$150+/mo"'),
  ],
  [
    "Business is the only currently public family while Commerce stays guarded/planned",
    catalog.includes('slug: "business"') &&
      catalog.includes('status: "available"') &&
      catalog.includes('slug: "commerce"') &&
      catalog.includes('status: "planned"') &&
      catalog.includes('family.slug === "commerce"') &&
      catalog.includes('family.status === "available" || family.status === "beta"'),
  ],
  [
    "Homepage renders pricing from the canonical catalog instead of a second pricing authority",
    home.includes('import { productTiers } from "../lib/productCatalog"') &&
      home.includes("productTiers.map") &&
      !home.includes('priceLabel: "$50/mo"'),
  ],
  [
    "Public promise stays managed-service oriented and preserves owner review",
    /managed website/i.test(home) &&
      /Owner-reviewed where it matters/i.test(home) &&
      !/guaranteed results/i.test(home) &&
      !/100% autonomous/i.test(home),
  ],
  [
    "Client and owner operational routes remain separated behind their existing boundaries",
    app.includes("<OwnerProtectedRoute>") &&
      app.includes('path === "/client"') &&
      app.includes('path === "/owner"') &&
      app.includes('window.location.replace("/portal/login")'),
  ],
  [
    "Premium frontend polish remains mounted without replacing application routing",
    app.includes('import "./styles/final-frontend-polish.css"') &&
      app.includes('import "./styles/nxqx-neural-glass.css"') &&
      app.includes("function AppRoutes()"),
  ],
  [
    "Business dashboard keeps feature access server-authoritative and labels plan gates honestly",
    ["advanced_analytics", "advanced_seo", "mouse_tracking", "multi_location"].every((feature) =>
      businessDashboard.includes(`target_feature_key: "${feature}"`)
    ) &&
      businessDashboard.includes("Plan upgrade") &&
      /consent-gated/i.test(businessDashboard),
  ],
  [
    "Business dashboard does not fabricate zeroes when operational data is unavailable",
    businessDashboard.includes('summary?.leads?.new ?? "—"') &&
      businessDashboard.includes('health?.health || "unavailable"') &&
      businessDashboard.includes("Some Business workspace data could not be verified right now"),
  ],
  [
    "Client domain policy remains BYO and never asks NXQ to own or renew the client domain",
    domainStatus.includes("purchase it from a registrar in your own name first") &&
      domainStatus.includes("does not sell, register, own, renew, or take registrar credentials"),
  ],
  [
    "Owner command center treats failed operational reads as unavailable instead of healthy zeroes",
    ownerCommand.includes('type SourceState = "idle" | "loading" | "ready" | "error"') &&
      ownerCommand.includes("Unknown values are shown as unavailable instead of zero") &&
      ownerCommand.includes('pendingApprovals === null ? "—"') &&
      ownerCommand.includes('ownerAttention === null ? "—"'),
  ],
  [
    "Launch readiness remains visible to the owner instead of being silently inferred",
    ownerCommand.includes("Launch readiness") &&
      ownerCommand.includes('href="/owner/launch-readiness"') &&
      ownerCommand.includes("required checks not ready"),
  ],
  [
    "Supabase staging mutations remain manually confirmed with the staging-only confirmation phrase",
    manualSupabase.includes("workflow_dispatch") &&
      manualSupabase.includes("APPLY-NXQ-SUPABASE-STAGING") &&
      manualSupabase.includes("nxq-staging") &&
      !manualSupabase.includes("supabase link --project-ref ${{ secrets.NXQ_SUPABASE_PRODUCTION_PROJECT_REF"),
  ],
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

console.log(`\n${passed}/${checks.length} pre-18 launch truth checks passed.`);
if (passed !== checks.length) process.exit(1);
