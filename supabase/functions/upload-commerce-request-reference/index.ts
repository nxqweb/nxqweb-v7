import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  CommerceReferenceContextError,
  createCommerceReferenceBuildContext,
} from "../_shared/commerce-reference-build-context.ts";

type UploadAuthorization = {
  client_id?: string;
  remaining_file_count?: number;
  max_file_size_bytes?: number;
  expires_at?: string;
};

type SmokeFailurePhase =
  | "fixture-client-creation"
  | "fixture-request-creation"
  | "fixture-ticket-creation"
  | "fixture-upload-registration"
  | "isolation-verification"
  | "clean-release-simulation"
  | "multimodal-context-creation"
  | "audit-writing"
  | "cleanup-failure";

class CommerceReferenceSmokeDiagnosticError extends Error {
  constructor(
    message: string,
    readonly phase: SmokeFailurePhase,
    readonly cleanupCompleted: boolean,
  ) {
    super(message);
    this.name = "CommerceReferenceSmokeDiagnosticError";
  }
}

const MAX_MULTIPART_BYTES = 21 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function requestOrigin(req: Request) {
  const value = (req.headers.get("origin") || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? value : "";
  } catch {
    return "";
  }
}

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || "https://invalid.nxq.local",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-nxq-worker-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function response(
  body: unknown,
  status: number,
  origin = "",
  rejectionSource = "",
  smokePhase = "",
  smokeCleanup = "",
) {
  const headers: Record<string, string> = cors(origin);
  headers["X-NXQ-Function-Reached"] = "commerce-reference-upload";
  if (rejectionSource === "worker-token-guard" || rejectionSource === "runtime-environment-guard") {
    headers["X-NXQ-Rejection-Source"] = rejectionSource;
  }
  if (["fixture-client-creation", "fixture-request-creation", "fixture-ticket-creation", "fixture-upload-registration", "isolation-verification", "clean-release-simulation", "multimodal-context-creation", "audit-writing", "cleanup-failure"].includes(smokePhase)) {
    headers["X-NXQ-Smoke-Phase"] = smokePhase;
  }
  if (smokeCleanup === "completed" || smokeCleanup === "not-completed") {
    headers["X-NXQ-Smoke-Cleanup"] = smokeCleanup;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function safeCustomerFileName(value: string) {
  const name = value.trim();
  if (!name || name.length > 255 || name.includes("/") || name.includes("\\") || hasControlCharacters(name)) {
    throw new Error("Reference image file name is invalid.");
  }
  return name;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  return difference === 0;
}

async function uploadReference(
  admin: SupabaseClient,
  requestId: string,
  uploadTicket: string,
  fileValue: File,
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new CommerceReferenceContextError("Request reference is invalid.", 400);
  }
  if (!/^[0-9a-f]{64}$/i.test(uploadTicket)) {
    throw new CommerceReferenceContextError("Upload authorization is invalid or expired.", 403);
  }

  const fileName = safeCustomerFileName(fileValue.name);
  const fileType = fileValue.type.toLowerCase();
  const extension = ALLOWED_TYPES.get(fileType);
  if (!extension) throw new CommerceReferenceContextError("Only JPEG, PNG, and WebP reference images are supported.", 415);
  if (fileValue.size < 1) throw new CommerceReferenceContextError("Reference image is empty.", 400);

  const authorization = await admin.rpc("resolve_commerce_request_reference_upload", {
    target_request_id: requestId,
    upload_ticket: uploadTicket,
  });
  if (authorization.error || !authorization.data) {
    throw new CommerceReferenceContextError("Upload authorization is invalid or expired.", 403);
  }

  const allowed = authorization.data as UploadAuthorization;
  const clientId = String(allowed.client_id || "");
  const maxFileSize = Number(allowed.max_file_size_bytes || 0);
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
    throw new Error("Upload authorization could not be resolved.");
  }
  if (fileValue.size > maxFileSize) {
    throw new CommerceReferenceContextError(`Reference image exceeds the storefront's ${Math.floor(maxFileSize / 1048576)} MB limit.`, 413);
  }

  const storagePath = `${clientId}/commerce-requests/${requestId}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await admin.storage.from("client-files").upload(storagePath, fileValue, {
    contentType: fileType,
    cacheControl: "0",
    upsert: false,
  });
  if (uploaded.error) throw new Error("Private reference image upload failed.");

  const registered = await admin.rpc("register_commerce_request_reference_upload", {
    target_request_id: requestId,
    upload_ticket: uploadTicket,
    target_storage_path: storagePath,
    target_file_name: fileName,
    target_file_type: fileType,
    target_file_size: fileValue.size,
  });
  if (registered.error || !registered.data?.ok) {
    await admin.storage.from("client-files").remove([storagePath]);
    throw new Error("Reference image could not be registered for security scanning.");
  }

  return {
    clientId,
    storagePath,
    clientFileId: String(registered.data.client_file_id || ""),
    quarantineStatus: String(registered.data.quarantine_status || "restricted"),
  };
}

async function runStagingSmokeTest(admin: SupabaseClient, includeAiHandoff = false) {
  if (secret("NXQ_RUNTIME_ENVIRONMENT") !== "staging") {
    throw new CommerceReferenceContextError("Commerce reference smoke testing is restricted to staging.", 403);
  }

  const runId = crypto.randomUUID();
  const fixtureTag = `nxq-commerce-reference-smoke-${runId}`;
  let clientId = "";
  let requestId = "";
  let clientFileId = "";
  let storagePath = "";
  let cleanReleaseVerified = false;
  let multimodalContextVerified = false;
  let shortLivedAccessVerified = false;
  let handoffAuditVerified = false;
  let failurePhase: SmokeFailurePhase = "fixture-client-creation";
  let smokeFailure: unknown = null;
  let cleanupAttemptFailed = false;

  try {
    const client = await admin.from("clients").insert({
      business_name: fixtureTag,
      contact_name: "NXQ staging smoke test",
      contact_email: `${runId}@qa.invalid`,
      business_type: "qa_only_commerce_reference",
      status: "archived",
      monthly_price: 0,
      qa_only: true,
    }).select("id").single();
    if (client.error || !client.data?.id) throw new Error("QA-only Commerce client fixture could not be created.");
    clientId = String(client.data.id);

    failurePhase = "fixture-request-creation";
    const requestRecord = await admin.from("commerce_customer_requests").insert({
      client_id: clientId,
      request_type: "general_suggestion",
      customer_name: "NXQ staging smoke test",
      customer_email: `${runId}@qa.invalid`,
      preferred_contact_method: "email",
      product_name: "Disposable reference-image verification",
      description: `QA-only request ${runId}; must be removed before the smoke action returns.`,
      reference_urls: [],
      status: "new",
    }).select("id").single();
    if (requestRecord.error || !requestRecord.data?.id) throw new Error("QA-only Commerce request fixture could not be created.");
    requestId = String(requestRecord.data.id);

    failurePhase = "fixture-ticket-creation";
    const uploadTicket = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const ticket = await admin.from("commerce_request_reference_upload_tickets").insert({
      request_id: requestId,
      client_id: clientId,
      token_hash: await sha256Hex(uploadTicket),
      expected_file_count: 1,
      max_file_size_bytes: 1048576,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    if (ticket.error) throw new Error("QA-only upload capability could not be created.");

    failurePhase = "fixture-upload-registration";
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
    const uploaded = await uploadReference(admin, requestId, uploadTicket, new File([png], "nxq-reference-smoke.png", { type: "image/png" }));
    clientFileId = uploaded.clientFileId;
    storagePath = uploaded.storagePath;

    failurePhase = "isolation-verification";
    const [file, scan, relation, bucket] = await Promise.all([
      admin.from("client_files").select("id,client_id,bucket_id,storage_path,status").eq("id", uploaded.clientFileId).single(),
      admin.from("client_file_security_scans").select("status,quarantine_status,released_at").eq("client_file_id", uploaded.clientFileId).single(),
      admin.from("commerce_customer_request_reference_files").select("request_id,client_id,client_file_id").eq("client_file_id", uploaded.clientFileId).single(),
      admin.storage.getBucket("client-files"),
    ]);
    const tenantNamespaced = !file.error && file.data?.client_id === clientId
      && file.data?.bucket_id === "client-files"
      && String(file.data?.storage_path || "").startsWith(`${clientId}/commerce-requests/${requestId}/`)
      && relation.data?.request_id === requestId && relation.data?.client_id === clientId;
    const restricted = !scan.error && scan.data?.status === "pending"
      && scan.data?.quarantine_status === "restricted" && !scan.data?.released_at;
    const privateBucket = !bucket.error && bucket.data?.public === false;

    let restrictedContextDenied = false;
    try {
      await createCommerceReferenceBuildContext(admin, requestId, { expiresInSeconds: 60, expectedClientId: clientId });
    } catch (error) {
      restrictedContextDenied = error instanceof CommerceReferenceContextError && error.status === 423;
    }

    let crossTenantDenied = false;
    try {
      await createCommerceReferenceBuildContext(admin, requestId, { expiresInSeconds: 60, expectedClientId: crypto.randomUUID() });
    } catch (error) {
      crossTenantDenied = error instanceof CommerceReferenceContextError && error.status === 403;
    }

    if (!tenantNamespaced || !restricted || !privateBucket || !restrictedContextDenied || !crossTenantDenied
      || uploaded.quarantineStatus !== "restricted") {
      throw new Error("Commerce reference smoke invariants did not all pass.");
    }

    if (includeAiHandoff) {
      failurePhase = "clean-release-simulation";
      const releasedAt = new Date().toISOString();
      const contentSha256 = await sha256Hex(`${runId}:${uploaded.clientFileId}:clean-release`);
      const released = await admin.from("client_file_security_scans").update({
        status: "clean",
        quarantine_status: "released",
        provider_key: "nxq-staging-smoke-simulated",
        provider_reference: `qa-only:${runId}`,
        content_sha256: contentSha256,
        findings: { simulated: true, qa_only: true, provider_invoked: false },
        scanned_at: releasedAt,
        released_at: releasedAt,
        last_error: null,
        updated_at: releasedAt,
      }).eq("client_file_id", uploaded.clientFileId).eq("client_id", clientId)
        .eq("status", "pending")
        .select("status,quarantine_status,content_sha256,released_at")
        .single();
      cleanReleaseVerified = !released.error && released.data?.status === "clean"
        && released.data?.quarantine_status === "released"
        && released.data?.content_sha256 === contentSha256
        && Boolean(released.data?.released_at);
      if (!cleanReleaseVerified) throw new Error("QA-only clean-scan release simulation did not complete.");

      failurePhase = "multimodal-context-creation";
      const context = await createCommerceReferenceBuildContext(admin, requestId, {
        expiresInSeconds: 60,
        expectedClientId: clientId,
      });
      const message = context.multimodal_input[0];
      const content = Array.isArray(message?.content) ? message.content : [];
      const imageParts = content.filter((part) => part.type === "input_image");
      const imageUrl = typeof imageParts[0]?.image_url === "string" ? imageParts[0].image_url : "";
      const evidenceFiles = context.evidence.reference_files;
      multimodalContextVerified = context.schema_version === "nxq-commerce-reference-build-context-v1"
        && context.task === "enrich_commerce_request_from_references_v1"
        && context.client_id === clientId
        && context.request_id === requestId
        && context.provider_invoked === false
        && content[0]?.type === "input_text"
        && imageParts.length === 1
        && evidenceFiles.length === 1
        && evidenceFiles[0]?.client_file_id === uploaded.clientFileId
        && evidenceFiles[0]?.scan_status === "clean"
        && evidenceFiles[0]?.quarantine_status === "released"
        && context.evidence.tenant_bound === true
        && context.evidence.clean_released_only === true;
      shortLivedAccessVerified = context.expires_in_seconds === 60
        && imageUrl.startsWith("https://")
        && imageUrl.includes("/storage/v1/object/sign/client-files/")
        && context.evidence.signed_urls_audited_but_not_persisted === true;
      if (!multimodalContextVerified || !shortLivedAccessVerified) {
        throw new Error("Released Commerce reference did not enter the protected multimodal build context.");
      }

      failurePhase = "audit-writing";
      const audit = await admin.from("automation_audit_log").insert({
        client_id: clientId,
        event_type: "commerce_reference_build_context_issued",
        actor_type: "backend",
        details: {
          request_id: requestId,
          schema_version: context.schema_version,
          task: context.task,
          client_file_ids: evidenceFiles.map((file) => file.client_file_id),
          reference_count: evidenceFiles.length,
          expires_in_seconds: context.expires_in_seconds,
          tenant_bound: true,
          clean_released_only: true,
          provider_invoked: false,
          signed_urls_persisted: false,
          qa_only: true,
          run_id: runId,
        },
      }).select("id,event_type,details").single();
      handoffAuditVerified = !audit.error
        && audit.data?.event_type === "commerce_reference_build_context_issued"
        && audit.data?.details?.request_id === requestId
        && audit.data?.details?.provider_invoked === false
        && audit.data?.details?.signed_urls_persisted === false;
      if (!handoffAuditVerified) throw new Error("Commerce reference AI-handoff audit evidence was not recorded.");
    }
  } catch (error) {
    smokeFailure = error;
  } finally {
    try {
      if (storagePath) {
        const removed = await admin.storage.from("client-files").remove([storagePath]);
        cleanupAttemptFailed ||= Boolean(removed.error);
      }
    } catch {
      cleanupAttemptFailed = true;
    }
    try {
      if (clientId) {
        const removed = await admin.from("clients").delete().eq("id", clientId).eq("qa_only", true);
        cleanupAttemptFailed ||= Boolean(removed.error);
      }
    } catch {
      cleanupAttemptFailed = true;
    }
  }

  let cleanupPassed: boolean;
  try {
    const [clientGone, requestGone, fileGone, scanGone, relationGone, ticketGone, objectGone] = await Promise.all([
      clientId ? admin.from("clients").select("id").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      requestId ? admin.from("commerce_customer_requests").select("id").eq("id", requestId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      clientFileId ? admin.from("client_files").select("id").eq("id", clientFileId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      clientFileId ? admin.from("client_file_security_scans").select("id").eq("client_file_id", clientFileId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      clientFileId ? admin.from("commerce_customer_request_reference_files").select("client_file_id").eq("client_file_id", clientFileId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      requestId ? admin.from("commerce_request_reference_upload_tickets").select("request_id").eq("request_id", requestId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      clientId && requestId
        ? admin.storage.from("client-files").list(`${clientId}/commerce-requests/${requestId}`, { limit: 1 })
        : Promise.resolve({ data: [], error: null }),
    ]);
    cleanupPassed = !cleanupAttemptFailed
      && !clientGone.error && !clientGone.data
      && !requestGone.error && !requestGone.data
      && !fileGone.error && !fileGone.data
      && !scanGone.error && !scanGone.data
      && !relationGone.error && !relationGone.data
      && !ticketGone.error && !ticketGone.data
      && !objectGone.error && (objectGone.data?.length || 0) === 0;
  } catch {
    cleanupPassed = false;
  }
  if (!cleanupPassed) {
    throw new CommerceReferenceSmokeDiagnosticError(
      "Commerce reference smoke fixture cleanup did not complete.",
      "cleanup-failure",
      false,
    );
  }
  if (smokeFailure) {
    const message = smokeFailure instanceof Error ? smokeFailure.message : "Commerce reference smoke failed.";
    throw new CommerceReferenceSmokeDiagnosticError(message, failurePhase, true);
  }

  failurePhase = "audit-writing";
  try {
    const finalAudit = await admin.from("automation_audit_log").insert({
      event_type: includeAiHandoff
        ? "commerce_reference_ai_handoff_smoke_passed"
        : "commerce_reference_upload_smoke_passed",
      actor_type: "backend",
      details: {
        run_id: runId,
        environment: "staging",
        tenant_namespaced: true,
        private_bucket: true,
        quarantine_restricted: true,
        restricted_context_denied: true,
        cross_tenant_context_denied: true,
        clean_release_verified: includeAiHandoff ? cleanReleaseVerified : undefined,
        multimodal_context_verified: includeAiHandoff ? multimodalContextVerified : undefined,
        short_lived_access_verified: includeAiHandoff ? shortLivedAccessVerified : undefined,
        handoff_audit_verified: includeAiHandoff ? handoffAuditVerified : undefined,
        fixture_removed: true,
        provider_invoked: false,
        netlify_calls: 0,
        production_changed: false,
      },
    }).select("id").single();
    if (finalAudit.error || !finalAudit.data?.id) throw new Error("Smoke pass audit was not accepted.");
  } catch {
    throw new CommerceReferenceSmokeDiagnosticError(
      "Commerce reference smoke result audit could not be recorded.",
      failurePhase,
      true,
    );
  }

  return {
    ok: true,
    run_id: runId,
    environment: "staging",
    tenant_namespaced: true,
    private_bucket: true,
    quarantine_status: "restricted",
    access_denied_until_clean_release: true,
    cross_tenant_access_denied: true,
    fixture_removed: true,
    audit_recorded: true,
    ...(includeAiHandoff ? {
      clean_release_verified: true,
      multimodal_context_verified: true,
      short_lived_access_verified: true,
      handoff_audit_verified: true,
      signed_urls_persisted: false,
    } : {}),
    provider_invoked: false,
    netlify_calls: 0,
    production_changed: false,
  };
}

Deno.serve(async (req) => {
  const origin = requestOrigin(req);
  if (req.method === "OPTIONS") return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405, origin);

  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const contentType = req.headers.get("content-type")?.toLowerCase() || "";
    if (contentType.includes("application/json")) {
      const payload = await req.json().catch(() => ({})) as { mode?: unknown };
      if (payload.mode === "staging_smoke_test" || payload.mode === "staging_ai_handoff_smoke_test") {
        const configuredToken = secret("NXQ_AUTOMATION_WORKER_TOKEN");
        const suppliedToken = req.headers.get("x-nxq-worker-token")?.trim() || "";
        if (!suppliedToken || !await constantTimeEqual(suppliedToken, configuredToken)) {
          return response(
            { ok: false, error: "Trusted staging automation access required." },
            403,
            "",
            "worker-token-guard",
          );
        }
        return response(await runStagingSmokeTest(admin, payload.mode === "staging_ai_handoff_smoke_test"), 200);
      }
      return response({ ok: false, error: "Unsupported protected operation." }, 400, origin);
    }

    if (!origin) return response({ ok: false, error: "A valid HTTPS origin is required." }, 403, origin);
    const declaredSize = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declaredSize) && declaredSize > MAX_MULTIPART_BYTES) {
      return response({ ok: false, error: "Reference image exceeds the upload limit." }, 413, origin);
    }

    const form = await req.formData();
    const requestId = String(form.get("request_id") || "").trim();
    const uploadTicket = String(form.get("upload_ticket") || "").trim();
    const fileValue = form.get("file");
    if (!(fileValue instanceof File)) return response({ ok: false, error: "A reference image is required." }, 400, origin);

    const uploaded = await uploadReference(admin, requestId, uploadTicket, fileValue);
    return response({
      ok: true,
      accepted: true,
      client_file_id: uploaded.clientFileId,
      quarantine_status: "restricted",
      message: "Reference image is private and remains unavailable until its security scan passes.",
    }, 201, origin);
  } catch (error) {
    const status = error instanceof CommerceReferenceContextError ? error.status : 500;
    const isSmokeDiagnostic = error instanceof CommerceReferenceSmokeDiagnosticError;
    const message = isSmokeDiagnostic
      ? "Commerce reference smoke failed."
      : error instanceof Error ? error.message : "Reference image upload failed.";
    const rejectionSource = message === "Commerce reference smoke testing is restricted to staging."
      ? "runtime-environment-guard"
      : "";
    const smokePhase = isSmokeDiagnostic ? error.phase : "";
    const smokeCleanup = isSmokeDiagnostic ? (error.cleanupCompleted ? "completed" : "not-completed") : "";
    return response({ ok: false, error: message }, status, origin, rejectionSource, smokePhase, smokeCleanup);
  }
});
