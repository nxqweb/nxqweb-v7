import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server credentials are unavailable." }, 500);
  }

  if (!authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
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

  if (!body.request_id) {
    return jsonResponse({ error: "request_id is required." }, 400);
  }

  const requestResult = await supabase
    .from("preview_deployment_requests")
    .select(
      "id, deployment_config_id, project_id, client_id, source_branch, requested_commit_sha, status, safety_status, safety_checked_at, execution_status, execution_deployment_id"
    )
    .eq("id", body.request_id)
    .maybeSingle();

  if (requestResult.error) {
    return jsonResponse({ error: requestResult.error.message }, 500);
  }

  if (!requestResult.data) {
    return jsonResponse({ error: "Preview request not found." }, 404);
  }

  const previewRequest = requestResult.data;

  const configResult = await supabase
    .from("project_deployment_configs")
    .select(
      "id, production_branch, auto_publish_locked, last_verification_status, github_owner, github_repo, netlify_site_id"
    )
    .eq("id", previewRequest.deployment_config_id)
    .maybeSingle();

  if (configResult.error) {
    return jsonResponse({ error: configResult.error.message }, 500);
  }

  if (!configResult.data) {
    return jsonResponse({ error: "Deployment configuration not found." }, 404);
  }

  const config = configResult.data;
  const sourceBranch = previewRequest.source_branch.trim();
  const productionBranch = (config.production_branch || "main").trim();
  const safetyCheckedAt = previewRequest.safety_checked_at
    ? new Date(previewRequest.safety_checked_at)
    : null;
  const safetyAgeMs = safetyCheckedAt ? Date.now() - safetyCheckedAt.getTime() : Number.POSITIVE_INFINITY;
  const maxSafetyAgeMs = 15 * 60 * 1000;

  const blockers: string[] = [];

  if (previewRequest.status !== "approved_for_preview") {
    blockers.push("Preview request must have approved_for_preview status.");
  }

  if (previewRequest.safety_status !== "passed") {
    blockers.push("Preview request must have a saved passing safety result.");
  }

  if (!safetyCheckedAt || Number.isNaN(safetyCheckedAt.getTime()) || safetyAgeMs > maxSafetyAgeMs) {
    blockers.push("Preview safety result is missing or older than 15 minutes. Run it again.");
  }

  if (!sourceBranch) {
    blockers.push("Preview source branch is missing.");
  }

  if (sourceBranch.toLowerCase() === "main") {
    blockers.push("The main branch cannot be prepared for preview execution.");
  }

  if (sourceBranch.toLowerCase() === productionBranch.toLowerCase()) {
    blockers.push("The configured production branch cannot be prepared for preview execution.");
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

  if (previewRequest.execution_deployment_id || previewRequest.execution_status === "prepared") {
    blockers.push("This preview request already has a prepared execution record.");
  }

  if (blockers.length > 0) {
    return jsonResponse(
      {
        ok: false,
        request_id: previewRequest.id,
        blockers,
        note: "Preparation was blocked. No deployment record was created and no external service was called.",
      },
      409
    );
  }

  const deploymentResult = await supabase
    .from("project_deployments")
    .insert({
      deployment_config_id: previewRequest.deployment_config_id,
      project_id: previewRequest.project_id,
      client_id: previewRequest.client_id,
      trigger_source: "owner",
      requested_by: userResult.data.user.id,
      deploy_kind: "preview",
      branch: sourceBranch,
      git_commit_sha: previewRequest.requested_commit_sha || null,
      status: "queued",
      error_message: null,
      started_at: null,
      completed_at: null,
    })
    .select("id, status, branch, git_commit_sha, created_at")
    .single();

  if (deploymentResult.error || !deploymentResult.data) {
    return jsonResponse(
      { error: deploymentResult.error?.message || "Unable to create queued preview execution record." },
      500
    );
  }

  const preparedAt = new Date().toISOString();
  const updateResult = await supabase
    .from("preview_deployment_requests")
    .update({
      execution_status: "prepared",
      execution_prepared_at: preparedAt,
      execution_prepared_by: userResult.data.user.id,
      execution_deployment_id: deploymentResult.data.id,
      execution_error: null,
    })
    .eq("id", previewRequest.id)
    .eq("execution_status", "not_prepared")
    .is("execution_deployment_id", null)
    .select("id, execution_status, execution_prepared_at, execution_deployment_id")
    .maybeSingle();

  if (updateResult.error || !updateResult.data) {
    await supabase.from("project_deployments").delete().eq("id", deploymentResult.data.id);

    return jsonResponse(
      {
        error:
          updateResult.error?.message ||
          "Preview request changed while preparation was running. The temporary queued record was removed.",
      },
      409
    );
  }

  return jsonResponse({
    ok: true,
    request_id: previewRequest.id,
    execution_status: updateResult.data.execution_status,
    execution_prepared_at: updateResult.data.execution_prepared_at,
    deployment_record: deploymentResult.data,
    note:
      "Execution preparation completed locally. No GitHub write, Netlify deploy, preview publish, production publish, or auto-publish setting change occurred.",
  });
});
