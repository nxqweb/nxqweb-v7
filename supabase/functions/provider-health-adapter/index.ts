type JsonRecord = Record<string, unknown>;

type AdapterRequest = {
  provider_key: string;
  provider_category: string;
  scope_type: string;
  scope_id: string | null;
  adapter_version: string;
  capabilities: string[];
  required_secret_names: string[];
  config: JsonRecord;
};

type HealthStatus = "healthy" | "degraded" | "unauthorized" | "rate_limited" | "timeout" | "error" | "not_configured";

const responseHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function cleanText(value: unknown, maximum = 120) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanTextList(value: unknown, maximumItems = 24) {
  if (!Array.isArray(value) || value.length > maximumItems) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean);
}

function parseRequest(value: unknown): AdapterRequest {
  const body = record(value);
  const providerKey = cleanText(body.provider_key, 80);
  const providerCategory = cleanText(body.provider_category, 80);
  const scopeType = cleanText(body.scope_type, 40);
  const adapterVersion = cleanText(body.adapter_version, 40);

  if (!/^[a-z0-9_]{2,80}$/.test(providerKey)) throw new Error("Invalid provider_key.");
  if (!/^[a-z0-9_]{2,80}$/.test(providerCategory)) throw new Error("Invalid provider_category.");
  if (!/^[a-z0-9_]{2,40}$/.test(scopeType)) throw new Error("Invalid scope_type.");
  if (!/^[a-z0-9._-]{1,40}$/i.test(adapterVersion)) throw new Error("Invalid adapter_version.");

  return {
    provider_key: providerKey,
    provider_category: providerCategory,
    scope_type: scopeType,
    scope_id: typeof body.scope_id === "string" ? body.scope_id.trim().slice(0, 160) : null,
    adapter_version: adapterVersion,
    capabilities: cleanTextList(body.capabilities),
    required_secret_names: cleanTextList(body.required_secret_names),
    config: record(body.config),
  };
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
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function environmentSecret(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function providerStatus(httpStatus: number): HealthStatus {
  if (httpStatus === 401 || httpStatus === 403) return "unauthorized";
  if (httpStatus === 429) return "rate_limited";
  return "error";
}

async function readOnlyProviderCheck(
  providerKey: string,
  url: string,
  token: string,
  headers: Record<string, string>,
) {
  if (!token) {
    return {
      status: "not_configured" as HealthStatus,
      summary: providerKey + " verification token is not configured.",
      details: {
        provider_key: providerKey,
        read_only: true,
        secret_values_returned: false,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const started = Date.now();

  try {
    const providerResponse = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;

    if (!providerResponse.ok) {
      return {
        status: providerStatus(providerResponse.status),
        latency_ms: latencyMs,
        http_status: providerResponse.status,
        summary: providerKey + " verification returned HTTP " + providerResponse.status + ".",
        details: {
          provider_key: providerKey,
          read_only: true,
          secret_values_returned: false,
        },
      };
    }

    // Provider response bodies are intentionally not read, stored, or returned.
    return {
      status: "healthy" as HealthStatus,
      latency_ms: latencyMs,
      http_status: providerResponse.status,
      summary: providerKey + " read-only verification passed.",
      details: {
        provider_key: providerKey,
        read_only: true,
        secret_values_returned: false,
        checked_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      status: timedOut ? "timeout" as HealthStatus : "error" as HealthStatus,
      latency_ms: Date.now() - started,
      summary: timedOut ? providerKey + " verification timed out." : providerKey + " verification failed.",
      details: {
        provider_key: providerKey,
        read_only: true,
        secret_values_returned: false,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkProvider(request: AdapterRequest) {
  if (request.provider_key === "github") {
    const owner = environmentSecret("NXQ_AUTOMATION_SOURCE_OWNER");
    const repository = environmentSecret("NXQ_AUTOMATION_SOURCE_REPO");
    const token = environmentSecret("NXQ_GITHUB_VERIFY_TOKEN");
    if (!owner || !repository) {
      return {
        status: "not_configured" as HealthStatus,
        summary: "GitHub verification scope is not configured.",
        details: { provider_key: "github", read_only: true, secret_values_returned: false },
      };
    }

    return await readOnlyProviderCheck(
      "github",
      "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repository),
      token,
      {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NXQ-Web-Provider-Health",
      },
    );
  }

  if (request.provider_key === "netlify") {
    const token = environmentSecret("NXQ_NETLIFY_VERIFY_TOKEN");
    return await readOnlyProviderCheck(
      "netlify",
      "https://api.netlify.com/api/v1/user",
      token,
      {
        Authorization: "Bearer " + token,
        "User-Agent": "NXQ-Web-Provider-Health",
      },
    );
  }

  if (request.provider_key === "provider_health_adapter") {
    return {
      status: "healthy" as HealthStatus,
      latency_ms: 0,
      http_status: 200,
      summary: "Provider-health adapter authentication passed.",
      details: {
        provider_key: "provider_health_adapter",
        read_only: true,
        secret_values_returned: false,
        checked_at: new Date().toISOString(),
      },
    };
  }

  return {
    status: "not_configured" as HealthStatus,
    summary: "No read-only health check is configured for provider " + request.provider_key + ".",
    details: {
      provider_key: request.provider_key,
      read_only: true,
      secret_values_returned: false,
    },
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return response({ ok: false, error: "Method not allowed." }, 405);
  }

  const configuredToken = environmentSecret("NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN");
  if (!configuredToken) {
    return response({ ok: false, error: "Provider-health adapter token is not configured." }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  const presentedToken = authorization.replace(/^Bearer\s+/i, "");
  if (!authorization.startsWith("Bearer ") || !(await constantTimeEqual(presentedToken, configuredToken))) {
    return response({ ok: false, error: "Unauthorized." }, 401);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return response({ ok: false, error: "Request body is too large." }, 413);
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > 16_384) return response({ ok: false, error: "Request body is too large." }, 413);
    const parsed = parseRequest(JSON.parse(rawBody) as unknown);
    const result = await checkProvider(parsed);
    return response({
      ...result,
      adapter_version: "nxq-provider-health-v1",
      runtime_environment: cleanText(environmentSecret("NXQ_RUNTIME_ENVIRONMENT"), 40) || "unknown",
      required_secret_names_received: parsed.required_secret_names.length,
      secret_values_received: false,
      secret_values_returned: false,
    });
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof SyntaxError ? "Invalid JSON body." : error instanceof Error ? error.message : "Invalid request.",
      secret_values_returned: false,
    }, 400);
  }
});
