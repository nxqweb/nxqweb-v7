import fs from "node:fs";

const read=(p)=>fs.readFileSync(p,"utf8");
const filesPage=read("src/pages/ClientFiles.tsx");
const secureFile=read("supabase/functions/secure-client-file-access/index.ts");
const notificationIntegrity=read("supabase/migrations/159_harden_notification_preference_integrity.sql");
const seoWorker=read("supabase/functions/build-business-seo-artifacts/index.ts");
const settings=read("src/pages/ClientSettings.tsx");

const checks=[
  ["Client file page does not sign Storage URLs directly",!filesPage.includes("createSignedUrl")],
  ["Client file page uses protected file access function",filesPage.includes('functions.invoke("secure-client-file-access"')&&filesPage.includes("client_file_id:file.id")],
  ["Secure file access requires authenticated caller",secureFile.includes("caller.auth.getUser()")&&secureFile.includes("Authentication required")],
  ["Secure file access resolves client from authenticated user",secureFile.includes('.eq("auth_user_id", user.id)')],
  ["Secure file access verifies file belongs to client",secureFile.includes('.eq("id", clientFileId)')&&secureFile.includes('.eq("client_id", client.data.id)')],
  ["Secure file access independently requires clean released scan",secureFile.includes('scan.data.status !== "clean"')&&secureFile.includes('scan.data.quarantine_status !== "released"')&&secureFile.includes("released_at")],
  ["Client cannot choose bucket or storage path in request",secureFile.includes("client_file_id?: unknown")&&!secureFile.includes("bucket_id?:")&&!secureFile.includes("storage_path?:")],
  ["Temporary client file URL expires quickly",secureFile.includes("createSignedUrl(storagePath, 60")&&secureFile.includes("expires_in_seconds: 60")],
  ["Secure file access writes audit evidence",secureFile.includes("client_file_secure_access_issued")],
  ["Notification timezone integrity is database enforced",notificationIntegrity.includes("pg_timezone_names")&&notificationIntegrity.includes("raise exception 'Invalid notification timezone.'")],
  ["Digest batching does not cancel originals with no enabled digest channel",notificationIntegrity.includes("(p.email_enabled or p.push_enabled)")],
  ["SEO worker creates or reuses a safe branch",seoWorker.includes("ensureSafeBranch")&&seoWorker.includes("refs/heads/")&&seoWorker.includes("safe/seo-")],
  ["SEO worker never force-updates production main",!seoWorker.includes('force:true')&&!seoWorker.includes('force: true')],
  ["Client settings links hardened domain/files/notifications/privacy surfaces",settings.includes('/client/domain')&&settings.includes('/client/files')&&settings.includes('/client/notifications')&&settings.includes('/client/security-privacy')],
];

let passed=0;
for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}
console.log(`\n${passed}/${checks.length} autonomy ops wave-seven checks passed.`);
if(passed!==checks.length)process.exit(1);
