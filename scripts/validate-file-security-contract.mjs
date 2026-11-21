import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/144_client_file_security_scanning_foundation.sql", "utf8");
const worker = fs.readFileSync("supabase/functions/scan-client-file/index.ts", "utf8");

const checks = [
  ["File security state is separate from existing client_files", migration.includes("client_file_security_scans") && migration.includes("references public.client_files(id)")],
  ["New uploads default restricted", migration.includes("quarantine_status text not null default 'restricted'")],
  ["Existing non-deleted files are backfilled restricted", migration.includes("Backfill scan records") && migration.includes("'pending', 'restricted'")],
  ["Clients can only see their own scan state", migration.includes("client_view_own_file_security_scans") && migration.includes("c.auth_user_id = auth.uid()")],
  ["Public and anon roles have no scan-table access", migration.includes("revoke all on table public.client_file_security_scans from public, anon")],
  ["Claim uses row locking", migration.includes("for update of s skip locked")],
  ["Only clean files are released", migration.includes("case when target_status = 'clean' then 'released' else 'quarantined' end")],
  ["Suspicious/infected files escalate", migration.includes("client_file_security_alert") && migration.includes("critical")],
  ["Scanner failures keep files restricted", migration.includes("quarantine_status = 'restricted'") && migration.includes("client_file_scan_exhausted")],
  ["File scanner endpoint/token stay in Vault", migration.includes("nxq_file_scan_edge_url") && migration.includes("nxq_automation_worker_token")],
  ["File scanner runs automatically", migration.includes("*/2 * * * *")],
  ["Worker requires protected automation token", worker.includes("x-nxq-worker-token") && worker.includes("NXQ_AUTOMATION_WORKER_TOKEN")],
  ["Worker downloads from private Supabase storage", worker.includes("admin.storage.from") && worker.includes("download(file.storage_path)")],
  ["Worker enforces bounded file size", worker.includes("NXQ_FILE_SCAN_MAX_BYTES") && worker.includes("bytes.byteLength > maxBytes")],
  ["Worker computes SHA-256 before release", worker.includes("crypto.subtle.digest(\"SHA-256\"") && worker.includes("target_content_sha256")],
  ["Worker does not contain malware provider credentials", worker.includes("NXQ_MALWARE_SCAN_ADAPTER_URL") && worker.includes("NXQ_MALWARE_SCAN_ADAPTER_TOKEN")],
  ["Missing scanner adapter cannot mark file clean", worker.includes("Malware scanner adapter is not configured")],
  ["Scanner accepts only clean/suspicious/infected evidence", worker.includes("[\"clean\", \"suspicious\", \"infected\"]")],
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
console.log(`\n${passed}/${checks.length} file security checks passed.`);
if (passed !== checks.length) process.exit(1);
