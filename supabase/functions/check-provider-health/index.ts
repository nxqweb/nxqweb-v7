import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePublicHttpsUrl } from "../_shared/outbound-security.ts";

type ProviderConnection = {
  id: string;
  provider_key: string;
  provider_category: string;
  scope_type: string;
  scope_id: string | null;
  status: string;
  adapter_version: string;
  capabilities: string[] | null;
  required_secret_names: string[] | null;
  config: Record<string, unknown> | null;
};

type AdapterResult = {
  status?: string;
  latency_ms?: number;
  http_status?: number;
  summary?: string;
  details?: Record<string, unknown>;
};

const headers = { "Content-Type": "application/json" };

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeAdapterResult(value: unknown): AdapterResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AdapterResult;
}

async function checkThroughAdapter(connection: ProviderConnection) {
  const endpoint = Deno.env.get("NXQ_PROVIDER_HEALTH_ADAPTER_URL")?.trim();
  const token = Deno.env.get("NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN")?.trim();
  if (!endpoint || !token) return { configured: false as const };
  const safeEndpoint = requirePublicHttpsUrl(endpoint, "Provider-health adapter URL");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const started = Date.now();
  try {
    const res = await fetch(safeEndpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        provider_key: connection.provider_key,
        provider_category: connection.provider_category,
        scope_type: connection.scope_type,
        scope_id: connection.scope_id,
        adapter_version: connection.adapter_version,
        capabilities: connection.capabilities || [],
        required_secret_names: connection.required_secret_names || [],
        config: connection.config || {},
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: AdapterResult = {};
    try {
      parsed = text ? normalizeAdapterResult(JSON.parse(text) as unknown) : {};
    } catch {
      parsed = { summary: text };
    }

    if (!res.ok) {
      return {
        configured: true as const,
        result: {
          status: res.status === 401 || res.status === 403 ? "unauthorized" : res.status === 429 ? "rate_limited" : "error",
          latency_ms: Date.now() - started,
          http_status: res.status,
          summary: parsed.summary || `Provider adapter returned HTTP ${res.status}.`,
          details: parsed.details || {},
        } satisfies AdapterResult,
      };
    }

    return {
      configured: true as const,
      result: {
        status: parsed.status || "healthy",
        latency_ms: parsed.latency_ms ?? Date.now() - started,
        http_status: parsed.http_status ?? res.status,
        summary: parsed.summary || "Provider health check passed.",
        details: parsed.details || {},
      } satisfies AdapterResult,
    };
  } catch (error) {
    return {
      configured: true as const,
      result: {
        status: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "error",
        latency_ms: Date.now() - started,
        summary: error instanceof Error ? error.message : "Provider health check failed.",
        details: {},
      } satisfies AdapterResult,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function connectionStatusFromHealth(status: string) {
  if (status === "healthy" || status === "recovered") return "healthy";
  if (status === "degraded" || status === "rate_limited" || status === "timeout") return "degraded";
  if (status === "unauthorized" || status === "error") return "error";
  return "degraded";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  if (req.headers.get("x-nxq-worker-token") !== secret("NXQ_AUTOMATION_WORKER_TOKEN")) {
    return response({ ok: false, error: "Unauthorized." }, 401);
  }

  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const adapterConfigured = Boolean(
    Deno.env.get("NXQ_PROVIDER_HEALTH_ADAPTER_URL")?.trim() && Deno.env.get("NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN")?.trim(),
  );

  await admin.rpc("record_worker_heartbeat", {
    target_worker_key: "check-provider-health",
    target_execution_target: "provider",
    target_status: adapterConfigured ? "healthy" : "degraded",
    target_metadata: { adapter_configured: adapterConfigured },
    target_last_error: adapterConfigured ? null : "Provider-health adapter is not configured.",
  });

  if (!adapterConfigured) {
    return response({
      ok: false,
      configured: false,
      reason: "provider_health_adapter_missing",
      provider_statuses_changed: 0,
    });
  }

  try {
    const due = await admin
      .from("nxq_provider_connections")
      .select("id,provider_key,provider_category,scope_type,scope_id,status,adapter_version,capabilities,required_secret_names,config")
      .in("status", ["configured", "healthy", "degraded", "error"])
      .or(`last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(25);

    if (due.error) throw new Error(`Provider queue read failed: ${due.error.message}`);

    let checked = 0;
    let healthy = 0;
    let degraded = 0;
    let errors = 0;
    let activityEvidence = 0;

    for (const raw of due.data || []) {
      const connection = raw as ProviderConnection;
      if (connection.config?.health_check_mode === "activity_evidence") {
        activityEvidence += 1;
        continue;
      }
      const check = await checkThroughAdapter(connection);
      if (!check.configured) continue;

      const result = check.result;
      const healthStatus = String(result.status || "error");
      const nextConnectionStatus = connectionStatusFromHealth(healthStatus);
      const now = new Date().toISOString();

      const eventInsert = await admin.from("nxq_provider_health_events").insert({
        provider_connection_id: connection.id,
        status: healthStatus,
        latency_ms: result.latency_ms ?? null,
        http_status: result.http_status ?? null,
        summary: result.summary || null,
        details: result.details || {},
      });
      if (eventInsert.error) throw new Error(`Provider health event write failed: ${eventInsert.error.message}`);

      const update = await admin
        .from("nxq_provider_connections")
        .update({
          status: nextConnectionStatus,
          last_checked_at: now,
          last_success_at: nextConnectionStatus === "healthy" ? now : undefined,
          last_error: nextConnectionStatus === "healthy" ? null : result.summary || `Provider health is ${healthStatus}.`,
          updated_at: now,
        })
        .eq("id", connection.id);
      if (update.error) throw new Error(`Provider health state update failed: ${update.error.message}`);

      checked += 1;
      if (nextConnectionStatus === "healthy") healthy += 1;
      else if (nextConnectionStatus === "degraded") degraded += 1;
      else errors += 1;
    }

    await admin.rpc("record_worker_heartbeat", {
      target_worker_key: "check-provider-health",
      target_execution_target: "provider",
      target_status: "healthy",
      target_metadata: {
        adapter_configured: true,
        checked,
        healthy,
        degraded,
        errors,
        activity_evidence_connections_skipped: activityEvidence,
      },
      target_last_error: null,
    });

    const readiness = await admin.rpc("evaluate_launch_readiness");

    return response({
      ok: true,
      checked,
      healthy,
      degraded,
      errors,
      activity_evidence_connections_skipped: activityEvidence,
      launch_readiness_evaluated: !readiness.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider health worker failed.";
    await admin.rpc("record_worker_heartbeat", {
      target_worker_key: "check-provider-health",
      target_execution_target: "provider",
      target_status: "error",
      target_metadata: { adapter_configured: adapterConfigured },
      target_last_error: message,
    });
    return response({ ok: false, error: message }, 500);
  }
});
