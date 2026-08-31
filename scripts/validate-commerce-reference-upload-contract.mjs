import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/240_protected_commerce_reference_uploads.sql");
const edge = read("supabase/functions/upload-commerce-request-reference/index.ts");
const sharedContext = read("supabase/functions/_shared/commerce-reference-build-context.ts");
const contextEdge = read("supabase/functions/prepare-commerce-reference-build-context/index.ts");
const publicPage = read("src/pages/PublicCommerceRequest.tsx");
const clientPage = read("src/pages/ClientCommerceRequests.tsx");
const manifest = read("scripts/edge-function-manifest.mjs");
const config = read("supabase/config.toml");
const workflow = read(".github/workflows/manual-supabase-stage.yml");

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
  [manifest.includes('entry("upload-commerce-request-reference", false, "request-upload-ticket-or-worker-token")'), "Edge manifest records the upload-ticket and protected smoke-test boundary"],
  [config.includes("[functions.upload-commerce-request-reference]\nverify_jwt = false"), "gateway permits source-level upload-ticket authentication"],
  [workflow.includes("- smoke_commerce_reference_upload") && workflow.includes("inputs.action == 'smoke_commerce_reference_upload'"), "manual staging exposes one exact Commerce reference smoke action"],
  [workflow.includes("staging_smoke_test") && workflow.includes("upload-commerce-request-reference") && !workflow.includes("smoke_commerce_reference_upload &&"), "smoke action invokes only the scoped upload function"],
  [workflow.includes("- smoke_commerce_reference_ai_handoff") && workflow.includes("inputs.action == 'smoke_commerce_reference_ai_handoff'"), "manual staging exposes one exact Commerce reference AI-handoff smoke action"],
  [workflow.includes("- sync_staging_worker_token") && workflow.includes("inputs.action == 'sync_staging_worker_token'"), "manual staging exposes one exact guarded worker-token synchronization action"],
  [workflow.includes("- sync_staging_runtime_guards") && workflow.includes("inputs.action == 'sync_staging_runtime_guards'"), "manual staging exposes one exact guarded staging-runtime synchronization action"],
  [workflow.includes('secrets_file="$RUNNER_TEMP/nxq-staging-worker-token.env"') && workflow.includes("umask 077") && workflow.includes("trap 'rm -f \"$secrets_file\"' EXIT"), "worker-token synchronization uses a protected temporary file with guaranteed cleanup"],
  [workflow.includes("supabase secrets set") && workflow.includes('--env-file "$secrets_file"') && workflow.includes("set +x"), "worker-token synchronization avoids command tracing and inline secret arguments"],
  [!workflow.includes('echo "$NXQ_AUTOMATION_WORKER_TOKEN"') && !workflow.includes('secrets set NXQ_AUTOMATION_WORKER_TOKEN="$NXQ_AUTOMATION_WORKER_TOKEN"'), "workflow never prints or passes the worker token as an inline CLI argument"],
  [workflow.includes('secrets_file="$RUNNER_TEMP/nxq-staging-runtime-guards.env"') && workflow.includes("printf 'NXQ_RUNTIME_ENVIRONMENT=staging\\nNXQ_AUTOMATION_WORKER_TOKEN=%s\\n'"), "runtime-guard synchronization writes the literal staging marker and protected token through a restricted file"],
  [workflow.includes('safeReasons = new Set([') && workflow.includes('Commerce reference AI-handoff smoke rejected (HTTP ${process.argv[3]})') && workflow.includes("Never print an unparsed or unexpected response body."), "AI-handoff smoke reports only a whitelisted rejection reason without raw response output"],
  [workflow.includes("--output \"$result_file\"") && workflow.includes("--write-out '%{http_code}'") && !workflow.includes("curl --fail-with-body --silent --show-error \\\n            --request POST \\\n            --header \"Content-Type: application/json\" \\\n            --header \"x-nxq-worker-token: $NXQ_AUTOMATION_WORKER_TOKEN\" \\\n            --data '{\"mode\":\"staging_ai_handoff_smoke_test\"}'"), "AI-handoff smoke captures non-success bodies privately for sanitized classification"],
  [workflow.includes("staging_ai_handoff_smoke_test") && workflow.includes('"multimodal_context_verified"') && workflow.includes('"short_lived_access_verified"'), "AI-handoff action requires positive multimodal and bounded-access evidence"],
  [workflow.includes('result.signed_urls_persisted !== false') && workflow.includes('result.provider_invoked !== false') && workflow.includes('result.netlify_calls !== 0'), "AI-handoff action rejects persisted URLs, provider invocation, or Netlify calls"],
  [edge.includes('secret("NXQ_RUNTIME_ENVIRONMENT") !== "staging"') && edge.includes("qa_only: true"), "smoke fixture is staging-only and marked QA-only"],
  [edge.includes("createCommerceReferenceBuildContext") && edge.includes("error.status === 423") && edge.includes("error.status === 403"), "smoke mode proves quarantine and cross-tenant context denial"],
  [edge.includes('status: "clean"') && edge.includes('quarantine_status: "released"') && edge.includes('provider_invoked: false'), "AI-handoff smoke simulates a QA-only clean release without a provider"],
  [edge.includes('context.task === "enrich_commerce_request_from_references_v1"') && edge.includes('imageParts.length === 1'), "AI-handoff smoke proves the released image enters the request-specific multimodal context"],
  [edge.includes('context.expires_in_seconds === 60') && edge.includes('imageUrl.includes("/storage/v1/object/sign/client-files/")'), "AI-handoff smoke verifies short-lived private storage access"],
  [edge.includes('event_type: "commerce_reference_build_context_issued"') && edge.includes('event_type: includeAiHandoff'), "AI-handoff smoke verifies scoped audit evidence and records a bounded result"],
  [edge.includes('admin.storage.from("client-files").remove([storagePath])') && edge.includes('.delete().eq("id", clientId).eq("qa_only", true)'), "smoke mode removes private storage and database fixtures"],
  [["client_files", "client_file_security_scans", "commerce_customer_request_reference_files", "commerce_request_reference_upload_tickets"].every((table) => edge.includes(`admin.from("${table}").select`)), "smoke cleanup verifies every Commerce reference fixture table is empty"],
  [edge.includes('const finalAudit = await admin.from("automation_audit_log").insert') && edge.includes("finalAudit.error") && edge.includes("audit_recorded: true"), "smoke result reports audit evidence only after the insert succeeds"],
  [edge.includes('"commerce_reference_upload_smoke_passed"') && edge.includes('"commerce_reference_ai_handoff_smoke_passed"') && edge.includes("provider_invoked: false") && edge.includes("netlify_calls: 0"), "smoke actions record bounded zero-provider audit evidence"],
  [sharedContext.includes('scan.status !== "clean"') && sharedContext.includes('scan.quarantine_status !== "released"') && sharedContext.includes("!scan.released_at"), "multimodal context rejects anything not clean and released"],
  [sharedContext.includes("expectedClientId !== clientId") && sharedContext.includes("safeStoragePath(storagePath, clientId, requestId)"), "multimodal context binds request, tenant, and storage namespace"],
  [sharedContext.includes('type: "input_image"') && sharedContext.includes('type: "input_text"') && sharedContext.includes('task: "enrich_commerce_request_from_references_v1"'), "clean request data and actual images form a request-specific multimodal context"],
  [sharedContext.includes("createSignedUrl(storagePath, expiresInSeconds)") && sharedContext.includes("expiresInSeconds > 120"), "AI image access uses bounded short-lived signed URLs"],
  [sharedContext.includes("provider_invoked: false") && contextEdge.includes("provider_invoked: false"), "AI provider invocation remains disabled"],
  [contextEdge.includes('requiredSecret("NXQ_AUTOMATION_WORKER_TOKEN")') && contextEdge.includes("constantTimeEqual"), "AI context handoff requires protected worker authentication"],
  [contextEdge.includes('event_type: "commerce_reference_build_context_issued"') && contextEdge.includes("signed_urls_persisted: false"), "AI handoff records file-scoped audit evidence without persisting signed URLs"],
  [manifest.includes('entry("prepare-commerce-reference-build-context", false, "worker-token")') && config.includes("[functions.prepare-commerce-reference-build-context]\nverify_jwt = false"), "AI handoff is declared with its source-level worker authentication boundary"],
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
