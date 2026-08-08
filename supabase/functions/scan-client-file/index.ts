import { createClient } from "npm:@supabase/supabase-js@2";

type ScanRow = {
  id: string;
  client_file_id: string;
  client_id: string;
};

type ClientFile = {
  id: string;
  client_id: string;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: string;
};

type AdapterResult = {
  status?: string;
  provider_reference?: string;
  findings?: Record<string, unknown>;
};

const headers = { "Content-Type": "application/json" };
const workerName = "scan-client-file";

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeClaim(value: unknown): ScanRow | null {
  if (value == null) return null;
  let normalized = value;
  if (typeof normalized === "string") normalized = JSON.parse(normalized);
  if (Array.isArray(normalized)) normalized = normalized[0] ?? null;
  if (!normalized || typeof normalized !== "object") throw new Error("File scan claim returned an invalid shape.");
  const scan = normalized as ScanRow;
  if (!scan.id || !scan.client_file_id || !scan.client_id) throw new Error("File scan claim is missing required identifiers.");
  return scan;
}

function normalizeAdapterResult(value: unknown): AdapterResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AdapterResult;
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function scanWithAdapter(file: ClientFile, bytes: ArrayBuffer, checksum: string) {
  const endpoint = Deno.env.get("NXQ_MALWARE_SCAN_ADAPTER_URL")?.trim();
  const token = Deno.env.get("NXQ_MALWARE_SCAN_ADAPTER_TOKEN")?.trim();
  if (!endpoint || !token) throw new Error("Malware scanner adapter is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: file.file_type || "application/octet-stream" }), file.file_name);
    form.set("sha256", checksum);
    form.set("client_file_id", file.id);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: AdapterResult = {};
    try {
      parsed = text ? normalizeAdapterResult(JSON.parse(text) as unknown) : {};
    } catch {
      parsed = { findings: { message: text.slice(0, 500) } };
    }

    if (!res.ok) throw new Error(`Malware scanner adapter failed (${res.status}).`);
    if (!["clean", "suspicious", "infected"].includes(String(parsed.status || ""))) {
      throw new Error("Malware scanner adapter returned an unsupported result.");
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  if (req.headers.get("x-nxq-worker-token") !== secret("NXQ_AUTOMATION_WORKER_TOKEN")) {
    return response({ ok: false, error: "Unauthorized." }, 401);
  }

  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const claim = await admin.rpc("claim_next_client_file_security_scan", { worker_name: workerName });
  if (claim.error) return response({ ok: false, error: claim.error.message }, 500);

  let scan: ScanRow | null;
  try {
    scan = normalizeClaim(claim.data);
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "Invalid file scan claim." }, 500);
  }
  if (!scan) return response({ ok: true, message: "No client files are ready for security scanning." });

  try {
    const fileResult = await admin
      .from("client_files")
      .select("id,client_id,bucket_id,storage_path,file_name,file_type,file_size,status")
      .eq("id", scan.client_file_id)
      .eq("client_id", scan.client_id)
      .single();
    if (fileResult.error || !fileResult.data) throw new Error(fileResult.error?.message || "Client file record not found.");

    const file = fileResult.data as ClientFile;
    if (file.status === "deleted") throw new Error("Deleted client files are not scannable.");

    const maxBytes = Number(Deno.env.get("NXQ_FILE_SCAN_MAX_BYTES") || 25 * 1024 * 1024);
    if (file.file_size != null && file.file_size > maxBytes) {
      throw new Error(`File exceeds the configured scan limit of ${maxBytes} bytes.`);
    }

    const download = await admin.storage.from(file.bucket_id || "client-files").download(file.storage_path);
    if (download.error || !download.data) throw new Error(download.error?.message || "Private file could not be downloaded for scanning.");

    const bytes = await download.data.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw new Error(`Downloaded file exceeds the configured scan limit of ${maxBytes} bytes.`);

    const checksum = await sha256Hex(bytes);
    const result = await scanWithAdapter(file, bytes, checksum);

    const completed = await admin.rpc("complete_client_file_security_scan", {
      target_scan_id: scan.id,
      target_status: result.status,
      target_provider_key: Deno.env.get("NXQ_MALWARE_SCAN_PROVIDER_KEY")?.trim() || "malware-scan-adapter",
      target_provider_reference: result.provider_reference || null,
      target_content_sha256: checksum,
      target_findings: result.findings || {},
    });
    if (completed.error) throw new Error(completed.error.message);

    return response({
      ok: true,
      scan_id: scan.id,
      client_file_id: file.id,
      status: result.status,
      quarantine_status: result.status === "clean" ? "released" : "quarantined",
      sha256: checksum,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Client file scan failed.";
    const failed = await admin.rpc("fail_client_file_security_scan", {
      target_scan_id: scan.id,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist file scan failure", failed.error.message);
    return response({ ok: false, error: message, scan_id: scan.id }, 500);
  }
});
