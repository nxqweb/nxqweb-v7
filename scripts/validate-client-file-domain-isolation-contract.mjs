import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/220_tenant_safe_file_domain_read_models.sql");
const filesPage = read("src/pages/ClientFiles.tsx");
const domainsPage = read("src/pages/ClientDomainStatus.tsx");
const portalPage = read("src/pages/ClientPortal.tsx");
const settingsPage = read("src/pages/ClientSettings.tsx");
const secureAccess = read("supabase/functions/secure-client-file-access/index.ts");

const assertions = [
  [migration.includes("current_client_file_page"), "migration defines current_client_file_page"],
  [migration.includes("current_client_domain_page"), "migration defines current_client_domain_page"],
  [migration.match(/public\.current_client_id\(\)/g)?.length >= 2, "both read models derive tenant from current_client_id"],
  [migration.includes("least(greatest(coalesce(target_limit, 50), 1), 100)"), "read models clamp page size to 100"],
  [!migration.toLowerCase().includes(" offset "), "read models avoid OFFSET pagination"],
  [migration.includes("target_cursor_uploaded_at") && migration.includes("target_cursor_requested_at"), "read models use keyset cursors"],
  [migration.includes("revoke all on function public.current_client_file_page") && migration.includes("from public, anon"), "file page RPC is not public/anon"],
  [migration.includes("revoke all on function public.current_client_domain_page") && migration.includes("from public, anon"), "domain page RPC is not public/anon"],
  [filesPage.includes('rpc("current_client_file_page"'), "ClientFiles uses auth-derived file RPC"],
  [filesPage.includes("Load older files"), "ClientFiles exposes cursor pagination"],
  [!filesPage.includes('.from("clients")') && !filesPage.includes('.from("client_files")') && !filesPage.includes('.from("client_file_security_scans")'), "ClientFiles has no direct tenant-table reads"],
  [domainsPage.includes('rpc("current_client_domain_page"'), "ClientDomainStatus uses auth-derived domain RPC"],
  [domainsPage.includes("Load older domains"), "ClientDomainStatus exposes cursor pagination"],
  [!domainsPage.includes('.from("clients")') && !domainsPage.includes('.from("client_domains")'), "ClientDomainStatus has no direct tenant-table reads"],
  [portalPage.includes('rpc("current_client_file_page"') && portalPage.includes('rpc("current_client_domain_page"'), "main Client Portal uses auth-derived file and domain RPCs"],
  [!portalPage.includes('.from("client_files")') && !portalPage.includes('.from("client_domains")'), "main Client Portal has no direct file/domain reads"],
  [settingsPage.includes('rpc("current_client_domain_page"'), "ClientSettings uses auth-derived domain RPC"],
  [!settingsPage.includes('.from("client_domains")'), "ClientSettings has no direct domain read"],
  [secureAccess.includes('.eq("client_id", client.data.id)'), "signed file access binds file and scan reads to authenticated client"],
  [secureAccess.includes('bucket !== "client-files"'), "signed file access only signs the client-files bucket"],
  [secureAccess.includes("clientPathPrefix") && secureAccess.includes("storagePath.startsWith(clientPathPrefix)"), "signed file access enforces authenticated client storage namespace"],
  [secureAccess.includes('scan.data.status !== "clean"') && secureAccess.includes('scan.data.quarantine_status !== "released"'), "signed file access still requires released clean scan"],
];

let failed = false;
for (const [ok, description] of assertions) {
  if (ok) console.log(`PASS: ${description}`);
  else {
    failed = true;
    console.error(`FAIL: ${description}`);
  }
}

if (failed) process.exit(1);
console.log("Client file/domain isolation contract passed.");
