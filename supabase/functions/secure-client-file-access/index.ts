import { createClient } from "npm:@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "POST required." }, 405);

  try {
    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const anonKey = requiredSecret("SUPABASE_ANON_KEY");
    const serviceRole = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization")?.trim() || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return response({ ok: false, error: "Authentication required." }, 401);
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const userResult = await caller.auth.getUser();
    const user = userResult.data.user;
    if (userResult.error || !user) return response({ ok: false, error: "Authentication required." }, 401);

    const payload = await req.json().catch(() => ({})) as { client_file_id?: unknown; download?: unknown };
    const clientFileId = typeof payload.client_file_id === "string" ? payload.client_file_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientFileId)) {
      return response({ ok: false, error: "A valid client file id is required." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const client = await admin
      .from("clients")
      .select("id,status")
      .eq("auth_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (client.error || !client.data?.id) return response({ ok: false, error: "Client account not found." }, 403);
    if (["denied", "archived", "dormant"].includes(String(client.data.status))) {
      return response({ ok: false, error: "Client file access is unavailable for this account state." }, 403);
    }

    const file = await admin
      .from("client_files")
      .select("id,client_id,bucket_id,storage_path,file_name,status,expires_at")
      .eq("id", clientFileId)
      .eq("client_id", client.data.id)
      .maybeSingle();
    if (file.error || !file.data) return response({ ok: false, error: "File not found." }, 404);
    if (String(file.data.status) === "deleted") return response({ ok: false, error: "File is unavailable." }, 410);
    if (file.data.expires_at && new Date(String(file.data.expires_at)).getTime() <= Date.now()) {
      return response({ ok: false, error: "File access has expired." }, 410);
    }

    const scan = await admin
      .from("client_file_security_scans")
      .select("status,quarantine_status,scanned_at,released_at")
      .eq("client_file_id", clientFileId)
      .eq("client_id", client.data.id)
      .maybeSingle();
    if (scan.error || !scan.data) {
      return response({ ok: false, error: "File security verification is not complete." }, 423);
    }
    if (scan.data.status !== "clean" || scan.data.quarantine_status !== "released" || !scan.data.released_at) {
      return response({ ok: false, error: "File remains restricted by NXQ file security." }, 423);
    }

    const bucket = String(file.data.bucket_id || "client-files").trim();
    const storagePath = String(file.data.storage_path || "").trim();
    if (!bucket || !storagePath || storagePath.includes("..") || storagePath.startsWith("/")) {
      return response({ ok: false, error: "Stored file reference is invalid." }, 500);
    }

    const options = payload.download === true ? { download: String(file.data.file_name || "download") } : undefined;
    const signed = await admin.storage.from(bucket).createSignedUrl(storagePath, 60, options);
    if (signed.error || !signed.data?.signedUrl) {
      return response({ ok: false, error: "Unable to create temporary file access." }, 500);
    }

    await admin.from("automation_audit_log").insert({
      client_id: client.data.id,
      event_type: "client_file_secure_access_issued",
      actor_type: "client",
      details: {
        client_file_id: clientFileId,
        download: payload.download === true,
        expires_in_seconds: 60,
        scan_status: scan.data.status,
        quarantine_status: scan.data.quarantine_status,
      },
    });

    return response({
      ok: true,
      signed_url: signed.data.signedUrl,
      expires_in_seconds: 60,
      file_name: file.data.file_name,
    });
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "Secure file access failed." }, 500);
  }
});
