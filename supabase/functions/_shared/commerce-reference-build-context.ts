import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

export class CommerceReferenceContextError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CommerceReferenceContextError";
    this.status = status;
  }
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeStoragePath(path: string, clientId: string, requestId: string) {
  const prefix = `${clientId}/commerce-requests/${requestId}/`;
  return path.startsWith(prefix) && !path.includes("..") && !path.includes("//") && !path.startsWith("/");
}

export async function createCommerceReferenceBuildContext(
  admin: SupabaseClient,
  requestId: string,
  options: { expiresInSeconds?: number; expectedClientId?: string } = {},
) {
  if (!validUuid(requestId)) throw new CommerceReferenceContextError("A valid Commerce request id is required.", 400);

  const expiresInSeconds = options.expiresInSeconds ?? 60;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > 120) {
    throw new CommerceReferenceContextError("Commerce reference access lifetime is outside the protected range.", 400);
  }

  const requestResult = await admin
    .from("commerce_customer_requests")
    .select("id,client_id,request_type,product_name,description,desired_quantity,budget_range,needed_by_date,status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestResult.error || !requestResult.data) {
    throw new CommerceReferenceContextError("Commerce request was not found.", 404);
  }

  const clientId = String(requestResult.data.client_id || "");
  if (!validUuid(clientId) || options.expectedClientId && options.expectedClientId !== clientId) {
    throw new CommerceReferenceContextError("Commerce request is outside the authorized tenant.", 403);
  }

  const references = await admin
    .from("commerce_customer_request_reference_files")
    .select("client_file_id,client_id,customer_file_name,created_at")
    .eq("request_id", requestId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (references.error) throw new Error("Commerce reference files could not be loaded.");
  if (!references.data?.length) throw new CommerceReferenceContextError("Commerce request has no reference images.", 409);
  if (references.data.length > 10) throw new CommerceReferenceContextError("Commerce request exceeds the reference-image limit.", 409);

  const imageParts: JsonRecord[] = [];
  const evidenceFiles: Array<{
    client_file_id: string;
    file_name: string;
    file_type: unknown;
    file_size: unknown;
    content_sha256: unknown;
    scan_status: unknown;
    quarantine_status: unknown;
    released_at: unknown;
  }> = [];
  for (const reference of references.data) {
    const clientFileId = String(reference.client_file_id || "");
    if (!validUuid(clientFileId) || String(reference.client_id || "") !== clientId) {
      throw new CommerceReferenceContextError("Commerce reference relation crossed a tenant boundary.", 403);
    }

    const [fileResult, scanResult] = await Promise.all([
      admin.from("client_files")
        .select("id,client_id,bucket_id,storage_path,file_name,file_type,file_size,status,expires_at")
        .eq("id", clientFileId).eq("client_id", clientId).maybeSingle(),
      admin.from("client_file_security_scans")
        .select("status,quarantine_status,content_sha256,scanned_at,released_at")
        .eq("client_file_id", clientFileId).eq("client_id", clientId).maybeSingle(),
    ]);
    if (fileResult.error || !fileResult.data || scanResult.error || !scanResult.data) {
      throw new CommerceReferenceContextError("Commerce reference security verification is incomplete.", 423);
    }

    const file = fileResult.data;
    const scan = scanResult.data;
    const storagePath = String(file.storage_path || "");
    if (String(file.client_id || "") !== clientId || String(file.bucket_id || "") !== "client-files"
      || !safeStoragePath(storagePath, clientId, requestId)) {
      throw new CommerceReferenceContextError("Commerce reference file is outside its request namespace.", 403);
    }
    if (String(file.status) === "deleted" || file.expires_at && new Date(String(file.expires_at)).getTime() <= Date.now()) {
      throw new CommerceReferenceContextError("Commerce reference file is unavailable.", 410);
    }
    if (scan.status !== "clean" || scan.quarantine_status !== "released" || !scan.released_at) {
      throw new CommerceReferenceContextError("Commerce reference image remains restricted by file security.", 423);
    }

    const signed = await admin.storage.from("client-files").createSignedUrl(storagePath, expiresInSeconds);
    if (signed.error || !signed.data?.signedUrl) throw new Error("Protected Commerce reference access could not be issued.");

    imageParts.push({
      type: "input_image",
      image_url: signed.data.signedUrl,
      detail: "high",
    });
    evidenceFiles.push({
      client_file_id: clientFileId,
      file_name: String(reference.customer_file_name || file.file_name || "reference-image"),
      file_type: file.file_type,
      file_size: file.file_size,
      content_sha256: scan.content_sha256,
      scan_status: scan.status,
      quarantine_status: scan.quarantine_status,
      released_at: scan.released_at,
    });
  }

  const requestContext = {
    request_id: requestId,
    request_type: requestResult.data.request_type,
    product_name: requestResult.data.product_name,
    description: requestResult.data.description,
    desired_quantity: requestResult.data.desired_quantity,
    budget_range: requestResult.data.budget_range,
    needed_by_date: requestResult.data.needed_by_date,
    request_status: requestResult.data.status,
  };

  return {
    schema_version: "nxq-commerce-reference-build-context-v1",
    task: "enrich_commerce_request_from_references_v1",
    client_id: clientId,
    request_id: requestId,
    expires_in_seconds: expiresInSeconds,
    provider_invoked: false,
    multimodal_input: [{
      role: "user",
      content: [
        { type: "input_text", text: JSON.stringify(requestContext) },
        ...imageParts,
      ],
    }],
    evidence: {
      request_context: requestContext,
      reference_files: evidenceFiles,
      tenant_bound: true,
      clean_released_only: true,
      signed_urls_audited_but_not_persisted: true,
    },
  };
}
