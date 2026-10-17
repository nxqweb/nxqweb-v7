import fs from "node:fs";

const owner = fs.readFileSync("src/pages/OwnerPortal.tsx", "utf8");
const client = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
const cursorMigration = fs.readFileSync("supabase/migrations/207_scale_search_and_cursor_hardening.sql", "utf8");
const ownerReadModels = fs.readFileSync("supabase/migrations/217_scalable_owner_portal_read_models.sql", "utf8");

const checks = [];
function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

// Owner Portal must consume stable read models instead of loading tenant-wide tables.
check("Owner Portal uses global summary RPC", owner.includes('rpc("owner_portal_summary"'));
check("Owner Portal uses cursor client directory", owner.includes('rpc("owner_client_directory_page"'));
check("Owner Portal uses per-client message cursor", owner.includes('rpc("owner_client_message_page"'));
check("Owner Portal uses bounded unread feed", owner.includes('rpc("owner_unread_message_page"'));
check("Owner Portal has server-side client search", owner.includes("target_search: clientSearch.trim() || null") || owner.includes("target_search: searchValue.trim() || null"));
check("Owner Portal exposes load-more clients", owner.includes("Load more clients"));
check("Owner Portal exposes older-message paging", owner.includes("Load older messages"));
check("Owner Portal does not directly read clients table", !owner.includes('.from("clients")'));
check("Owner Portal does not directly read projects table", !owner.includes('.from("projects")'));
check("Owner Portal does not directly read client_messages", !owner.includes('.from("client_messages")'));

// Client message history must derive tenant identity in the database and remain cursor-paged.
check("Client Portal uses tenant-derived message RPC", client.includes('rpc("current_client_message_page"'));
check("Client Portal exposes older-message paging", client.includes("Load older messages"));
check("Client Portal does not directly read client_messages", !client.includes('.from("client_messages")'));

// Cursor contracts: bounded page size, unlimited total history, no OFFSET/deep pagination.
check("Existing client list page clamps network page size", cursorMigration.includes("least(greatest(coalesce(target_limit, 50), 1), 100)"));
check("Existing client message page clamps network page size", (cursorMigration.match(/least\(greatest\(coalesce\(target_limit, 50\), 1\), 100\)/g) || []).length >= 2);
check("Cursor migration uses created_at+id keyset", cursorMigration.includes("(c.created_at, c.id) <") && cursorMigration.includes("(m.created_at, m.id) <"));
check("Cursor migration has no OFFSET", !/\boffset\b/i.test(cursorMigration));
check("Client message RPC derives current client", cursorMigration.includes("public.current_client_id()"));
check("Business-name trigram search index exists", cursorMigration.includes("clients_business_name_trgm_idx"));

// Owner-specific scalable read models must stay owner-only and keyset paginated.
check("Owner summary read model exists", ownerReadModels.includes("function public.owner_portal_summary"));
check("Owner directory read model exists", ownerReadModels.includes("function public.owner_client_directory_page"));
check("Owner approvals read model exists", ownerReadModels.includes("function public.owner_approval_page"));
check("Owner message read model exists", ownerReadModels.includes("function public.owner_client_message_page"));
check("Owner unread feed exists", ownerReadModels.includes("function public.owner_unread_message_page"));
check("Owner directory uses keyset cursor", ownerReadModels.includes("(c.created_at, c.id) <"));
check("Owner messages use keyset cursor", ownerReadModels.includes("(m.created_at, m.id) <"));
check("Owner read models have no OFFSET", !/\boffset\b/i.test(ownerReadModels));
check("Owner read models clamp to <=100 rows", (ownerReadModels.match(/least\(greatest\(coalesce\(target_limit,/g) || []).length >= 4 && ownerReadModels.includes(", 100)"));
check("Owner read models require owner access", (ownerReadModels.match(/Owner access required\./g) || []).length >= 5);
check("Owner SECURITY DEFINER functions pin search_path", (ownerReadModels.match(/security definer\nset search_path = public/g) || []).length >= 5);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`\nPortal scale contract failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`\nPortal scale contract passed: ${checks.length}/${checks.length}. Page size is bounded; total client/message population is not.`);
