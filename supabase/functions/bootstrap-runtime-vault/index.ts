import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };
const requiredConfirmation = "CONFIGURE-NXQ-STAGING-RUNTIME";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const providerRequirements: Record<string, string[]> = {
  github: ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY"],
  netlify: ["NETLIFY_ACCESS_TOKEN", "NETLIFY_GITHUB_INSTALLATION_ID"],
  malware_scan: ["NXQ_MALWARE_SCAN_ADAPTER_URL", "NXQ_MALWARE_SCAN_ADAPTER_TOKEN"],
  notification_adapter: ["NXQ_NOTIFICATION_ADAPTER_URL", "NXQ_NOTIFICATION_ADAPTER_TOKEN"],
  provider_health_adapter: ["NXQ_PROVIDER_HEALTH_ADAPTER_URL", "NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN"],
  change_classifier_ai: [
    "NXQ_AI_MODEL_PROVIDER_URL",
    "NXQ_AI_MODEL_PROVIDER_TOKEN",
    "NXQ_AI_MODEL_PROVIDER_MODEL",
    "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
  ],
  business_build_plan_ai: [
    "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
    "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
    "NXQ_AI_MODEL_PROVIDER_URL",
    "NXQ_AI_MODEL_PROVIDER_TOKEN",
    "NXQ_AI_MODEL_PROVIDER_MODEL",
    "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
  ],
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ ok: false, error: "POST required." }, 405);

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const anonKey = requiredSecret("SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const workerToken = requiredSecret("NXQ_AUTOMATION_WORKER_TOKEN");
  const runtimeEnvironment = requiredSecret("NXQ_RUNTIME_ENVIRONMENT").toLowerCase();
  if (runtimeEnvironment !== "staging") {
    return response({ ok: false, error: "Runtime Vault bootstrap is locked to an NXQ staging project." }, 409);
  }
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization) return response({ ok: false, error: "Owner authentication is required." }, 401);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const user = await caller.auth.getUser(accessToken);
  if (user.error || !user.data.user) return response({ ok: false, error: "Owner authentication is invalid." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const owner = await admin.from("owner_users").select("id").eq("auth_user_id", user.data.user.id).maybeSingle();
  if (owner.error || !owner.data?.id) return response({ ok: false, error: "Owner access is required." }, 403);

  let payload: Record<string, unknown>;
  try { payload = asRecord(await request.json()); } catch { return response({ ok: false, error: "A JSON confirmation body is required." }, 400); }
  if (payload.confirmation !== requiredConfirmation) {
    return response({ ok: false, error: `Exact confirmation ${requiredConfirmation} is required.` }, 400);
  }

  const configuredProviderKeys: string[] = [];
  const missingProviderSecrets: Record<string, string[]> = {};
  for (const [providerKey, names] of Object.entries(providerRequirements)) {
    const missing = names.filter((name) => !Deno.env.get(name)?.trim());
    if (missing.length) missingProviderSecrets[providerKey] = missing;
    else configuredProviderKeys.push(providerKey);
  }

  const functionBaseUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;
  const bootstrapped = await admin.rpc("bootstrap_nxq_runtime_vault", {
    target_function_base_url: functionBaseUrl,
    target_worker_token: workerToken,
    target_configured_provider_keys: configuredProviderKeys,
  });
  if (bootstrapped.error) return response({ ok: false, error: bootstrapped.error.message }, 500);

  const authoritativeIdentity = await admin.rpc("set_nxq_authoritative_function_base_url", {
    target_function_base_url: functionBaseUrl,
  });
  if (authoritativeIdentity.error) {
    return response({ ok: false, error: `Runtime route identity failed: ${authoritativeIdentity.error.message}` }, 500);
  }

  const routeStatus = await admin.rpc("nxq_runtime_route_identity_status");
  if (routeStatus.error) return response({ ok: false, error: `Runtime route verification failed: ${routeStatus.error.message}` }, 500);
  if (asRecord(routeStatus.data).ok !== true) {
    return response({ ok: false, error: "Runtime route verification did not converge to the current project identity." }, 500);
  }

  return response({
    ok: true,
    configured_secret_names: asRecord(bootstrapped.data).configured_secret_names || [],
    configured_provider_keys: configuredProviderKeys,
    missing_provider_secret_names: missingProviderSecrets,
    route_identity_verified: true,
    route_identity: routeStatus.data,
    secret_values_returned: false,
    runtime_environment: runtimeEnvironment,
    production_changed: false,
  });
});
