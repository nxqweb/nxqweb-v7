import { createClient } from "npm:@supabase/supabase-js@2";

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
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function response(body: unknown, status: number, origin: string) {
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

Deno.serve(async (req) => {
  const origin = requestOrigin(req);
  if (req.method === "OPTIONS") return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405, origin);
  if (!origin) return response({ ok: false, error: "A valid HTTPS origin is required." }, 403, origin);

  const declaredSize = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MULTIPART_BYTES) {
    return response({ ok: false, error: "Reference image exceeds the upload limit." }, 413, origin);
  }

  let storagePath = "";
  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const form = await req.formData();
    const requestId = String(form.get("request_id") || "").trim();
    const uploadTicket = String(form.get("upload_ticket") || "").trim();
    const fileValue = form.get("file");

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return response({ ok: false, error: "Request reference is invalid." }, 400, origin);
    }
    if (!/^[0-9a-f]{64}$/i.test(uploadTicket)) {
      return response({ ok: false, error: "Upload authorization is invalid or expired." }, 403, origin);
    }
    if (!(fileValue instanceof File)) {
      return response({ ok: false, error: "A reference image is required." }, 400, origin);
    }

    const fileName = safeCustomerFileName(fileValue.name);
    const fileType = fileValue.type.toLowerCase();
    const extension = ALLOWED_TYPES.get(fileType);
    if (!extension) {
      return response({ ok: false, error: "Only JPEG, PNG, and WebP reference images are supported." }, 415, origin);
    }
    if (fileValue.size < 1) return response({ ok: false, error: "Reference image is empty." }, 400, origin);

    const authorization = await admin.rpc("resolve_commerce_request_reference_upload", {
      target_request_id: requestId,
      upload_ticket: uploadTicket,
    });
    if (authorization.error || !authorization.data) {
      return response({ ok: false, error: "Upload authorization is invalid or expired." }, 403, origin);
    }

    const allowed = authorization.data as UploadAuthorization;
    const clientId = String(allowed.client_id || "");
    const maxFileSize = Number(allowed.max_file_size_bytes || 0);
    if (!/^[0-9a-f-]{36}$/i.test(clientId) || !Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
      throw new Error("Upload authorization could not be resolved.");
    }
    if (fileValue.size > maxFileSize) {
      return response({ ok: false, error: `Reference image exceeds the storefront's ${Math.floor(maxFileSize / 1048576)} MB limit.` }, 413, origin);
    }

    storagePath = `${clientId}/commerce-requests/${requestId}/${crypto.randomUUID()}.${extension}`;
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
      storagePath = "";
      throw new Error("Reference image could not be registered for security scanning.");
    }

    storagePath = "";
    return response({
      ok: true,
      accepted: true,
      client_file_id: registered.data.client_file_id,
      quarantine_status: "restricted",
      message: "Reference image is private and remains unavailable until its security scan passes.",
    }, 201, origin);
  } catch (error) {
    if (storagePath) await admin.storage.from("client-files").remove([storagePath]);
    const message = error instanceof Error ? error.message : "Reference image upload failed.";
    return response({ ok: false, error: message }, 500, origin);
  }
});
