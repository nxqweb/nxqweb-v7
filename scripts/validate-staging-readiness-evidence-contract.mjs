import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/228_staging_readiness_evidence_gate.sql", "utf8");

const checks = [
  ["evidence table exists", /create table if not exists public\.staging_readiness_evidence_runs/],
  ["only known checks accepted", /check_key in \([\s\S]*business_template_ready[\s\S]*rls_isolation_passed[\s\S]*storage_isolation_passed[\s\S]*domain_flow_passed[\s\S]*maintenance_passed/],
  ["service role required", /auth\.role\(\)<>'service_role'/],
  ["zero failures required", /target_failed_count,0\)<>0/],
  ["sha256 digest required", /\^\[a-f0-9\]\{64\}\$/],
  ["staging environment required", /target_details->>'environment'.*<>'staging'/],
  ["production unchanged required", /production_changed/],
  ["evidence expires", /target_expires_at<=now\(\).*30 days/],
  ["vault values never returned", /'secret_values_returned',false/],
  ["owner signoff remains independent", !migration.includes("owner_launch_signoff")],
  ["browser roles revoked", /revoke all on function public\.record_staging_readiness_evidence[\s\S]*from public,anon,authenticated/],
  ["expiry evaluator scheduled", /nxq-staging-readiness-evidence-every-five-minutes/],
];

let failed = 0;
for (const [name, expectation] of checks) {
  const passed = typeof expectation === "boolean" ? expectation : expectation.test(migration);
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} staging readiness evidence checks passed.`);
if (failed) process.exit(1);
