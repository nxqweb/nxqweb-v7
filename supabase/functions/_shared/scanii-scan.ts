// Scanii (https://scanii.com) file-scan helpers for the malware adapter. Pure functions only: no
// network, no environment reads, no secrets stored. The adapter does the fetch and passes the bytes in.
// API shape from Scanii's v2.2 documentation: POST {base}/v2.2/files with HTTP Basic auth (key:secret) and a
// multipart `file` field; a 201 JSON answer has `id`, `content_length` and a `findings` array (empty = nothing found).
// Every doubtful answer is treated as FAILURE, never as clean.

export const SCANII_BASE_URLS: Readonly<Record<string, string>> = Object.freeze({
  us1: "https://api-us1.scanii.com",
  eu1: "https://api-eu1.scanii.com",
  eu2: "https://api-eu2.scanii.com",
  ap1: "https://api-ap1.scanii.com",
  ap2: "https://api-ap2.scanii.com",
  ca1: "https://api-ca1.scanii.com",
});

// Only the fixed regional hosts above can ever be called. An unknown region is rejected, not guessed.
export function scaniiBaseUrl(region: string | undefined | null): string | null {
  const key = (region || "us1").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCANII_BASE_URLS, key) ? SCANII_BASE_URLS[key] : null;
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function scaniiAuthorization(apiKey: string, apiSecret: string): string {
  return `Basic ${base64(`${apiKey}:${apiSecret}`)}`;
}

export type ScaniiRequestInput = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  bytes: ArrayBuffer;
  contentType: string;
  clientFileId: string;
};

// The upload filename is a neutral placeholder: the client's real file name is never sent to the provider.
export function buildScaniiRequest(input: ScaniiRequestInput): { url: string; init: RequestInit } {
  const form = new FormData();
  form.set("file", new Blob([input.bytes], { type: input.contentType || "application/octet-stream" }), "upload.bin");
  form.set("metadata[client_file_id]", input.clientFileId);
  return {
    url: `${input.baseUrl}/v2.2/files`,
    init: { method: "POST", redirect: "error", headers: { Authorization: scaniiAuthorization(input.apiKey, input.apiSecret) }, body: form },
  };
}

export type ScaniiVerdict =
  | { ok: true; clean: boolean; findings: string[]; providerId: string }
  | { ok: false; httpStatus: 429 | 502; reason: string };

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function interpretScaniiResponse(status: number, bodyText: string, expectedBytes: number): ScaniiVerdict {
  if (status === 429) return { ok: false, httpStatus: 429, reason: "Malware provider rate limit reached." };
  if (status !== 201) return { ok: false, httpStatus: 502, reason: `Malware provider returned HTTP ${status}.` };
  if (bodyText.length > 64_000) return { ok: false, httpStatus: 502, reason: "Malware provider response exceeded the safety limit." };
  let body: unknown;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { return { ok: false, httpStatus: 502, reason: "Malware provider returned invalid JSON." }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, httpStatus: 502, reason: "Malware provider returned no result." };
  const record = body as Record<string, unknown>;
  const providerId = cleanText(record.id, 80);
  if (!providerId) return { ok: false, httpStatus: 502, reason: "Malware provider returned no result id." };
  if (!Array.isArray(record.findings)) return { ok: false, httpStatus: 502, reason: "Malware provider returned no findings evidence." };
  // Integrity check: the provider must report that it processed exactly the bytes we sent.
  if (record.content_length !== expectedBytes) return { ok: false, httpStatus: 502, reason: "Malware provider processed a different size than was sent." };
  const findings = record.findings.slice(0, 20).map((value) => cleanText(value, 240)).filter(Boolean);
  // A findings entry that is not a non-empty string is malformed evidence: do not call that clean.
  if (record.findings.length > 0 && findings.length === 0) return { ok: false, httpStatus: 502, reason: "Malware provider returned unreadable findings." };
  return { ok: true, clean: record.findings.length === 0, findings, providerId };
}
