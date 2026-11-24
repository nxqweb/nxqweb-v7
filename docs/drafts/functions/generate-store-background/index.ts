// generate-store-background: the automatic store-background maker. Called by the scheduler with the worker token (same as the other worker functions).
// ONE request per run. Switched OFF by default: with no picture-service settings it takes nothing and changes nothing. A picture it makes ends "waiting for the owner's approval".
// Draft, NOT in supabase/functions yet: see docs/BACKGROUND_GENERATION_PLAN.md ("Adopting the function") for the exact steps, all gated.
import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/constant-time-equal.ts";
import { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";
import { processNextRequest, type Deps, type Taken } from "./core.ts";
import { buildImageRequest, readImageResponse, readProviderConfig, MAX_IMAGE_BYTES } from "./provider.ts";

const headers = { "Content-Type": "application/json" };
const BUCKET = "commerce-website-content";
const PROVIDER_TIMEOUT_MS = 90_000;

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method !== "POST") return respond({ ok: false, error: "Method not allowed." }, 405);
  if (!(await constantTimeEqual(req.headers.get("x-nxq-worker-token") || "", secret("NXQ_AUTOMATION_WORKER_TOKEN")))) return respond({ ok: false, error: "Unauthorized." }, 401);

  // Not configured means switched off: nothing is taken, nothing is changed, and only setting NAMES are reported.
  const configured = readProviderConfig((name) => Deno.env.get(name));
  if (!configured.ok) return respond({ ok: true, configured: false, processed: 0, missing: configured.missing });
  const config = configured.config;

  const supabaseUrl = secret("SUPABASE_URL");
  const admin = createClient(supabaseUrl, secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  await admin.rpc("nxq_background_expire_stuck", { older_than_minutes: 30 }); // a crashed earlier run must not block a store; errors here are not fatal

  const deps: Deps = {
    async takeNext() {
      const result = await admin.rpc("nxq_background_take_next");
      if (result.error) throw new Error("take failed");
      return (result.data ?? null) as Taken | null;
    },
    async generate(prompt) {
      const request = buildImageRequest(config, prompt);
      requirePublicHttpsUrl(request.url, "Picture service address");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      try {
        const res = await fetch(request.url, { ...request.init, signal: controller.signal });
        const text = await res.text();
        return readImageResponse(res.status, text);
      } catch {
        return { ok: false as const, reason: "The picture service could not be reached." };
      } finally { clearTimeout(timer); }
    },
    async upload(path, bytes, mime) {
      if (bytes.length > MAX_IMAGE_BYTES) return null;
      const stored = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (stored.error) return null;
      const url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      return typeof url === "string" && url.startsWith(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/`) ? url : null;
    },
    async remove(path) { await admin.storage.from(BUCKET).remove([path]); },
    async finish(requestId, success, imageUrl, overlay) {
      const result = await admin.rpc("nxq_background_finish", { request_uuid: requestId, success, image_url_value: imageUrl, overlay_value: overlay });
      return !result.error;
    },
    randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, "0")).join(""); },
  };

  const result = await processNextRequest(deps);
  return respond({ ok: result.ok, configured: true, processed: result.processed ? 1 : 0, status: result.status ?? null, request_id: result.request_id ?? null, reason: result.reason ?? null }, result.ok ? 200 : 500);
});
