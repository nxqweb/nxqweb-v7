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

async function reachable(url: string) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    await response.body?.cancel();
    return { ok: response.ok, status: response.status, finalUrl: response.url };
  } catch {
    return { ok: false, status: 0, finalUrl: url };
  }
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

  let body: { launch_request_id?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!body.launch_request_id) {
    return jsonResponse({ error: "launch_request_id is required." }, 400);
  }

  const launchResult = await supabase
    .from("production_launch_requests")
    .select(
      "id, deployment_config_id, project_id, client_id, production_branch, production_url, status, deployment_record_id, netlify_build_id, netlify_deploy_id, execution_started_at, execution_completed_at, published_url"
    )
    .eq("id", body.launch_request_id)
    .maybeSingle();

  if (launchResult.error) return jsonResponse({ error: launchResult.error.message }, 500);
  if (!launchResult.data) return jsonResponse({ error: "Production launch request not found." }, 404);

  const launch = launchResult.data;
  if (!launch.netlify_build_id) {
    return jsonResponse({ error: "This production launch has no Netlify build ID." }, 409);
  }
  if (!["launching", "published", "failed"].includes(launch.status)) {
    return jsonResponse({ error: "Production execution has not started." }, 409);
  }

  const [configResult, deploymentResult] = await Promise.all([
    supabase
      .from("project_deployment_configs")
      .select("id, netlify_site_id, production_branch, production_url")
      .eq("id", launch.deployment_config_id)
      .maybeSingle(),
    launch.deployment_record_id
      ? supabase
          .from("project_deployments")
          .select("id, deployment_config_id, project_id, client_id, deploy_kind, branch, status, netlify_deploy_id")
          .eq("id", launch.deployment_record_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (configResult.error) return jsonResponse({ error: configResult.error.message }, 500);
  if (deploymentResult.error) return jsonResponse({ error: deploymentResult.error.message }, 500);
  if (!configResult.data?.netlify_site_id) {
    return jsonResponse({ error: "Netlify site configuration is missing." }, 409);
  }
  if (!deploymentResult.data) {
    return jsonResponse({ error: "Production deployment history record is missing." }, 409);
  }

  const config = configResult.data;
  const deployment = deploymentResult.data;
  const productionBranch = (config.production_branch || launch.production_branch || "main").trim();
  const productionUrl = stringValue(config.production_url) || stringValue(launch.production_url);

  if (!productionUrl) {
    return jsonResponse({ error: "Production URL is missing." }, 409);
  }
  if (launch.production_branch.trim().toLowerCase() !== productionBranch.toLowerCase()) {
    return jsonResponse({ error: "Launch branch no longer matches the configured production branch." }, 409);
  }
  if (deployment.deploy_kind !== "production") {
    return jsonResponse({ error: "Deployment history record is not a production deployment." }, 409);
  }
  if (deployment.branch.trim().toLowerCase() !== productionBranch.toLowerCase()) {
    return jsonResponse({ error: "Deployment history branch no longer matches production." }, 409);
  }
  if (
    deployment.deployment_config_id !== launch.deployment_config_id ||
    deployment.project_id !== launch.project_id ||
    deployment.client_id !== launch.client_id
  ) {
    return jsonResponse({ error: "Deployment history no longer matches the launch request." }, 409);
  }

  const headers = { Authorization: `Bearer ${netlifyToken}` };
  const buildResponse = await fetch(
    `https://api.netlify.com/api/v1/builds/${encodeURIComponent(launch.netlify_build_id)}`,
    { headers }
  );

  if (!buildResponse.ok) {
    return jsonResponse({ error: `Unable to read Netlify build status (HTTP ${buildResponse.status}).` }, 502);
  }

  const build = (await buildResponse.json()) as Record<string, unknown>;
  const buildDone = build.done === true;
  const buildError = stringValue(build.error);
  const deployId =
    stringValue(build.deploy_id) ||
    stringValue(launch.netlify_deploy_id) ||
    stringValue(deployment.netlify_deploy_id);

  if (buildDone && buildError) {
    const completedAt = new Date().toISOString();
    await supabase
      .from("production_launch_requests")
      .update({ status: "failed", error_message: buildError, execution_completed_at: completedAt })
      .eq("id", launch.id);
    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: buildError, completed_at: completedAt })
      .eq("id", deployment.id);

    return jsonResponse({
      ok: true,
      launch_request_id: launch.id,
      status: "failed",
      production_build_started: true,
      production_published: false,
      error: buildError,
    });
  }

  if (!deployId) {
    return jsonResponse({
      ok: true,
      launch_request_id: launch.id,
      status: "launching",
      production_build_started: true,
      production_published: false,
      build_done: buildDone,
      netlify_build_id: launch.netlify_build_id,
      netlify_deploy_id: null,
      note: "The production build exists, but Netlify has not attached a deploy record yet.",
    });
  }

  const deployResponse = await fetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}/deploys/${encodeURIComponent(deployId)}`,
    { headers }
  );

  if (!deployResponse.ok) {
    return jsonResponse({ error: `Unable to read Netlify deploy status (HTTP ${deployResponse.status}).` }, 502);
  }

  const deploy = (await deployResponse.json()) as Record<string, unknown>;
  const deployState = stringValue(deploy.state) || "unknown";
  const deployBranch = stringValue(deploy.branch);
  const deployContext = stringValue(deploy.context);
  const deployError = stringValue(deploy.error_message);
  const publishedAt = stringValue(deploy.published_at);

  if (!deployBranch || deployBranch.toLowerCase() !== productionBranch.toLowerCase()) {
    return jsonResponse({ error: "Netlify deploy branch does not match the configured production branch." }, 409);
  }

  if (deployContext && deployContext.toLowerCase() !== "production") {
    return jsonResponse({ error: `Netlify deploy context is ${deployContext}, not production.` }, 409);
  }

  const failedStates = new Set(["error", "failed", "cancelled"]);
  if (failedStates.has(deployState.toLowerCase()) || deployError) {
    const message = deployError || `Netlify deploy ended with state ${deployState}.`;
    const completedAt = new Date().toISOString();
    await supabase
      .from("production_launch_requests")
      .update({
        status: "failed",
        error_message: message,
        execution_completed_at: completedAt,
        netlify_deploy_id: deployId,
      })
      .eq("id", launch.id);
    await supabase
      .from("project_deployments")
      .update({
        status: "failed",
        error_message: message,
        completed_at: completedAt,
        netlify_deploy_id: deployId,
      })
      .eq("id", deployment.id);

    return jsonResponse({
      ok: true,
      launch_request_id: launch.id,
      status: "failed",
      production_build_started: true,
      production_published: false,
      netlify_build_id: launch.netlify_build_id,
      netlify_deploy_id: deployId,
      error: message,
    });
  }

  const isReady = deployState.toLowerCase() === "ready";
  const isProductionContext = (deployContext || "production").toLowerCase() === "production";

  if (isReady && isProductionContext && publishedAt) {
    const productionPage = await reachable(productionUrl);
    if (!productionPage.ok) {
      return jsonResponse({
        ok: true,
        launch_request_id: launch.id,
        status: "launching",
        production_build_started: true,
        production_published: false,
        build_done: buildDone,
        deploy_state: deployState,
        netlify_build_id: launch.netlify_build_id,
        netlify_deploy_id: deployId,
        production_url: productionUrl,
        production_url_status: productionPage.status,
        note: "Netlify reports a published production deploy, but the configured production URL is not reachable yet.",
      });
    }

    const completedAt = publishedAt || new Date().toISOString();
    await supabase
      .from("production_launch_requests")
      .update({
        status: "published",
        error_message: null,
        execution_completed_at: completedAt,
        netlify_deploy_id: deployId,
        published_url: productionPage.finalUrl || productionUrl,
      })
      .eq("id", launch.id);
    await supabase
      .from("project_deployments")
      .update({
        status: "published",
        error_message: null,
        completed_at: completedAt,
        netlify_deploy_id: deployId,
        deploy_url: productionPage.finalUrl || productionUrl,
      })
      .eq("id", deployment.id);

    return jsonResponse({
      ok: true,
      launch_request_id: launch.id,
      status: "published",
      production_build_started: true,
      production_published: true,
      build_done: buildDone,
      deploy_state: deployState,
      deploy_context: deployContext || "production",
      netlify_build_id: launch.netlify_build_id,
      netlify_deploy_id: deployId,
      production_url: productionPage.finalUrl || productionUrl,
      published_at: completedAt,
      note: "Netlify confirmed the production deploy is published and the production URL is reachable.",
    });
  }

  await supabase
    .from("production_launch_requests")
    .update({ status: "launching", error_message: null, netlify_deploy_id: deployId })
    .eq("id", launch.id);
  await supabase
    .from("project_deployments")
    .update({ status: "building", error_message: null, netlify_deploy_id: deployId })
    .eq("id", deployment.id);

  return jsonResponse({
    ok: true,
    launch_request_id: launch.id,
    status: "launching",
    production_build_started: true,
    production_published: false,
    build_done: buildDone,
    deploy_state: deployState,
    deploy_context: deployContext,
    netlify_build_id: launch.netlify_build_id,
    netlify_deploy_id: deployId,
    production_url: productionUrl,
    note: "The production deploy is still building or has not yet been confirmed as published.",
  });
});