import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const ownerFiles=read("src/pages/OwnerFiles.tsx");
const ownerAccess=read("supabase/functions/secure-owner-file-access/index.ts");
const seoPage=read("src/pages/ClientBusinessSeo.tsx");
const simulator=read("scripts/simulate-autonomy-failures.mjs");
const checks=[
  ["Owner file page no longer signs Storage URLs directly",!ownerFiles.includes("createSignedUrl")&&ownerFiles.includes('functions.invoke("secure-owner-file-access"')],
  ["Owner secure file access verifies authenticated user",ownerAccess.includes("caller.auth.getUser()")&&ownerAccess.includes("Authentication required")],
  ["Owner secure file access requires owner_users identity",ownerAccess.includes('from("owner_users")')&&ownerAccess.includes('.eq("auth_user_id",user.id)')&&ownerAccess.includes("Owner access required")],
  ["Owner secure file access independently requires clean released scan",ownerAccess.includes('scan.data.status!=="clean"')&&ownerAccess.includes('scan.data.quarantine_status!=="released"')&&ownerAccess.includes("released_at")],
  ["Owner secure file access request cannot choose storage path",ownerAccess.includes("client_file_id?:unknown")&&!ownerAccess.includes("storage_path?:")&&!ownerAccess.includes("bucket_id?:")],
  ["Owner secure file URLs are short lived",ownerAccess.includes("createSignedUrl(storagePath,60")&&ownerAccess.includes("expires_in_seconds:60")],
  ["Owner secure file access is audited",ownerAccess.includes("owner_file_secure_access_issued")],
  ["Client SEO Center reads maintenance run ledger",seoPage.includes("project_seo_refresh_runs")&&seoPage.includes("latestRun")],
  ["Client SEO Center surfaces guarded publish lifecycle",seoPage.includes("Building preview")&&seoPage.includes("Promoting safely")&&seoPage.includes("Publishing")&&seoPage.includes("Published")],
  ["Client SEO Center only links verified production URL",seoPage.includes("latestRun.production_url")&&seoPage.includes("View live website")],
  ["Failure simulator covers main drift regeneration",simulator.includes("SEO main drift queues regeneration instead of overwrite")],
  ["Failure simulator covers preview commit mismatch",simulator.includes("SEO preview commit mismatch blocks promotion")],
  ["Failure simulator covers production commit mismatch",simulator.includes("SEO production commit mismatch cannot be marked published")],
  ["Failure simulator covers denial after SEO preview",simulator.includes("Denied client after SEO preview cannot promote")],
  ["Failure simulator total increased to twenty one",simulator.includes("21/21 autonomous lifecycle failure simulations passed")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-nine checks passed.`);if(passed!==checks.length)process.exit(1);
