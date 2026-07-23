import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const netlifyToken = Deno.env.get("NXQ_NETLIFY_VERIFY_TOKEN");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server credentials are unavailable." }, 500);
  }
  if (!netlifyToken) {
    return jsonResponse({ error: "Netlify verification credential is unavailable." }, 500);
  }
  if (!authorization) return jsonResponse({ error: "Authentication required." }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const userResult = await supabase.auth.getUser(accessToken);
  if (userResult.error || !userResult.data.user) {
    return jsonResponse({ error: "Invalid owner session." }, 401);
  }

  const ownerResult = await supabase
    .from("owner_users")
    .select("auth_user_id")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  if (ownerResult.error || !ownerResult.data) {
    return jsonResponse({ error: "Owner access required." }, 403);
  }

  let body: { request_id?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  if (!body.request_id) return jsonResponse({ error: "request_id is required." }, 400);

  const requestResult = await supabase
    .from("preview_deployment_requests")
    .select(
      "id, deployment_config_id, source_branch, execution_status, execution_deployment_id, execution_started_at, netlify_build_id, preview_deploy_id, preview_url"
    )
    .eq("id", body.request_id)
    .maybeSingle();

  if (requestResult.error) return jsonResponse({ error: requestResult.error.message }, 500);
  if (!requestResult.data) return jsonResponse({ error: "Preview request not found." }, 404);

  const previewRequest = requestResult.data;
  if (!previewRequest.netlify_build_id) {
    return jsonResponse({ error: "This preview request has no Netlify build ID." }, 409);
  }
  if (!["executing", "published", "failed"].includes(previewRequest.execution_status)) {
    return jsonResponse({ error: "Preview execution has not started." }, 409);
  }

  const configResult = await supabase
    .from("project_deployment_configs")
    .select("id, netlify_site_id, production_branch")
    .eq("id", previewRequest.deployment_config_id)
    .maybeSingle();

  if (configResult.error) return jsonResponse({ error: configResult.error.message }, 500);
  if (!configResult.data?.netlify_site_id) {
    return jsonResponse({ error: "Netlify site configuration is missing." }, 409);
  }

  const sourceBranch = previewRequest.source_branch.trim();
  const productionBranch = (configResult.data.production_branch || "main").trim();
  if (!sourceBranch || sourceBranch.toLowerCase() === "main" || sourceBranch.toLowerCase() === productionBranch.toLowerCase()) {
    return jsonResponse({ error: "Status tracking blocked because the recorded branch is production-capable." }, 409);
  }

  const headers = { Authorization: `Bearer ${netlifyToken}` };
  const buildResponse = await fetch(
    `https://api.netlify.com/api/v1/builds/${encodeURIComponent(previewRequest.netlify_build_id)}`,
    { headers }
  );

  if (!buildResponse.ok) {
    return jsonResponse({ error: `Unable to read Netlify build status (HTTP ${buildResponse.status}).` }, 502);
  }

  const build = (await buildResponse.json()) as Record<string, unknown>;
  const buildDone = build.done === true;
  const buildError = stringValue(build.error);
  const deployId = stringValue(build.deploy_id) || stringValue(previewRequest.preview_deploy_id);

  if (buildDone && buildError) {
    const completedAt = new Date().toISOString();
    await supabase
      .from("preview_deployment_requests")
      .update({ execution_status: "failed", execution_error: buildError, execution_completed_at: completedAt })
      .eq("id", previewRequest.id);
    if (previewRequest.execution_deployment_id) {
      await supabase
        .from("project_deployments")
        .update({ status: "failed", error_message: buildError, completed_at: completedAt })
        .eq("id", previewRequest.execution_deployment_id);
    }
    return jsonResponse({ ok: true, request_id: previewRequest.id, execution_status: "failed", production: false, error: buildError });
  }

  if (!deployId) {
    return jsonResponse({
      ok: true,
      request_id: previewRequest.id,
      execution_status: "executing",
      production: false,
      build_done: buildDone,
      netlify_build_id: previewRequest.netlify_build_id,
      netlify_deploy_id: null,
      preview_url: null,
      note: "The branch build exists, but Netlify has not attached a deploy record yet.",
    });
  }

  const deployResponse = await fetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(configResult.data.netlify_site_id)}/deploys/${encodeURIComponent(deployId)}`,
    { headers }
  );

  if (!deployResponse.ok) {
    return jsonResponse({ error: `Unable to read Netlify deploy status (HTTP ${deployResponse.status}).` }, 502);
  }

  const deploy = (await deployResponse.json()) as Record<string, unknown>;
  const deployState = stringValue(deploy.state) || "unknown";
  const deployBranch = stringValue(deploy.branch);
  const deployError = stringValue(deploy.error_message);

  if (deployBranch && deployBranch.toLowerCase() !== sourceBranch.toLowerCase()) {
    return jsonResponse({ error: "Netlify deploy branch does not match the approved preview branch." }, 409);
  }
  if (deployBranch && (deployBranch.toLowerCase() === "main" || deployBranch.toLowerCase() === productionBranch.toLowerCase())) {
    return jsonResponse({ error: "Netlify returned a production-capable deploy branch. Persistence was blocked." }, 409);
  }

  const failedStates = new Set(["error", "failed", "cancelled"]);
  if (failedStates.has(deployState.toLowerCase()) || deployError) {
    const message = deployError || `Netlify deploy ended with state ${deployState}.`;
    const completedAt = new Date().toISOString();
    await supabase
      .from("preview_deployment_requests")
      .update({ execution_status: "failed", execution_error: message, execution_completed_at: completedAt, preview_deploy_id: deployId })
      .eq("id", previewRequest.id);
    if (previewRequest.execution_deployment_id) {
      await supabase
        .from("project_deployments")
        .update({ status: "failed", error_message: message, completed_at: completedAt, netlify_deploy_id: deployId })
        .eq("id", previewRequest.execution_deployment_id);
    }
    return jsonResponse({ ok: true, request_id: previewRequest.id, execution_status: "failed", production: false, netlify_build_id: previewRequest.netlify_build_id, netlify_deploy_id: deployId, error: message });
  }

  const previewUrl =
    stringValue(deploy.deploy_ssl_url) ||
    stringValue(deploy.ssl_url) ||
    stringValue(deploy.deploy_url) ||
    stringValue(deploy.review_url) ||
    stringValue(deploy.url);

  const isReady = deployState.toLowerCase() === "ready";
  if (isReady && previewUrl) {
    const completedAt = new Date().toISOString();
    await supabase
      .from("preview_deployment_requests")
      .update({
        execution_status: "published",
        execution_error: null,
        execution_completed_at: completedAt,
        preview_deploy_id: deployId,
        preview_url: previewUrl,
      })
      .eq("id", previewRequest.id);
    if (previewRequest.execution_deployment_id) {
      await supabase
        .from("project_deployments")
        .update({ status: "published", error_message: null, completed_at: completedAt, netlify_deploy_id: deployId })
        .eq("id", previewRequest.execution_deployment_id);
    }
    return jsonResponse({
      ok: true,
      request_id: previewRequest.id,
      execution_status: "published",
      production: false,
      deploy_state: deployState,
      netlify_build_id: previewRequest.netlify_build_id,
      netlify_deploy_id: deployId,
      preview_url: previewUrl,
      completed_at: completedAt,
      note: "The approved non-production branch deploy is ready and its preview URL was saved.",
    });
  }

  await supabase
    .from("preview_deployment_requests")
    .update({ execution_status: "executing", execution_error: null, preview_deploy_id: deployId })
    .eq("id", previewRequest.id);
  if (previewRequest.execution_deployment_id) {
    await supabase
      .from("project_deployments")
      .update({ status: "building", error_message: null, netlify_deploy_id: deployId })
      .eq("id", previewRequest.execution_deployment_id);
  }

  return jsonResponse({
    ok: true,
    request_id: previewRequest.id,
    execution_status: "executing",
    production: false,
    build_done: buildDone,
    deploy_state: deployState,
    netlify_build_id: previewRequest.netlify_build_id,
    netlify_deploy_id: deployId,
    preview_url: null,
    note: "The approved branch deploy is still building.",
  });
});
