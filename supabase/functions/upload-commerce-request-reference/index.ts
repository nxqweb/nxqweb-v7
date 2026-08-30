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

function response(body: unknown, status: number, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
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

async function runStagingSmokeTest(admin: SupabaseClient) {
  if (secret("NXQ_RUNTIME_ENVIRONMENT") !== "staging") {
    throw new CommerceReferenceContextError("Commerce reference smoke testing is restricted to staging.", 403);
  }

  const runId = crypto.randomUUID();
  const fixtureTag = `nxq-commerce-reference-smoke-${runId}`;
  let clientId = "";
  let requestId: string;
  let storagePath = "";

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

    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
    const uploaded = await uploadReference(admin, requestId, uploadTicket, new File([png], "nxq-reference-smoke.png", { type: "image/png" }));
    storagePath = uploaded.storagePath;

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
  } finally {
    if (storagePath) await admin.storage.from("client-files").remove([storagePath]);
    if (clientId) await admin.from("clients").delete().eq("id", clientId).eq("qa_only", true);
  }

  const [clientGone, requestGone, objectGone] = await Promise.all([
    admin.from("clients").select("id").eq("id", clientId).maybeSingle(),
    admin.from("commerce_customer_requests").select("id").eq("id", requestId).maybeSingle(),
    admin.storage.from("client-files").list(`${clientId}/commerce-requests/${requestId}`, { limit: 1 }),
  ]);
  const cleanupPassed = !clientGone.data && !requestGone.data && !objectGone.error && (objectGone.data?.length || 0) === 0;
  if (!cleanupPassed) throw new Error("Commerce reference smoke fixture cleanup did not complete.");

  await admin.from("automation_audit_log").insert({
    event_type: "commerce_reference_upload_smoke_passed",
    actor_type: "backend",
    details: {
      run_id: runId,
      environment: "staging",
      tenant_namespaced: true,
      private_bucket: true,
      quarantine_restricted: true,
      restricted_context_denied: true,
      cross_tenant_context_denied: true,
      fixture_removed: true,
      provider_invoked: false,
      netlify_calls: 0,
      production_changed: false,
    },
  });

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
      if (payload.mode === "staging_smoke_test") {
        const configuredToken = secret("NXQ_AUTOMATION_WORKER_TOKEN");
        const suppliedToken = req.headers.get("x-nxq-worker-token")?.trim() || "";
        if (!suppliedToken || !await constantTimeEqual(suppliedToken, configuredToken)) {
          return response({ ok: false, error: "Trusted staging automation access required." }, 403);
        }
        return response(await runStagingSmokeTest(admin), 200);
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
    const message = error instanceof Error ? error.message : "Reference image upload failed.";
    return response({ ok: false, error: message }, status, origin);
  }
});
