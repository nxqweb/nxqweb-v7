// The ONLY file that knows how one picture provider is called. Everything about the provider's request and reply is here, so changing provider means changing this file.
// IMPORTANT (2026-11-24): the request and reply shapes below come from general knowledge of the provider's public image API and were NOT checked against its current documentation
// (the docs site was unreachable from the build session). The model name and image size are therefore REQUIRED settings, never hard-coded, and every unexpected reply FAILS CLOSED.
// BEFORE this is switched on: the owner or Claude must read the provider's current docs, confirm the endpoint, the request fields and the reply shape, and run one live test.
// Safety rules kept here: a fixed host allowlist, HTTPS only, no redirects, a size cap, the picture type decided by its own first bytes (never by what the provider says),
// and no provider text or key ever returned to a caller.

export const IMAGE_PROVIDER_HOSTS = ["api.openai.com"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 4000;

export type ProviderConfig = { apiKey: string; model: string; size: string; host: string };
export type ConfigResult = { ok: true; config: ProviderConfig } | { ok: false; missing: string[] };

// Reads the settings by NAME from whatever lookup it is given (Deno.env in the function, a plain object in tests). Reports names only, never values.
export function readProviderConfig(get: (name: string) => string | undefined): ConfigResult {
  const key = (get("NXQ_IMAGE_PROVIDER_API_KEY") ?? "").trim();
  const model = (get("NXQ_IMAGE_MODEL") ?? "").trim();
  const size = (get("NXQ_IMAGE_SIZE") ?? "").trim();
  const host = ((get("NXQ_IMAGE_PROVIDER_HOST") ?? "").trim() || IMAGE_PROVIDER_HOSTS[0]).toLowerCase(); // empty means "not set": the one allowed host
  const missing: string[] = [];
  if (key.length < 20 || /\s/.test(key)) missing.push("NXQ_IMAGE_PROVIDER_API_KEY");
  if (!/^[a-z0-9][a-z0-9._-]{0,60}$/i.test(model)) missing.push("NXQ_IMAGE_MODEL");
  const dims = /^(\d{3,4})x(\d{3,4})$/.exec(size);
  if (!dims || Number(dims[1]) > 4096 || Number(dims[2]) > 4096 || Number(dims[1]) < 256 || Number(dims[2]) < 256) missing.push("NXQ_IMAGE_SIZE");
  if (!(IMAGE_PROVIDER_HOSTS as readonly string[]).includes(host)) missing.push("NXQ_IMAGE_PROVIDER_HOST");
  return missing.length ? { ok: false, missing } : { ok: true, config: { apiKey: key, model, size, host } };
}

export type ImageRequest = { url: string; init: { method: "POST"; redirect: "error"; headers: Record<string, string>; body: string } };

export function buildImageRequest(config: ProviderConfig, prompt: string): ImageRequest {
  if (typeof prompt !== "string" || prompt.trim().length < 20 || prompt.length > MAX_PROMPT_CHARS) throw new Error("The picture request text is not valid.");
  return {
    url: `https://${config.host}/v1/images/generations`,
    init: { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: config.model, prompt, size: config.size, n: 1 }) },
  };
}

export type SniffedType = { mime: "image/png" | "image/jpeg" | "image/webp"; ext: "png" | "jpg" | "webp" };
export function sniffImage(bytes: Uint8Array): SniffedType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  return null;
}

function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  if (Math.floor((clean.length * 3) / 4) > MAX_IMAGE_BYTES + 4) return null;
  try { const binary = atob(clean); const out = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i); return out; } catch { return null; }
}

export type ImageResult = { ok: true; bytes: Uint8Array; type: SniffedType } | { ok: false; reason: string };

// The provider's reply, read strictly. Only a 2xx with one base64 picture of a normal type and size counts. The reason is ours, never the provider's words.
export function readImageResponse(status: number, bodyText: string): ImageResult {
  if (!Number.isInteger(status) || status < 200 || status > 299) return { ok: false, reason: status === 429 ? "The picture service is busy." : status >= 500 ? "The picture service had a problem." : "The picture request was not accepted." };
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return { ok: false, reason: "The picture service reply could not be read." }; }
  const data = parsed && typeof parsed === "object" ? (parsed as { data?: unknown }).data : null;
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") return { ok: false, reason: "The picture service reply was not what we expected." };
  const b64 = (data[0] as { b64_json?: unknown }).b64_json;
  if (typeof b64 !== "string") return { ok: false, reason: "The picture service reply had no picture." };
  const bytes = decodeBase64(b64);
  if (!bytes || bytes.length < 100 || bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "The picture was empty or too large." };
  const type = sniffImage(bytes);
  if (!type) return { ok: false, reason: "The picture was not a PNG, JPEG or WEBP." };
  return { ok: true, bytes, type };
}
