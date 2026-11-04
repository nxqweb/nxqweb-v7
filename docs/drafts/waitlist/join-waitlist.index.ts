// Public sign-up for the pre-launch waiting list. DRAFT (docs/drafts/waitlist/); the final home is supabase/functions/join-waitlist/index.ts.
// NOT deployed. It stays dead even after a deploy: handleWaitlist (supabase/functions/_shared/waitlist-input.mjs) answers 404 to everyone until the owner sets the
// switch NXQ_WAITLIST_ENABLED=true and lists the site's address in NXQ_WAITLIST_ALLOWED_ORIGINS. It needs migration 03 (nxq_waitlist_join) and the existing
// NXQ_LEAD_FINGERPRINT_SALT secret. This file only adapts a web request to the handler and holds no rules of its own, so the rules can be tested without Deno.
import { createClient } from "npm:@supabase/supabase-js@2";
import { WAITLIST_LIMITS, handleWaitlist } from "../_shared/waitlist-input.mjs";

function requestOrigin(req: Request) {
  const origin = (req.headers.get("origin") || "").trim();
  return /^https:\/\/[^\s/$.?#].*$/i.test(origin) ? origin : "";
}
function cors(origin: string) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin || "https://invalid.nxq.local",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Reads the body but stops as soon as it is over the limit (a chunked request has no Content-Length to trust). Returns null when too large.
async function readBodyLimited(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

// The database client is made only when a database call is actually needed, so a switched-off or rejected request never touches a secret.
function makeAdmin() {
  return createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}
let adminClient: ReturnType<typeof makeAdmin> | null = null;
function admin() {
  adminClient ??= makeAdmin();
  return adminClient;
}

Deno.serve(async (req) => {
  const origin = requestOrigin(req);
  const result = await handleWaitlist(
    {
      method: req.method,
      origin,
      ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim(),
      agent: req.headers.get("user-agent") || "unknown",
      readBody: () => readBodyLimited(req, WAITLIST_LIMITS.maxRequestBytes),
    },
    {
      env: (name: string) => Deno.env.get(name)?.trim() || undefined,
      sha256,
      reserve: async ({ scope, operation, identity, limit }: { scope: string; operation: string; identity: string; limit: number }) => {
        const reserved = await admin().rpc("nxq_reserve_ingress_capacity", {
          target_scope_key: scope, target_operation_key: operation, target_identity_hash: identity, target_units: 1, target_limit_units: limit, target_window_seconds: WAITLIST_LIMITS.windowSeconds,
        });
        if (reserved.error) throw new Error(`Waitlist quota failed: ${reserved.error.message}`);
        return { allowed: (reserved.data as { allowed?: boolean } | null)?.allowed === true };
      },
      join: async ({ email, source, consentVersion }: { email: string; source: string; consentVersion: string }) => {
        const joined = await admin().rpc("nxq_waitlist_join", { target_email: email, target_source: source, target_consent_version: consentVersion });
        if (joined.error) throw new Error(`Waitlist join failed: ${joined.error.message}`);
      },
    },
  );
  return new Response(result.body === null ? null : JSON.stringify(result.body), { status: result.status, headers: cors(origin) });
});
