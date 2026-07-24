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

function cleanBranch(value: string) {
  return value.trim();
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
  const githubToken = Deno.env.get("NXQ_GITHUB_VERIFY_TOKEN");
  const netlifyToken = Deno.env.get("NXQ_NETLIFY_VERIFY_TOKEN");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server credentials are unavailable." }, 500);
  }

  if (!githubToken || !netlifyToken) {
    return jsonResponse(
      { error: "Preview execution credentials are unavailable. No external call was made." },
      500
    );
  }

  if (!authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

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

  if (!body.request_id) {
    return jsonResponse({ error: "request_id is required." }, 400);
  }

  const requestResult = await supabase
    .from("preview_deployment_requests")
    .select(
      "id, deployment_config_id, project_id, client_id, source_branch, requested_commit_sha, status, safety_status, safety_checked_at, execution_status, execution_deployment_id, preview_deploy_id, netlify_build_id"
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
  const sourceBranch = cleanBranch(previewRequest.source_branch || "");
  const productionBranch = cleanBranch(config.production_branch || "main");
  const safetyCheckedAt = previewRequest.safety_checked_at
    ? new Date(previewRequest.safety_checked_at)
    : null;
  const safetyAgeMs = safetyCheckedAt
    ? Date.now() - safetyCheckedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const maxSafetyAgeMs = 15 * 60 * 1000;
  const blockers: string[] = [];

  if (previewRequest.status !== "approved_for_preview") {
    blockers.push("Preview request is not approved_for_preview.");
  }

  if (previewRequest.execution_status !== "prepared") {
    blockers.push("Preview execution must be prepared before it can run.");
  }

  if (!previewRequest.execution_deployment_id) {
    blockers.push("Prepared deployment record is missing.");
  }

  if (previewRequest.preview_deploy_id || previewRequest.netlify_build_id) {
    blockers.push("This preview request already has a Netlify build or deploy identifier.");
  }

  if (previewRequest.safety_status !== "passed") {
    blockers.push("A saved passing safety result is required.");
  }

  if (!safetyCheckedAt || Number.isNaN(safetyCheckedAt.getTime()) || safetyAgeMs > maxSafetyAgeMs) {
    blockers.push("The safety result is missing or older than 15 minutes. Run it again.");
  }

  if (!sourceBranch) {
    blockers.push("Preview source branch is missing.");
  }

  if (sourceBranch.toLowerCase() === "main") {
    blockers.push("The main branch can never be used for preview execution.");
  }

  if (sourceBranch.toLowerCase() === productionBranch.toLowerCase()) {
    blockers.push("The configured production branch can never be used for preview execution.");
  }

  if (!config.auto_publish_locked) {
    blockers.push("Auto publishing must remain recorded as locked.");
  }

  if (config.last_verification_status !== "passed") {
    blockers.push("Deployment connection verification is not passing.");
  }

  if (!config.github_owner || !config.github_repo) {
    blockers.push("GitHub repository metadata is incomplete.");
  }

  if (!config.netlify_site_id) {
    blockers.push("Netlify site metadata is missing.");
  }

  if (blockers.length > 0) {
    return jsonResponse(
      {
        ok: false,
        request_id: previewRequest.id,
        blockers,
        note: "Preview execution was blocked before any Netlify build call.",
      },
      409
    );
  }

  const encodedBranch = encodeURIComponent(sourceBranch);
  const githubBranchResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}/branches/${encodedBranch}`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NXQ-Web-Preview-Executor",
      },
    }
  );

  if (!githubBranchResponse.ok) {
    return jsonResponse(
      {
        error: `GitHub source branch validation failed with HTTP ${githubBranchResponse.status}. No Netlify build was triggered.`,
      },
      409
    );
  }

  const netlifySiteResponse = await fetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}`,
    {
      headers: { Authorization: `Bearer ${netlifyToken}` },
    }
  );

  if (!netlifySiteResponse.ok) {
    return jsonResponse(
      {
        error: `Netlify site validation failed with HTTP ${netlifySiteResponse.status}. No build was triggered.`,
      },
      409
    );
  }

  const transitionAt = new Date().toISOString();
  const transitionResult = await supabase
    .from("preview_deployment_requests")
    .update({
      execution_status: "executing",
      execution_started_at: transitionAt,
      execution_error: null,
    })
    .eq("id", previewRequest.id)
    .eq("execution_status", "prepared")
    .is("preview_deploy_id", null)
    .is("netlify_build_id", null)
    .select("id, execution_status")
    .maybeSingle();

  if (transitionResult.error || !transitionResult.data) {
    return jsonResponse(
      {
        error:
          transitionResult.error?.message ||
          "Preview request changed before execution. No Netlify build was triggered.",
      },
      409
    );
  }

  await supabase
    .from("project_deployments")
    .update({ status: "building", started_at: transitionAt, error_message: null })
    .eq("id", previewRequest.execution_deployment_id)
    .eq("status", "queued");

  const buildUrl = new URL(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}/builds`
  );
  buildUrl.searchParams.set("branch", sourceBranch);
  buildUrl.searchParams.set("clear_cache", "false");
  buildUrl.searchParams.set("title", `NXQ owner-approved preview: ${sourceBranch}`);

  let buildResponse: Response;

  try {
    buildResponse = await fetch(buildUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${netlifyToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Netlify network error.";

    await supabase
      .from("preview_deployment_requests")
      .update({ execution_status: "failed", execution_error: message })
      .eq("id", previewRequest.id)
      .eq("execution_status", "executing");

    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", previewRequest.execution_deployment_id);

    return jsonResponse({ error: `Netlify build request failed: ${message}` }, 502);
  }

  const responseText = await buildResponse.text();
  let buildData: Record<string, unknown> = {};

  try {
    buildData = responseText ? JSON.parse(responseText) : {};
  } catch {
    buildData = { raw_response: responseText };
  }

  if (!buildResponse.ok) {
    const message = `Netlify build request failed with HTTP ${buildResponse.status}.`;

    await supabase
      .from("preview_deployment_requests")
      .update({ execution_status: "failed", execution_error: message })
      .eq("id", previewRequest.id)
      .eq("execution_status", "executing");

    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", previewRequest.execution_deployment_id);

    return jsonResponse({ error: message, netlify: buildData }, 502);
  }

  const buildId = typeof buildData.id === "string" ? buildData.id : null;
  const deployId = typeof buildData.deploy_id === "string" ? buildData.deploy_id : null;

  if (!buildId) {
    const message = "Netlify accepted the request but did not return a build ID.";

    await supabase
      .from("preview_deployment_requests")
      .update({ execution_status: "failed", execution_error: message })
      .eq("id", previewRequest.id)
      .eq("execution_status", "executing");

    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", previewRequest.execution_deployment_id);

    return jsonResponse({ error: message, netlify: buildData }, 502);
  }

  const saveRequestResult = await supabase
    .from("preview_deployment_requests")
    .update({
      netlify_build_id: buildId,
      preview_deploy_id: deployId,
      execution_error: null,
    })
    .eq("id", previewRequest.id)
    .eq("execution_status", "executing")
    .select(
      "id, execution_status, execution_started_at, netlify_build_id, preview_deploy_id"
    )
    .single();

  if (saveRequestResult.error) {
    return jsonResponse(
      {
        error: `Netlify build started, but saving its identifiers failed: ${saveRequestResult.error.message}`,
        netlify_build_id: buildId,
        netlify_deploy_id: deployId,
      },
      500
    );
  }

  await supabase
    .from("project_deployments")
    .update({ netlify_deploy_id: deployId, status: "building" })
    .eq("id", previewRequest.execution_deployment_id);

  return jsonResponse({
    ok: true,
    request_id: previewRequest.id,
    branch: sourceBranch,
    production_branch: productionBranch,
    production: false,
    execution_status: "executing",
    netlify_build_id: buildId,
    netlify_deploy_id: deployId,
    note:
      "A Netlify branch build was requested for the approved non-production branch. No production publish or Netlify setting change was requested.",
  });
});
