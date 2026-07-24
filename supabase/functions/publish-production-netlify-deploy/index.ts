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
    return jsonResponse({ error: "Netlify publish credential is unavailable." }, 500);
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

  let body: { launch_request_id?: string; confirmation?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!body.launch_request_id) {
    return jsonResponse({ error: "launch_request_id is required." }, 400);
  }
  if (body.confirmation !== "PUBLISH_PRODUCTION_DEPLOY") {
    return jsonResponse({ error: "Exact production publish confirmation is required." }, 400);
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
  if (launch.status !== "launching") {
    return jsonResponse({ error: "Only a launching production request can be published." }, 409);
  }
  if (!launch.netlify_build_id || !launch.netlify_deploy_id) {
    return jsonResponse({ error: "The production build or deploy ID is missing." }, 409);
  }
  if (launch.execution_completed_at || launch.published_url) {
    return jsonResponse({ error: "This production request is already completed or published." }, 409);
  }

  const [configResult, deploymentResult] = await Promise.all([
    supabase
      .from("project_deployment_configs")
      .select("id, production_branch, production_url, netlify_site_id, auto_publish_locked, last_verification_status")
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
  const blockers: string[] = [];

  if (!productionUrl) blockers.push("Production URL is missing.");
  if (!config.auto_publish_locked) blockers.push("Auto-publish must remain recorded as locked before manual publication.");
  if (config.last_verification_status !== "passed") blockers.push("Deployment connection verification is not passing.");
  if (launch.production_branch.trim().toLowerCase() !== productionBranch.toLowerCase()) {
    blockers.push("Launch branch no longer matches the configured production branch.");
  }
  if (deployment.deploy_kind !== "production") blockers.push("Deployment history record is not production.");
  if (deployment.status !== "building") blockers.push("Deployment history is not in the expected building state.");
  if (deployment.branch.trim().toLowerCase() !== productionBranch.toLowerCase()) {
    blockers.push("Deployment history branch no longer matches production.");
  }
  if (
    deployment.deployment_config_id !== launch.deployment_config_id ||
    deployment.project_id !== launch.project_id ||
    deployment.client_id !== launch.client_id
  ) {
    blockers.push("Deployment history no longer matches the launch request.");
  }
  if (deployment.netlify_deploy_id !== launch.netlify_deploy_id) {
    blockers.push("Deployment history deploy ID does not match the launch request.");
  }

  if (blockers.length > 0) {
    return jsonResponse(
      {
        ok: false,
        launch_request_id: launch.id,
        blockers,
        production_published: false,
        note: "Production publication was blocked before any Netlify publish call.",
      },
      409
    );
  }

  const headers = { Authorization: `Bearer ${netlifyToken}` };
  const deployStatusUrl = `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}/deploys/${encodeURIComponent(launch.netlify_deploy_id)}`;
  const deployResponse = await fetch(deployStatusUrl, { headers });

  if (!deployResponse.ok) {
    return jsonResponse({ error: `Unable to validate Netlify deploy (HTTP ${deployResponse.status}).` }, 502);
  }

  const deploy = (await deployResponse.json()) as Record<string, unknown>;
  const deployState = stringValue(deploy.state) || "unknown";
  const deployBranch = stringValue(deploy.branch);
  const deployContext = stringValue(deploy.context);
  const publishedAtBefore = stringValue(deploy.published_at);
  const deployError = stringValue(deploy.error_message);

  if (deployError) return jsonResponse({ error: deployError }, 409);
  if (deployState.toLowerCase() !== "ready") {
    return jsonResponse({ error: `Netlify deploy state is ${deployState}, not ready.` }, 409);
  }
  if (!deployBranch || deployBranch.toLowerCase() !== productionBranch.toLowerCase()) {
    return jsonResponse({ error: "Netlify deploy branch does not match production." }, 409);
  }
  if ((deployContext || "production").toLowerCase() !== "production") {
    return jsonResponse({ error: `Netlify deploy context is ${deployContext || "unknown"}, not production.` }, 409);
  }
  if (publishedAtBefore) {
    return jsonResponse({ error: "Netlify already reports this deploy as published. Run the read-only status check instead." }, 409);
  }

  const transitionAt = new Date().toISOString();
  const transitionResult = await supabase
    .from("production_launch_requests")
    .update({ error_message: null })
    .eq("id", launch.id)
    .eq("status", "launching")
    .eq("netlify_deploy_id", launch.netlify_deploy_id)
    .is("execution_completed_at", null)
    .select("id")
    .maybeSingle();

  if (transitionResult.error || !transitionResult.data) {
    return jsonResponse({ error: "Production request changed before publication. No publish call was made." }, 409);
  }

  const publishResponse = await fetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}/deploys/${encodeURIComponent(launch.netlify_deploy_id)}/restore`,
    { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" }
  );

  const publishText = await publishResponse.text();
  let publishData: Record<string, unknown> = {};
  try {
    publishData = publishText ? JSON.parse(publishText) : {};
  } catch {
    publishData = {};
  }

  if (!publishResponse.ok) {
    const message = stringValue(publishData.message) || stringValue(publishData.error) || publishText || `HTTP ${publishResponse.status}`;
    return jsonResponse({ error: `Netlify publish request failed: ${message}` }, 502);
  }

  const verifiedResponse = await fetch(deployStatusUrl, { headers });
  if (!verifiedResponse.ok) {
    return jsonResponse({ error: `Publish call succeeded, but verification failed with HTTP ${verifiedResponse.status}. Run the status checker.` }, 502);
  }

  const verifiedDeploy = (await verifiedResponse.json()) as Record<string, unknown>;
  const publishedAt = stringValue(verifiedDeploy.published_at) || stringValue(publishData.published_at);
  const verifiedState = stringValue(verifiedDeploy.state) || deployState;
  const productionPage = productionUrl ? await reachable(productionUrl) : { ok: false, status: 0, finalUrl: productionUrl || "" };

  if (!publishedAt || verifiedState.toLowerCase() !== "ready" || !productionPage.ok) {
    return jsonResponse({
      ok: true,
      launch_request_id: launch.id,
      status: "launching",
      production_published: false,
      publish_requested: true,
      deploy_state: verifiedState,
      published_at: publishedAt,
      production_url: productionUrl,
      production_url_status: productionPage.status,
      note: "Netlify accepted the publish request, but final live publication has not yet been verified. Run the read-only production status check.",
    });
  }

  const completedAt = publishedAt || transitionAt;
  await supabase
    .from("production_launch_requests")
    .update({
      status: "published",
      error_message: null,
      execution_completed_at: completedAt,
      published_url: productionPage.finalUrl || productionUrl,
    })
    .eq("id", launch.id)
    .eq("status", "launching");

  await supabase
    .from("project_deployments")
    .update({
      status: "published",
      error_message: null,
      completed_at: completedAt,
      deploy_url: productionPage.finalUrl || productionUrl,
    })
    .eq("id", deployment.id)
    .eq("status", "building");

  return jsonResponse({
    ok: true,
    launch_request_id: launch.id,
    status: "published",
    production_published: true,
    publish_requested: true,
    netlify_build_id: launch.netlify_build_id,
    netlify_deploy_id: launch.netlify_deploy_id,
    production_url: productionPage.finalUrl || productionUrl,
    published_at: completedAt,
    note: "Netlify published the selected ready production deploy and the production URL is reachable.",
  });
});
