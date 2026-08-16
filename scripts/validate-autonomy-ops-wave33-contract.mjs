import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const page = read("src/pages/ClientDomainStatus.tsx");
const guides = read("src/lib/domainGuides.ts");
const domainRpc = read("supabase/migrations/152_client_domain_recheck_controls.sql");
const reconciliation = read("supabase/migrations/128_autonomous_domain_reconciliation.sql");
const tenantReads = read("supabase/migrations/220_tenant_safe_file_domain_read_models.sql");

const checks = [
  ["Domain view remains tenant-derived", page.includes('supabase.rpc("current_client_domain_page"') && !page.includes('.from("clients")') && !page.includes('.from("client_domains")') && tenantReads.includes("create or replace function public.current_client_domain_page") && tenantReads.includes("client_uuid := public.current_client_id()")],
  ["Client recheck remains a typed RPC", page.includes('supabase.rpc("current_client_request_domain_recheck"')],
  ["Recheck RPC cannot mark a domain connected", domainRpc.includes("client cannot mark its own domain connected") || !domainRpc.includes("automation_state = 'connected'"),],
  ["Connection success requires DNS and SSL evidence", page.includes('automation_state === "connected" && domain.ssl_status === "ready"')],
  ["Action-required state comes from backend evidence", page.includes('automation_state === "action_required"') && page.includes("action_required_message")],
  ["Exact backend DNS instructions take visual priority", page.includes("Exact NXQ instructions") && page.includes("domain.dns_instructions")],
  ["Missing exact instructions fail safely", page.includes("Do not guess or change records yet")],
  ["Known registrars receive matched dashboard paths", ["GoDaddy","Namecheap","Cloudflare","Squarespace Domains","Wix","Shopify","Hover","Porkbun"].every((name) => guides.includes(name))],
  ["Google Domains migration is handled as Squarespace", guides.includes('"google domains"') && guides.includes("Squarespace Domains")],
  ["Email MX records are explicitly protected", guides.includes("Do not delete MX records")],
  ["Nameserver changes require explicit NXQ direction", guides.includes("Do not change nameservers unless NXQ explicitly says")],
  ["TTL guidance avoids unnecessary manual values", guides.includes("Leave TTL on Auto or the provider default")],
  ["Generic registrars receive provider-neutral guidance", page.includes("company where your DNS is managed")],
  ["Automatic checks are clearly separated from client actions", page.includes("NXQ is checking automatically") && page.includes("Your action")],
  ["Client can request an immediate safe recheck", page.includes("I made the change — check again") && page.includes("automation_enabled")],
  ["Backend reconciliation still owns connection state", reconciliation.includes("reconcile") && reconciliation.includes("client_domains")],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-thirty-three checks passed.`);
if (passed !== checks.length) process.exit(1);
