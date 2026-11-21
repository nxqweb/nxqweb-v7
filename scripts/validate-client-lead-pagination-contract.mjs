import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/219_tenant_paginated_business_leads.sql");
const ui = read("src/pages/ClientBusinessLeads.tsx");

const checks = [
  ["lead page derives tenant from auth.uid", migration.includes("where auth_user_id=auth.uid()")],
  ["lead page accepts no client id", !migration.includes("target_client_id") && !migration.includes("client_id uuid")],
  ["lead query binds resolved tenant", migration.includes("where l.client_id=client_id_value")],
  ["lead filter runs server-side", migration.includes("view_value='open'") && migration.includes("l.status=view_value")],
  ["page size is server-clamped", migration.includes("least(greatest(coalesce(page_limit,50),1),100)")],
  ["public and anon execution revoked", migration.includes("revoke all on function public.current_client_leads_page")],
  ["only authenticated execution granted", migration.includes("grant execute on function public.current_client_leads_page") && migration.includes("to authenticated")],
  ["client UI uses tenant page RPC", ui.includes('supabase.rpc("current_client_leads_page"')],
  ["client UI no longer takes newest 250 then filters locally", !ui.includes(".limit(250)") && !ui.includes("leads.filter")],
  ["client UI exposes bounded load more", ui.includes("Load more leads") && ui.includes("PAGE_SIZE = 50")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else console.error(`FAIL  ${label}`);
}
console.log(`\n${passed}/${checks.length} client lead pagination checks passed.`);
if (passed !== checks.length) process.exit(1);
