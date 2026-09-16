import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CommerceReferenceContextError,
  createCommerceReferenceBuildContext,
} from "../_shared/commerce-reference-build-context.ts";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ ok: false, error: "POST required." }, 405);

  try {
    const configuredToken = requiredSecret("NXQ_AUTOMATION_WORKER_TOKEN");
    const suppliedToken = request.headers.get("x-nxq-worker-token")?.trim() || "";
    if (!suppliedToken || !await constantTimeEqual(suppliedToken, configuredToken)) {
      return response({ ok: false, error: "Trusted automation access required." }, 403);
    }

    const payload = await request.json().catch(() => ({})) as { request_id?: unknown; client_id?: unknown };
    const requestId = typeof payload.request_id === "string" ? payload.request_id.trim() : "";
    const expectedClientId = typeof payload.client_id === "string" ? payload.client_id.trim() : "";
    const admin = createClient(requiredSecret("SUPABASE_URL"), requiredSecret("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const context = await createCommerceReferenceBuildContext(admin, requestId, {
      expiresInSeconds: 60,
      expectedClientId: expectedClientId || undefined,
    });
    const evidence = context.evidence as { reference_files: Array<{ client_file_id: string }> };
    await admin.from("automation_audit_log").insert({
      client_id: context.client_id,
      event_type: "commerce_reference_build_context_issued",
      actor_type: "backend",
      details: {
        request_id: context.request_id,
        schema_version: context.schema_version,
        task: context.task,
        client_file_ids: evidence.reference_files.map((file) => file.client_file_id),
        reference_count: evidence.reference_files.length,
        expires_in_seconds: context.expires_in_seconds,
        tenant_bound: true,
        clean_released_only: true,
        provider_invoked: false,
        signed_urls_persisted: false,
      },
    });

    return response({ ok: true, ...context });
  } catch (error) {
    const status = error instanceof CommerceReferenceContextError ? error.status : 500;
    return response({
      ok: false,
      error: error instanceof Error ? error.message : "Commerce reference build context could not be prepared.",
      provider_invoked: false,
    }, status);
  }
});
