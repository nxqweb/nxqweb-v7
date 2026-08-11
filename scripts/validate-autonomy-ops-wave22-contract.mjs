import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8");
const initial = read("supabase/migrations/001_nxqweb_v7_initial_schema.sql");
const migration = read("supabase/migrations/182_project_status_replay_and_targeted_info_rpc.sql");
const ownerPortal = read("src/pages/OwnerPortal.tsx");
const portalLogin = read("src/pages/PortalLogin.tsx");
const ownerRoute = read("src/components/OwnerProtectedRoute.tsx");
const app = read("src/App.tsx");
const baseStyles = read("src/index.css");
const nxqStyles = read("src/styles/nxq.css");
const publicCardBorder = nxqStyles.slice(
  nxqStyles.indexOf(".lux-card::before"),
  nxqStyles.indexOf(".lux-card > *")
);
const ci = read(".github/workflows/ci-mega-extended.yml");
const infoFunction = migration.slice(migration.indexOf("create or replace function public.request_targeted_more_info"));

const sourceRoots = ["src", "supabase/functions"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const rpcPattern = /\.rpc\(\s*["']([^"']+)["']/g;
const calls = new Map();

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (sourceExtensions.has(path.extname(file))) {
      const source = read(file);
      for (const match of source.matchAll(rpcPattern)) {
        const files = calls.get(match[1]) || [];
        files.push(file);
        calls.set(match[1], files);
      }
    }
  }
}

for (const root of sourceRoots) walk(root);
const migrationSource = fs.readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .map((file) => read(path.join("supabase/migrations", file)))
  .join("\n");
const unmatchedRpcs = [...calls.keys()].filter((name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`\\bfunction\\s+(?:public\\.)?${escaped}\\s*\\(`, "i").test(migrationSource);
});

const checks = [
  ["Fresh base schema declares owner identity before migration 007", initial.includes("create table if not exists public.owner_users") && initial.includes("auth_user_id uuid not null unique references auth.users")],
  ["Fresh base schema links client logins before migration 007", initial.includes("auth_user_id uuid unique references auth.users(id) on delete set null")],
  ["Owner identity is self-readable but not client-writable", initial.includes('create policy "Owner can read own owner record"') && initial.includes("grant select on public.owner_users to authenticated") && !initial.includes("grant insert on public.owner_users to authenticated")],
  ["Shared portal and protected owner route request only captured owner columns", [portalLogin, ownerRoute].every((source) => source.includes('.from("owner_users")') && source.includes('.select("id")'))],
  ["Owner access checks never depend on an uncaptured role column", [portalLogin, ownerRoute].every((source) => !source.includes('.select("id, role")'))],
  ["Legacy owner login always redirects into the one shared portal login", app.includes('path === "/owner/login"') && app.includes('window.location.replace("/portal/login")') && !app.includes('import("./pages/OwnerLogin")')],
  ["Shared login routes owners and clients to their protected portals", portalLogin.includes('window.location.href = "/owner"') && portalLogin.includes('window.location.href = "/client"')],
  ["Public root has no legacy fixed-width light template shell", baseStyles.includes("#030712") && !baseStyles.includes("width: 1126px") && !baseStyles.includes("--bg: #fff")],
  ["Homepage premium cards avoid mask compositing artifacts", !publicCardBorder.includes("-webkit-mask") && !publicCardBorder.includes("mask-composite")],
  ["Forward migration repairs owner and client identity schema", migration.includes("create table if not exists public.owner_users") && migration.includes("add column if not exists auth_user_id uuid") && migration.includes("clients_auth_user_id_uidx")],
  ["Fresh base schema declares website_status before migration 010", initial.includes("website_status text not null default 'intake'")],
  ["Forward migration repairs existing project tables", migration.includes("add column if not exists website_status text not null default 'intake'")],
  ["Invalid legacy website statuses are backfilled safely", migration.includes("website_status not in") && migration.includes("set website_status=stage::text")],
  ["Project status compatibility column is constrained", migration.includes("projects_website_status_check") && migration.includes("approved_for_launch")],
  ["Typed project stage is the single lifecycle authority", migration.includes("sync_project_website_status_from_stage") && migration.includes("new.website_status:=new.stage::text")],
  ["Every source RPC call has a captured migration definition", unmatchedRpcs.length === 0],
  ["Stale manual client-status RPC call was removed", !ownerPortal.includes('rpc("update_client_status"')],
  ["Stale manual project-create RPC call was removed", !ownerPortal.includes('rpc("create_project_for_client"')],
  ["Stale manual project-stage RPC call was removed", !ownerPortal.includes('rpc("update_project_stage"')],
  ["Stale legacy preview-approval RPC call was removed", !ownerPortal.includes('rpc("approve_launch_preview"')],
  ["Dead duplicate setup approval handler was removed", !ownerPortal.includes("acceptApprovalAndStartPipelineCloud") && !ownerPortal.includes("isAiTaskApproval")],
  ["Owner Portal explains lifecycle automation authority", ownerPortal.includes("lifecycle changes come from the normal APPROVE or DENY decision") && ownerPortal.includes("Stage is automation-owned")],
  ["Needs Info has a captured owner-only RPC", migration.includes("create or replace function public.request_targeted_more_info") && migration.includes("Authenticated owner access required")],
  ["Needs Info field keys are an explicit allowlist", migration.includes("preferred_contact_method") && migration.includes("assistant_rules") && migration.includes("Unsupported targeted information field")],
  ["Needs Info labels and request bodies are bounded", migration.includes("between 1 and 80") && migration.includes("between 5 and 1000")],
  ["Needs Info is forbidden for disposable QA", migration.includes("Manual information requests are disabled for disposable QA clients")],
  ["Needs Info is allowed only before client approval", migration.includes("not in ('lead','intake_received','needs_owner_review')")],
  ["Needs Info closes stale pending setup reviews", migration.includes("status='more_info_requested'") && migration.includes("superseded_review_count=row_count") && migration.includes("request_type='website_setup_review'")],
  ["Needs Info reopens the exact Client Portal field", migration.includes("NXQ TARGETED MORE INFO REQUEST") && migration.includes("'Field key: '") && migration.includes("'Requested info: '")],
  ["Needs Info is stored as an in-portal owner message", migration.includes("insert into public.client_messages") && migration.includes("message_value")],
  ["Needs Info records audit evidence without external delivery", migration.includes("targeted_setup_info_requested") && migration.includes("'external_notification_sent',false") && !migration.includes("insert into public.notification_deliveries")],
  ["Needs Info cannot mutate project or billing state", !infoFunction.includes("update public.projects") && !infoFunction.includes("billing_status") && !infoFunction.includes("payment_records")],
  ["Service role cannot make the human Needs Info request", migration.includes("from public,anon,authenticated,service_role") && migration.includes("to authenticated") && !migration.includes("to authenticated,service_role")],
  ["Extended CI enforces Wave 22", ci.includes("validate-autonomy-ops-wave22-contract.mjs")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL  ${label}`);
    if (label.includes("RPC") && unmatchedRpcs.length) console.error(`      unmatched: ${unmatchedRpcs.join(", ")}`);
  }
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-two checks passed.`);
if (passed !== checks.length) process.exit(1);
