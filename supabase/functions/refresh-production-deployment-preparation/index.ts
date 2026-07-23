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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server credentials are unavailable." }, 500);
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
      "id, deployment_config_id, project_id, client_id, preview_request_id, production_branch, production_url, status, audit_status, critical_blockers, owner_decision_at, deployment_record_id, netlify_build_id, netlify_deploy_id, execution_started_at"
    )
    .eq("id", body.launch_request_id)
    .maybeSingle();

  if (launchResult.error) return jsonResponse({ error: launchResult.error.message }, 500);
  if (!launchResult.data) return jsonResponse({ error: "Production launch request not found." }, 404);

  const launch = launchResult.data;

  const [configResult, previewResult, deploymentResult] = await Promise.all([
    supabase
      .from("project_deployment_configs")
      .select("id, project_id, client_id, production_branch, production_url, auto_publish_locked, last_verification_status")
      .eq("id", launch.deployment_config_id)
      .maybeSingle(),
    supabase
      .from("preview_deployment_requests")
      .select("id, deployment_config_id, project_id, client_id, source_branch, execution_status, preview_url")
      .eq("id", launch.preview_request_id)
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
  if (previewResult.error) return jsonResponse({ error: previewResult.error.message }, 500);
  if (deploymentResult.error) return jsonResponse({ error: deploymentResult.error.message }, 500);

  const config = configResult.data;
  const preview = previewResult.data;
  const deployment = deploymentResult.data;
  const blockers: string[] = [];

  if (launch.status !== "prepared") blockers.push("Launch request is not prepared.");
  if (launch.audit_status !== "passed") blockers.push("A passing audit is required.");
  if ((launch.critical_blockers || []).length > 0) blockers.push("Critical blockers remain.");
  if (!launch.owner_decision_at) blockers.push("Owner approval is missing.");
  if (!launch.deployment_record_id || !deployment) blockers.push("Queued production deployment record is missing.");
  if (launch.netlify_build_id || launch.netlify_deploy_id || launch.execution_started_at) {
    blockers.push("Production execution has already started.");
  }
  if (!config) blockers.push("Deployment configuration is missing.");
  if (!preview) blockers.push("Approved preview is missing.");

  if (config) {
    if (!config.auto_publish_locked) blockers.push("Auto publishing is not recorded as locked.");
    if (config.last_verification_status !== "passed") blockers.push("Connection verification is not passing.");
    if (config.production_branch !== launch.production_branch) blockers.push("Production branch no longer matches configuration.");
    if (config.project_id !== launch.project_id || config.client_id !== launch.client_id) blockers.push("Deployment configuration no longer matches the launch request.");
  }

  if (preview) {
    if (preview.execution_status !== "published" || !preview.preview_url) blockers.push("Approved preview is not published.");
    if (preview.deployment_config_id !== launch.deployment_config_id || preview.project_id !== launch.project_id || preview.client_id !== launch.client_id) {
      blockers.push("Approved preview no longer matches the launch request.");
    }
    if (preview.source_branch.toLowerCase() === launch.production_branch.toLowerCase()) {
      blockers.push("Preview and production branches must remain separate.");
    }
  }

  if (deployment) {
    if (deployment.deploy_kind !== "production") blockers.push("Queued deployment is not a production deployment.");
    if (deployment.status !== "queued") blockers.push("Queued deployment record is no longer queued.");
    if (deployment.branch !== launch.production_branch) blockers.push("Queued deployment branch no longer matches production.");
    if (deployment.netlify_deploy_id) blockers.push("Queued deployment already has a Netlify deploy ID.");
    if (deployment.deployment_config_id !== launch.deployment_config_id || deployment.project_id !== launch.project_id || deployment.client_id !== launch.client_id) {
      blockers.push("Queued deployment no longer matches the launch request.");
    }
  }

  if (blockers.length > 0) {
    return jsonResponse({ ok: false, blockers, production: false, note: "Preparation refresh was blocked. No external call was made." }, 409);
  }

  const refreshedAt = new Date().toISOString();
  const updateResult = await supabase
    .from("production_launch_requests")
    .update({ prepared_at: refreshedAt, prepared_by: userResult.data.user.id, error_message: null })
    .eq("id", launch.id)
    .eq("status", "prepared")
    .is("netlify_build_id", null)
    .is("netlify_deploy_id", null)
    .is("execution_started_at", null)
    .select("id, status, prepared_at, deployment_record_id")
    .maybeSingle();

  if (updateResult.error || !updateResult.data) {
    return jsonResponse({ error: updateResult.error?.message || "Launch changed during preparation refresh." }, 409);
  }

  return jsonResponse({
    ok: true,
    launch_request_id: launch.id,
    status: updateResult.data.status,
    prepared_at: updateResult.data.prepared_at,
    deployment_record_id: updateResult.data.deployment_record_id,
    production: false,
    note: "Production preparation was refreshed internally. No GitHub write, Netlify build, or production deployment occurred.",
  });
});
