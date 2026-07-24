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

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
      "id, deployment_config_id, project_id, client_id, preview_request_id, production_branch, production_url, status, audit_status, audit_checked_at, critical_blockers, deployment_record_id, prepared_at"
    )
    .eq("id", body.launch_request_id)
    .maybeSingle();

  if (launchResult.error) return jsonResponse({ error: launchResult.error.message }, 500);
  if (!launchResult.data) return jsonResponse({ error: "Production launch request not found." }, 404);

  const launch = launchResult.data;

  const [previewResult, configResult] = await Promise.all([
    supabase
      .from("preview_deployment_requests")
      .select("id, source_branch, execution_status, preview_url")
      .eq("id", launch.preview_request_id)
      .maybeSingle(),
    supabase
      .from("project_deployment_configs")
      .select(
        "id, production_branch, production_url, auto_publish_locked, last_verification_status, github_owner, github_repo, netlify_site_id"
      )
      .eq("id", launch.deployment_config_id)
      .maybeSingle(),
  ]);

  if (previewResult.error) return jsonResponse({ error: previewResult.error.message }, 500);
  if (configResult.error) return jsonResponse({ error: configResult.error.message }, 500);
  if (!previewResult.data) return jsonResponse({ error: "Linked preview request not found." }, 404);
  if (!configResult.data) return jsonResponse({ error: "Deployment configuration not found." }, 404);

  const preview = previewResult.data;
  const config = configResult.data;
  const productionBranch = cleanString(launch.production_branch) || cleanString(config.production_branch) || "main";
  const configuredProductionBranch = cleanString(config.production_branch) || "main";
  const productionUrl = cleanString(launch.production_url) || cleanString(config.production_url);
  const auditCheckedAt = launch.audit_checked_at ? new Date(launch.audit_checked_at) : null;
  const auditAgeMs = auditCheckedAt ? Date.now() - auditCheckedAt.getTime() : Number.POSITIVE_INFINITY;
  const maxAuditAgeMs = 15 * 60 * 1000;
  const criticalBlockers = Array.isArray(launch.critical_blockers) ? launch.critical_blockers : [];

  const blockers: string[] = [];

  if (launch.status !== "approved_for_production") {
    blockers.push("Production launch request must have approved_for_production status.");
  }
  if (launch.audit_status !== "passed") {
    blockers.push("Production launch request must have a saved passing audit.");
  }
  if (!auditCheckedAt || Number.isNaN(auditCheckedAt.getTime()) || auditAgeMs > maxAuditAgeMs) {
    blockers.push("Production launch audit is missing or older than 15 minutes. Run it again.");
  }
  if (criticalBlockers.length > 0) {
    blockers.push("Production launch audit still contains critical blockers.");
  }
  if (preview.execution_status !== "published" || !cleanString(preview.preview_url)) {
    blockers.push("The linked preview must remain published with a saved URL.");
  }
  if (!productionBranch) {
    blockers.push("Production branch is missing.");
  }
  if (productionBranch.toLowerCase() !== configuredProductionBranch.toLowerCase()) {
    blockers.push("Launch production branch does not match the configured production branch.");
  }
  if (cleanString(preview.source_branch)?.toLowerCase() === productionBranch.toLowerCase()) {
    blockers.push("Production branch must remain separate from the approved preview branch.");
  }
  if (!productionUrl || !productionUrl.toLowerCase().startsWith("https://")) {
    blockers.push("A valid HTTPS production URL is required.");
  }
  if (!config.auto_publish_locked) {
    blockers.push("Auto publishing must remain recorded as locked.");
  }
  if (config.last_verification_status !== "passed") {
    blockers.push("Deployment connection must have a saved passing verification.");
  }
  if (!config.github_owner || !config.github_repo) {
    blockers.push("GitHub repository metadata is incomplete.");
  }
  if (!config.netlify_site_id) {
    blockers.push("Netlify site metadata is missing.");
  }
  if (launch.deployment_record_id || launch.prepared_at) {
    blockers.push("This production launch request already has a prepared execution record.");
  }

  if (blockers.length > 0) {
    return jsonResponse(
      {
        ok: false,
        launch_request_id: launch.id,
        blockers,
        production: false,
        note: "Preparation was blocked. No deployment record was created and no external service was called.",
      },
      409
    );
  }

  const deploymentResult = await supabase
    .from("project_deployments")
    .insert({
      deployment_config_id: launch.deployment_config_id,
      project_id: launch.project_id,
      client_id: launch.client_id,
      trigger_source: "owner",
      requested_by: userResult.data.user.id,
      deploy_kind: "production",
      branch: productionBranch,
      git_commit_sha: null,
      status: "queued",
      error_message: null,
      started_at: null,
      completed_at: null,
    })
    .select("id, status, branch, git_commit_sha, created_at")
    .single();

  if (deploymentResult.error || !deploymentResult.data) {
    return jsonResponse(
      { error: deploymentResult.error?.message || "Unable to create queued production execution record." },
      500
    );
  }

  const preparedAt = new Date().toISOString();
  const updateResult = await supabase
    .from("production_launch_requests")
    .update({
      status: "prepared",
      prepared_at: preparedAt,
      prepared_by: userResult.data.user.id,
      deployment_record_id: deploymentResult.data.id,
      error_message: null,
    })
    .eq("id", launch.id)
    .eq("status", "approved_for_production")
    .is("deployment_record_id", null)
    .is("prepared_at", null)
    .select("id, status, prepared_at, prepared_by, deployment_record_id")
    .maybeSingle();

  if (updateResult.error || !updateResult.data) {
    await supabase.from("project_deployments").delete().eq("id", deploymentResult.data.id);
    return jsonResponse(
      {
        error:
          updateResult.error?.message ||
          "Production launch request changed while preparation was running. The temporary queued record was removed.",
      },
      409
    );
  }

  return jsonResponse({
    ok: true,
    launch_request_id: launch.id,
    status: updateResult.data.status,
    prepared_at: updateResult.data.prepared_at,
    deployment_record: deploymentResult.data,
    production: false,
    note:
      "Production execution preparation completed internally. No GitHub write, Netlify build, production publish, or auto-publish setting change occurred.",
  });
});
