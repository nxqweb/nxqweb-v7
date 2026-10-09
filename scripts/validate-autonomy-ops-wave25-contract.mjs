import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8");
const initial = read("supabase/migrations/001_nxqweb_v7_initial_schema.sql");
const migration = read("supabase/migrations/185_tenant_safe_client_mutations.sql");
const leads = read("src/pages/ClientBusinessLeads.tsx");
const locations = read("src/pages/ClientBusinessLocations.tsx");
const portal = read("src/pages/ClientPortal.tsx");
const ci = read(".github/workflows/ci-mega-extended.yml");

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx)$/.test(file)) files.push(file);
  }
}
walk("src");
const directTableMutations = [];
const mutationPattern = /\.from\(\s*["']([^"']+)["']\s*\)[\s\S]{0,350}?\.(insert|update|upsert|delete)\(/g;
for (const file of files) {
  for (const match of read(file).matchAll(mutationPattern)) directTableMutations.push(`${file}:${match[1]}.${match[2]}`);
}

const section = (start, end) => migration.slice(migration.indexOf(start), end ? migration.indexOf(end) : migration.length);
const leadFunction = section("create or replace function public.current_client_update_lead_status", "create or replace function public.current_client_create_location");
const locationFunction = section("create or replace function public.current_client_create_location", "create or replace function public.current_client_register_uploaded_file");
const fileFunction = section("create or replace function public.current_client_register_uploaded_file", "revoke insert,update,delete");

const checks = [
  ["No browser source directly mutates Supabase tables", directTableMutations.length === 0],
  ["Lead page uses tenant-safe status RPC", leads.includes('rpc("current_client_update_lead_status"')],
  ["Lead identity is derived from authenticated client", leadFunction.includes("auth_user_id=auth.uid()") && leadFunction.includes("id=target_lead_id and client_id=client_row.id")],
  ["Lead statuses are allowlisted and server timestamped", leadFunction.includes("not in ('new','contacted','qualified','won','lost','spam','archived')") && leadFunction.includes("contacted_at=case") && leadFunction.includes("converted_at=case")],
  ["Archived leads are terminal", leadFunction.includes("Archived leads cannot be changed") && leads.includes('lead.status === "archived"')],
  ["Location page uses one atomic RPC", locations.includes('rpc("current_client_create_location"')],
  ["Location tenant identity cannot come from browser", locationFunction.includes("auth_user_id=auth.uid()") && !locationFunction.includes("target_client_id")],
  ["Standard plans enforce one location and Enterprise supports scale", locationFunction.includes("tier_key_value='enterprise' then 100 else 1") && locationFunction.includes("Current plan location limit reached")],
  ["Location and services insert in one transaction", locationFunction.includes("insert into public.client_locations") && locationFunction.includes("insert into public.client_location_services")],
  ["Location fields and service count are bounded", locationFunction.includes("between 2 and 120") && locationFunction.includes("at most 30 services") && locationFunction.includes("length(area_value)>500")],
  ["Location creation records automatic SEO audit evidence", locationFunction.includes("client_location_created") && locationFunction.includes("'atomic',true")],
  ["Portal registers uploaded metadata through one RPC", portal.includes('rpc("current_client_register_uploaded_file"') && !portal.includes('.from("client_files").insert')],
  ["Portal blocks unsupported and oversized files before upload", portal.includes("allowedFileTypes") && portal.includes("25 * 1024 * 1024")],
  ["File registration derives tenant and validates exact path", fileFunction.includes("auth_user_id=auth.uid()") && fileFunction.includes("split_part(path_value,'/',1)<>client_row.id::text")],
  ["File registration proves storage object exists", fileFunction.includes("from storage.objects") && fileFunction.includes("Uploaded storage object was not found")],
  ["File registration is replay safe", fileFunction.includes("pg_advisory_xact_lock") && fileFunction.includes("already registered")],
  ["File types and size are server-enforced", fileFunction.includes("allowed_types constant text[]") && fileFunction.includes("26214400")],
  ["File audit and quarantine queue are server-owned", fileFunction.includes("client_file_uploaded") && migration.includes("revoke insert,update,delete on public.activity_logs from authenticated")],
  ["Fresh schema captures current file metadata columns", ["bucket_id text","status text","uploaded_at timestamptz","expires_at timestamptz"].every((value) => initial.includes(value))],
  ["Forward migration repairs current file metadata columns", ["add column if not exists bucket_id","add column if not exists status","add column if not exists uploaded_at","add column if not exists expires_at"].every((value) => migration.includes(value))],
  ["All client mutation tables revoke direct writes", ["client_leads","client_locations","client_location_services","client_files","activity_logs"].every((table) => migration.includes(`revoke insert,update,delete on public.${table} from authenticated`))],
  ["QA and hard-stopped clients fail closed", [leadFunction,locationFunction,fileFunction].every((body) => body.includes("qa_only") && body.includes("pipeline_stopped_at"))],
  ["Only authenticated clients receive RPC execution", migration.match(/grant execute on function public\.current_client_/g)?.length === 3 && !migration.includes("to service_role;\ngrant execute")],
  ["Extended CI enforces Wave 25", ci.includes("validate-autonomy-ops-wave25-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else {
    console.error(`FAIL  ${label}`);
    if (label.includes("directly mutates") && directTableMutations.length) console.error(`      ${directTableMutations.join("\n      ")}`);
  }
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-five checks passed.`);
if (passed !== checks.length) process.exit(1);
