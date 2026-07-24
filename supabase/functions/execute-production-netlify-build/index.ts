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

function validHttpsUrl(value: string | null) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("NXQ_GITHUB_VERIFY_TOKEN");
  const netlifyToken = Deno.env.get("NXQ_NETLIFY_VERIFY_TOKEN");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server credentials are unavailable." }, 500);
  }
  if (!githubToken || !netlifyToken) {
    return jsonResponse({ error: "Production execution credentials are unavailable. No external call was made." }, 500);
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
  if (body.confirmation !== "START_PRODUCTION_BUILD") {
    return jsonResponse({ error: "Exact production build confirmation is required." }, 400);
  }

  const launchResult = await supabase
    .from("production_launch_requests")
    .select(
      "id, deployment_config_id, project_id, client_id, preview_request_id, production_branch, production_url, status, audit_status, audit_checked_at, critical_blockers, owner_decision_at, prepared_at, deployment_record_id, netlify_build_id, netlify_deploy_id, execution_started_at"
    )
    .eq("id", body.launch_request_id)
    .maybeSingle();

  if (launchResult.error) return jsonResponse({ error: launchResult.error.message }, 500);
  if (!launchResult.data) return jsonResponse({ error: "Production launch request not found." }, 404);

  const launch = launchResult.data;

  const [configResult, previewResult, deploymentResult] = await Promise.all([
    supabase
      .from("project_deployment_configs")
      .select(
        "id, github_owner, github_repo, production_branch, netlify_site_id, production_url, auto_publish_locked, last_verification_status"
      )
      .eq("id", launch.deployment_config_id)
      .maybeSingle(),
    supabase
      .from("preview_deployment_requests")
      .select(
        "id, deployment_config_id, project_id, client_id, source_branch, execution_status, preview_url"
      )
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
  if (!configResult.data) return jsonResponse({ error: "Deployment configuration not found." }, 404);
  if (!previewResult.data) return jsonResponse({ error: "Approved preview request not found." }, 404);
  if (!deploymentResult.data) return jsonResponse({ error: "Prepared production deployment record not found." }, 404);

  const config = configResult.data;
  const preview = previewResult.data;
  const deployment = deploymentResult.data;
  const productionBranch = cleanString(launch.production_branch);
  const configuredProductionBranch = cleanString(config.production_branch) || "main";
  const productionUrl = cleanString(launch.production_url) || cleanString(config.production_url);
  const preparedAt = launch.prepared_at ? new Date(launch.prepared_at) : null;
  const preparedAgeMs = preparedAt ? Date.now() - preparedAt.getTime() : Number.POSITIVE_INFINITY;
  const maxPreparedAgeMs = 30 * 60 * 1000;
  const blockers: string[] = [];

  if (launch.status !== "prepared") blockers.push("Launch request must be prepared before execution.");
  if (launch.audit_status !== "passed") blockers.push("A saved passing production audit is required.");
  if (!Array.isArray(launch.critical_blockers) || launch.critical_blockers.length !== 0) {
    blockers.push("Production audit must have zero critical blockers.");
  }
  if (!launch.owner_decision_at) blockers.push("Explicit owner production approval is missing.");
  if (!preparedAt || Number.isNaN(preparedAt.getTime()) || preparedAgeMs > maxPreparedAgeMs) {
    blockers.push("Production preparation is missing or older than 30 minutes. Prepare a new launch request before executing.");
  }
  if (!launch.deployment_record_id) blockers.push("Prepared deployment record is missing.");
  if (launch.netlify_build_id || launch.netlify_deploy_id || launch.execution_started_at) {
    blockers.push("This production launch already has execution identifiers or a start time.");
  }
  if (!productionBranch || productionBranch.toLowerCase() !== configuredProductionBranch.toLowerCase()) {
    blockers.push("Launch production branch does not exactly match the configured production branch.");
  }
  if (!validHttpsUrl(productionUrl)) blockers.push("A valid HTTPS production URL is required.");
  if (!config.auto_publish_locked) blockers.push("Auto publishing must remain recorded as locked before the production build.");
  if (config.last_verification_status !== "passed") blockers.push("Deployment connection verification is not passing.");
  if (!config.github_owner || !config.github_repo) blockers.push("GitHub repository metadata is incomplete.");
  if (!config.netlify_site_id) blockers.push("Netlify site metadata is missing.");
  if (preview.execution_status !== "published" || !cleanString(preview.preview_url)) {
    blockers.push("The approved preview is no longer published with a saved URL.");
  }
  if (
    preview.deployment_config_id !== launch.deployment_config_id ||
    preview.project_id !== launch.project_id ||
    preview.client_id !== launch.client_id
  ) {
    blockers.push("The approved preview no longer matches the production launch request.");
  }
  if (cleanString(preview.source_branch)?.toLowerCase() === configuredProductionBranch.toLowerCase()) {
    blockers.push("The approved preview branch cannot equal the production branch.");
  }
  if (
    deployment.deployment_config_id !== launch.deployment_config_id ||
    deployment.project_id !== launch.project_id ||
    deployment.client_id !== launch.client_id ||
    deployment.deploy_kind !== "production" ||
    cleanString(deployment.branch)?.toLowerCase() !== configuredProductionBranch.toLowerCase() ||
    deployment.status !== "queued" ||
    deployment.netlify_deploy_id
  ) {
    blockers.push("The queued deployment record is not a clean matching production record.");
  }

  if (blockers.length > 0) {
    return jsonResponse(
      {
        ok: false,
        launch_request_id: launch.id,
        blockers,
        production_build_started: false,
        production_published: false,
        note: "Production execution was blocked before any Netlify build call.",
      },
      409
    );
  }

  const githubBranchResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}/branches/${encodeURIComponent(configuredProductionBranch)}`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NXQ-Web-Production-Executor",
      },
    }
  );

  if (!githubBranchResponse.ok) {
    return jsonResponse(
      { error: `GitHub production branch validation failed with HTTP ${githubBranchResponse.status}. No Netlify build was triggered.` },
      409
    );
  }

  const githubBranchData = await githubBranchResponse.json();
  const productionCommitSha = cleanString(githubBranchData?.commit?.sha);
  if (!productionCommitSha) {
    return jsonResponse({ error: "GitHub production branch did not return a commit SHA. No build was triggered." }, 409);
  }

  const netlifySiteResponse = await fetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}`,
    { headers: { Authorization: `Bearer ${netlifyToken}` } }
  );

  if (!netlifySiteResponse.ok) {
    return jsonResponse(
      { error: `Netlify site validation failed with HTTP ${netlifySiteResponse.status}. No build was triggered.` },
      409
    );
  }

  const netlifySiteData = await netlifySiteResponse.json();
  const netlifyProductionBranch =
    cleanString(netlifySiteData?.build_settings?.repo_branch) || cleanString(netlifySiteData?.repo?.branch);

  if (netlifyProductionBranch && netlifyProductionBranch.toLowerCase() !== configuredProductionBranch.toLowerCase()) {
    return jsonResponse(
      {
        error: `Netlify reports production branch ${netlifyProductionBranch}, but NXQ is configured for ${configuredProductionBranch}. No build was triggered.`,
      },
      409
    );
  }

  const transitionAt = new Date().toISOString();
  const transitionResult = await supabase
    .from("production_launch_requests")
    .update({
      status: "launching",
      execution_started_at: transitionAt,
      error_message: null,
    })
    .eq("id", launch.id)
    .eq("status", "prepared")
    .is("netlify_build_id", null)
    .is("netlify_deploy_id", null)
    .is("execution_started_at", null)
    .select("id, status, execution_started_at")
    .maybeSingle();

  if (transitionResult.error || !transitionResult.data) {
    return jsonResponse(
      {
        error:
          transitionResult.error?.message ||
          "Production launch changed before execution. No Netlify build was triggered.",
      },
      409
    );
  }

  await supabase
    .from("project_deployments")
    .update({
      status: "building",
      started_at: transitionAt,
      git_commit_sha: productionCommitSha,
      error_message: null,
    })
    .eq("id", launch.deployment_record_id)
    .eq("status", "queued");

  const buildUrl = new URL(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}/builds`
  );
  buildUrl.searchParams.set("branch", configuredProductionBranch);
  buildUrl.searchParams.set("clear_cache", "false");
  buildUrl.searchParams.set("title", `NXQ owner-approved production build: ${configuredProductionBranch}`);

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
    const completedAt = new Date().toISOString();

    await supabase
      .from("production_launch_requests")
      .update({ status: "failed", error_message: message, execution_completed_at: completedAt })
      .eq("id", launch.id)
      .eq("status", "launching");

    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: message, completed_at: completedAt })
      .eq("id", launch.deployment_record_id);

    return jsonResponse({ error: `Netlify production build request failed: ${message}` }, 502);
  }

  const responseText = await buildResponse.text();
  let buildData: Record<string, unknown> = {};
  try {
    buildData = responseText ? JSON.parse(responseText) : {};
  } catch {
    buildData = { raw_response: responseText };
  }

  if (!buildResponse.ok) {
    const message = `Netlify production build request failed with HTTP ${buildResponse.status}.`;
    const completedAt = new Date().toISOString();

    await supabase
      .from("production_launch_requests")
      .update({ status: "failed", error_message: message, execution_completed_at: completedAt })
      .eq("id", launch.id)
      .eq("status", "launching");

    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: message, completed_at: completedAt })
      .eq("id", launch.deployment_record_id);

    return jsonResponse({ error: message, netlify: buildData }, 502);
  }

  const buildId = cleanString(buildData.id);
  const deployId = cleanString(buildData.deploy_id);
  if (!buildId) {
    const message = "Netlify accepted the production build request but did not return a build ID.";
    const completedAt = new Date().toISOString();

    await supabase
      .from("production_launch_requests")
      .update({ status: "failed", error_message: message, execution_completed_at: completedAt })
      .eq("id", launch.id)
      .eq("status", "launching");

    await supabase
      .from("project_deployments")
      .update({ status: "failed", error_message: message, completed_at: completedAt })
      .eq("id", launch.deployment_record_id);

    return jsonResponse({ error: message, netlify: buildData }, 502);
  }

  const saveResult = await supabase
    .from("production_launch_requests")
    .update({
      netlify_build_id: buildId,
      netlify_deploy_id: deployId,
      error_message: null,
    })
    .eq("id", launch.id)
    .eq("status", "launching")
    .select("id, status, execution_started_at, netlify_build_id, netlify_deploy_id")
    .single();

  if (saveResult.error) {
    return jsonResponse(
      {
        error: `Netlify production build started, but saving its identifiers failed: ${saveResult.error.message}`,
        netlify_build_id: buildId,
        netlify_deploy_id: deployId,
      },
      500
    );
  }

  await supabase
    .from("project_deployments")
    .update({ netlify_deploy_id: deployId, status: "building" })
    .eq("id", launch.deployment_record_id);

  return jsonResponse({
    ok: true,
    launch_request_id: launch.id,
    status: "launching",
    branch: configuredProductionBranch,
    production_commit_sha: productionCommitSha,
    netlify_build_id: buildId,
    netlify_deploy_id: deployId,
    production_build_started: true,
    production_published: false,
    auto_publish_recorded_locked: true,
    note:
      "A Netlify build was started from the configured production branch. NXQ has not confirmed or recorded the deploy as published. Publication status must be checked separately.",
  });
});
