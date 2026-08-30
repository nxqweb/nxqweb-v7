import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/240_protected_commerce_reference_uploads.sql");
const edge = read("supabase/functions/upload-commerce-request-reference/index.ts");
const publicPage = read("src/pages/PublicCommerceRequest.tsx");
const clientPage = read("src/pages/ClientCommerceRequests.tsx");
const manifest = read("scripts/edge-function-manifest.mjs");
const config = read("supabase/config.toml");

const assertions = [
  [migration.includes("commerce_request_reference_upload_tickets"), "request-scoped upload tickets are persisted"],
  [migration.includes("encode(digest(v_upload_ticket, 'sha256'), 'hex')"), "only a SHA-256 upload-ticket hash is stored"],
  [migration.includes("interval '15 minutes'"), "upload capability expires after 15 minutes"],
  [migration.includes("auth.role() <> 'service_role'"), "upload resolution and registration require service role"],
  [migration.includes("revoke all on public.commerce_request_reference_upload_tickets from public, anon, authenticated"), "ticket records are unavailable to browser roles"],
  [migration.includes("client_id::text || '/commerce-requests/' || target_request_id::text || '/'"), "storage path is tenant and request namespaced"],
  [migration.includes("bucket_id = 'client-files'"), "registration requires an existing object in the private client-files bucket"],
  [migration.includes("insert into public.client_files"), "accepted uploads enter the canonical client-file registry"],
  [migration.includes("'quarantine_status', 'restricted'") && migration.includes("'scan_required', true"), "registration reports restricted scan-required state"],
  [migration.includes("left join public.client_file_security_scans"), "Commerce request read model exposes scan state without file contents"],
  [edge.includes('upload_ticket') && edge.includes('resolve_commerce_request_reference_upload'), "Edge upload requires the request capability before storage access"],
  [edge.includes('admin.storage.from("client-files").upload'), "Edge function performs service-authenticated private storage upload"],
  [edge.includes('admin.storage.from("client-files").remove([storagePath])'), "orphaned private objects are removed when registration fails"],
  [edge.includes('new Map([') && edge.includes('["image/jpeg", "jpg"]') && edge.includes('["image/png", "png"]') && edge.includes('["image/webp", "webp"]'), "server allowlists three image MIME types and derives extensions"],
  [!edge.includes("getPublicUrl") && !migration.includes("storage.objects for insert to anon"), "repair creates no public URL or anonymous bucket insert policy"],
  [publicPage.includes('type="file"') && publicPage.includes('reference_upload_count: referenceFiles.length'), "customer form uses file selection instead of reference links"],
  [!publicPage.includes("referenceLinks") && !publicPage.includes("Reference image links"), "link-only reference placeholder is removed"],
  [publicPage.includes('functions.invoke("upload-commerce-request-reference"'), "customer form uses the guarded upload Edge function"],
  [publicPage.includes("remain unavailable until security scanning passes"), "customer receives explicit quarantine disclosure"],
  [clientPage.includes("restricted pending security approval"), "client request view does not imply quarantined images are available"],
  [manifest.includes('entry("upload-commerce-request-reference", false, "request-upload-ticket")'), "Edge manifest records the capability authentication boundary"],
  [config.includes("[functions.upload-commerce-request-reference]\nverify_jwt = false"), "gateway permits source-level upload-ticket authentication"],
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
console.log("Protected Commerce reference-image upload contract passed.");
