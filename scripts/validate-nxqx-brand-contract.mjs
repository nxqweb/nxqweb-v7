import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const config = read("src/lib/appConfig.ts");
const home = read("src/pages/PublicHome.tsx");
const catalog = read("src/lib/productCatalog.ts");
const plans = read("src/pages/PublicPlans.tsx");
const html = read("index.html");
const template = read("templates/business-v1/index.html");
const migration = read("supabase/migrations/232_nxqx_brand_and_nxq_branch_names.sql");
const outreach = read("supabase/functions/draft-sales-outreach-ai/index.ts");
const infrastructure = read("supabase/functions/provision-project-infrastructure/index.ts");

const checks = [
  ["parent company defaults to NXQX", config.includes('VITE_COMPANY_NAME || "NXQX"')],
  ["website branch defaults to NXQ-Web", config.includes('VITE_PRODUCT_NAME || "NXQ-Web"')],
  ["support contact defaults to current NXQ-Web inbox", config.includes('VITE_SUPPORT_EMAIL || "NXQweb@protonmail.com"')],
  ["public metadata identifies NXQ-Web by NXQX", html.includes("NXQ-Web by NXQX") && html.includes("Premium Managed Websites")],
  ["public header shows parent and branch", home.includes("<strong>NXQX</strong>") && home.includes("<span>NXQ-Web</span>")],
  ["frontend product catalog uses NXQ-* names", ["NXQ-Business","NXQ-Booking","NXQ-Commerce","NXQ-Menu","NXQ-Property","NXQ-Multi-Location","NXQ-Membership","NXQ-Enterprise Systems"].every((name) => catalog.includes(name))],
  ["public plan cards use NXQ-* names", ["NXQ-Business","NXQ-Booking","NXQ-Commerce","NXQ-Menu","NXQ-Property","NXQ-Multi-Location","NXQ-Membership","NXQ-Enterprise"].every((name) => plans.includes(name))],
  ["generated Business template attributes NXQ-Web", template.includes("Website managed by NXQ-Web")],
  ["database catalog receives branch display names", migration.includes("when 'business' then 'NXQ-Business'") && migration.includes("when 'web' then 'NXQ-Web'")],
  ["stable identifiers remain unchanged", migration.includes("Stable database identifiers") && !migration.includes("update public.nxq_accounts")],
  ["approved and sent outreach cannot be rewritten", migration.includes("where status in ('draft','needs_review')")],
  ["AI outreach identifies NXQ-Web as an NXQX branch", outreach.includes("NXQ-Web, a branch of NXQX")],
  ["generated project descriptions use NXQ-Web", infrastructure.includes("website managed by NXQ-Web")],
  ["legacy setup evidence marker remains stable", read("src/pages/ClientPortal.tsx").includes("NXQ WEB WEBSITE SETUP REPORT")],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} NXQX brand checks passed.`);
if (failed) process.exit(1);
