import fs from "node:fs";

const source = fs.readFileSync("supabase/migrations/141_launch_readiness_qa_and_restore_automation.sql", "utf8");
const digestSearchPathFix = fs.readFileSync("supabase/migrations/236_fix_restore_digest_search_path.sql", "utf8");
const productionWorker = fs.readFileSync("supabase/functions/promote-business-production/index.ts", "utf8");

const checks = [
  ["QA lifecycle table records disposable end-to-end runs", source.includes("qa_lifecycle_runs") && source.includes("disposable boolean not null default true")],
  ["Ten-clean-runs gate counts only passed disposable Business E2E runs", source.includes("test_kind = 'business_e2e'") && source.includes("status = 'passed'") && source.includes("passed_e2e >= 10")],
  ["Restore points require verified published deployment evidence", source.includes("last_deployment_status <> 'published'") && source.includes("production_url is null")],
  ["Restore points use the real deployment commit column", source.includes("last_deployed_commit") && !source.includes("last_deployed_commit_sha")],
  ["Production worker writes the same deployment commit column", productionWorker.includes("last_deployed_commit: expectedCommit")],
  ["Restore points include a SHA-256 integrity checksum", source.includes("digest(") && source.includes("'sha256'")],
  ["Recovery RPCs resolve pgcrypto from the extensions schema", digestSearchPathFix.includes("set search_path = public, extensions") && digestSearchPathFix.includes("create_verified_project_restore_point") && digestSearchPathFix.includes("simulate_project_restore")],
  ["Restore simulation validates checksum", source.includes("checksum_matches") && source.includes("expected_checksum")],
  ["Restore simulation is explicitly non-destructive", source.includes("external_changes_made', false") && source.includes("simulation_is_non_destructive")],
  ["Restore simulation never calls GitHub/Netlify/DNS", !source.includes("api.github.com") && !source.includes("api.netlify.com") && !source.includes("net.http_post")],
  ["Launch readiness requires recent healthy worker heartbeats", source.includes("heartbeat_at > now() - interval '10 minutes'")],
  ["Worker loop compares table key to a distinct variable", source.includes("h.worker_key = required_worker_key")],
  ["Launch readiness reads provider health instead of assuming it", source.includes("provider_key = 'github' and status = 'healthy'") && source.includes("provider_key = 'netlify' and status = 'healthy'")],
  ["Launch readiness verifies active NXQ cron jobs", source.includes("cron.job") && source.includes("jobname like 'nxq-%'")],
  ["Backup readiness requires a passed recovery run", source.includes("run_type in ('simulation','restore_test') and status = 'passed'")],
  ["Owner launch signoff is not auto-set", !source.includes("when 'owner_launch_signoff' then 'ready'")],
  ["Runtime-only evidence remains unknown when missing", source.includes("case when workers_ok then 'ready' else 'unknown' end")],
  ["QA evidence table is not writable by normal clients", source.includes("revoke all on table public.qa_lifecycle_runs from public, anon, authenticated")],
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

console.log(`\n${passed}/${checks.length} recovery/readiness checks passed.`);
if (passed !== checks.length) process.exit(1);
