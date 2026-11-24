// The job of the picture maker, with every outside thing handed in (so it is fully testable with fakes). One request per run.
// Order: take the oldest waiting request, build the prompt, ask the provider, check the picture, save it in the store's own branding folder, report back.
// Whatever goes wrong AFTER a request is taken is reported as a failed try (so the store is never left stuck), and nothing is ever returned that came from the provider.
import { buildBackgroundPrompt } from "./prompt.ts";
import type { ImageResult } from "./provider.ts";

export const DEFAULT_OVERLAY = 0.2; // a calm veil; the owner sees the picture before it goes live
const MOOD_WORDS: Record<string, string> = { calm: "calm and soft", warm: "warm and cozy", fresh: "fresh and light", elegant: "elegant and refined", playful: "playful and bright" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Taken = { request_id?: unknown; client_id?: unknown; store_name?: unknown; mood?: unknown; what_they_sell?: unknown; colors?: { bg?: unknown; tint?: unknown; accent?: unknown } | null };
export type Deps = {
  takeNext(): Promise<Taken | null>;
  generate(prompt: string): Promise<ImageResult>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<string | null>; // returns the public address, or null
  remove(path: string): Promise<void>;
  finish(requestId: string, success: boolean, imageUrl: string | null, overlay: number | null): Promise<boolean>;
  randomToken(): string; // 16 lowercase hex characters
};
export type RunResult = { ok: boolean; processed: boolean; status?: "pending_approval" | "failed"; request_id?: string; reason?: string };

export async function processNextRequest(deps: Deps): Promise<RunResult> {
  let taken: Taken | null;
  try { taken = await deps.takeNext(); } catch { return { ok: false, processed: false, reason: "Could not read the waiting list." }; }
  if (!taken || taken.request_id == null) return { ok: true, processed: false };
  const requestId = typeof taken.request_id === "string" && uuid.test(taken.request_id) ? taken.request_id : null;
  const clientId = typeof taken.client_id === "string" && uuid.test(taken.client_id) ? taken.client_id : null;
  if (!requestId) return { ok: false, processed: false, reason: "The waiting request was not valid." };
  const fail = async (reason: string): Promise<RunResult> => { try { await deps.finish(requestId, false, null, null); } catch { /* the stuck-job cleanup will catch it */ } return { ok: false, processed: true, status: "failed", request_id: requestId, reason }; };
  if (!clientId) return fail("The waiting request was not valid.");

  let uploadedPath: string | null = null;
  try {
    const mood = typeof taken.mood === "string" && MOOD_WORDS[taken.mood] ? MOOD_WORDS[taken.mood] : "calm and soft";
    const prompt = buildBackgroundPrompt({ businessType: taken.what_they_sell, mood, colors: { bg: taken.colors?.bg, tint: taken.colors?.tint, accent: taken.colors?.accent } });
    const image = await deps.generate(prompt);
    if (!image.ok) return await fail(image.reason);
    const token = deps.randomToken();
    if (!/^[a-f0-9]{16}$/.test(token)) return await fail("Could not prepare the picture name.");
    const path = `${clientId}/branding/background-${token}.${image.type.ext}`;
    const url = await deps.upload(path, image.bytes, image.type.mime);
    if (!url) return await fail("The picture could not be saved.");
    uploadedPath = path;
    const finished = await deps.finish(requestId, true, url, DEFAULT_OVERLAY);
    if (!finished) { await deps.remove(path).catch(() => undefined); return await fail("The result could not be recorded."); }
    return { ok: true, processed: true, status: "pending_approval", request_id: requestId };
  } catch {
    if (uploadedPath) await deps.remove(uploadedPath).catch(() => undefined);
    return await fail("The picture could not be made this time.");
  }
}
