import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const config = read("src/lib/appConfig.ts");
const domainPage = read("src/pages/ClientDomainStatus.tsx");
const portal = read("src/pages/ClientPortal.tsx");
const migration = read("supabase/migrations/231_enforce_client_owned_domain_policy.sql");
const runbook = read("docs/LAUNCH_HARDENING_CHECKLIST.md");

const checks = [
  ["brand name is environment-configurable", config.includes("VITE_COMPANY_NAME") && config.includes("VITE_PRODUCT_NAME")],
  ["support address is environment-configurable", config.includes("VITE_SUPPORT_EMAIL")],
  ["domain policy is centralized", config.includes("clientDomainPolicy") && config.includes('ownership: "client_owned"')],
  ["client UI says NXQ never owns domains", domainPage.includes("does not sell, register, own, renew")],
  ["client retains registrar access", portal.includes("registrar access") && portal.includes("registrar password")],
  ["database restricts domains to client-owned", migration.includes("domain_type = 'client_owned'")],
  ["database requires ownership confirmation", migration.includes("ownership_confirmed is true")],
  ["database trigger guards future writes", migration.includes("before insert or update of domain_type, ownership_confirmed")],
  ["trigger is unavailable to browser roles", migration.includes("from public, anon, authenticated")],
  ["runbook separates proved and external checks", runbook.includes("Proved locally or in staging") && runbook.includes("Externally blocked or credential-dependent")],
  ["runbook preserves owner production approval", runbook.includes("Explicit owner production-launch approval")],
  ["runbook prohibits fake provider evidence", runbook.includes("Never use placeholder secrets")],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} launch-hardening checks passed.`);
if (failed) process.exit(1);
