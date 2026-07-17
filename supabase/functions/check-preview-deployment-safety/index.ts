import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SafetyCheck = {
  ok: boolean;
  status: "pass" | "fail" | "not_configured";
  message: string;
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

function staticCheck(ok: boolean, passMessage: string, failMessage: string): SafetyCheck {
  return {
    ok,
    status: ok ? "pass" : "fail",
    message: ok ? passMessage : failMessage,
  };
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
      "id, deployment_config_id, project_id, client_id, source_branch, requested_commit_sha, status"
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
      "id, github_owner, github_repo, production_branch, netlify_site_id, auto_publish_locked, last_verification_status"
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

  const checks: Record<string, SafetyCheck> = {
    owner_approval: staticCheck(
      previewRequest.status === "approved_for_preview",
      "Preview request has explicit owner approval.",
      `Preview request status is ${previewRequest.status}; approved_for_preview is required.`
    ),
    source_branch_present: staticCheck(
      sourceBranch.length > 0,
      "A preview source branch is recorded.",
      "Preview source branch is missing."
    ),
    source_branch_not_main: staticCheck(
      sourceBranch.toLowerCase() !== "main",
      "Preview source branch is not main.",
      "The main branch cannot be used for preview deployment."
    ),
    source_branch_not_production: staticCheck(
      sourceBranch.toLowerCase() !== productionBranch.toLowerCase(),
      "Preview source branch is separate from the production branch.",
      "The configured production branch cannot be used for preview deployment."
    ),
    auto_publish_locked: staticCheck(
      Boolean(config.auto_publish_locked),
      "Auto publishing is recorded as locked.",
      "Auto publishing is recorded as unlocked."
    ),
    connection_verified: staticCheck(
      config.last_verification_status === "passed",
      "The deployment connection has a saved passing verification.",
      "The deployment connection does not have a saved passing verification."
    ),
    github_configured: {
      ok: Boolean(config.github_owner && config.github_repo),
      status: config.github_owner && config.github_repo ? "pass" : "not_configured",
      message:
        config.github_owner && config.github_repo
          ? "GitHub repository metadata is configured."
          : "GitHub repository metadata is not configured.",
    },
    netlify_configured: {
      ok: Boolean(config.netlify_site_id),
      status: config.netlify_site_id ? "pass" : "not_configured",
      message: config.netlify_site_id
        ? "Netlify site metadata is configured."
        : "Netlify site metadata is not configured.",
    },
  };

  if (config.github_owner && config.github_repo) {
    if (!githubToken) {
      checks.github_source_branch = {
        ok: false,
        status: "not_configured",
        message: "NXQ_GITHUB_VERIFY_TOKEN is not configured.",
      };
    } else {
      const githubHeaders = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NXQ-Web-Preview-Safety-Guard",
      };

      const branchResponse = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}/branches/${encodeURIComponent(sourceBranch)}`,
        { headers: githubHeaders }
      );

      checks.github_source_branch = branchResponse.ok
        ? {
            ok: true,
            status: "pass",
            message: `GitHub source branch ${sourceBranch} exists and is accessible.`,
          }
        : {
            ok: false,
            status: "fail",
            message: `GitHub source branch check failed with HTTP ${branchResponse.status}.`,
          };

      if (previewRequest.requested_commit_sha) {
        const commitResponse = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}/commits/${encodeURIComponent(previewRequest.requested_commit_sha)}`,
          { headers: githubHeaders }
        );

        checks.requested_commit = commitResponse.ok
          ? {
              ok: true,
              status: "pass",
              message: "Requested commit exists and is accessible.",
            }
          : {
              ok: false,
              status: "fail",
              message: `Requested commit check failed with HTTP ${commitResponse.status}.`,
            };
      } else {
        checks.requested_commit = {
          ok: true,
          status: "pass",
          message: "No commit was pinned; a future preview action would use the source branch head.",
        };
      }
    }
  }

  if (config.netlify_site_id) {
    if (!netlifyToken) {
      checks.netlify_site_access = {
        ok: false,
        status: "not_configured",
        message: "NXQ_NETLIFY_VERIFY_TOKEN is not configured.",
      };
    } else {
      const siteResponse = await fetch(
        `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}`,
        {
          headers: {
            Authorization: `Bearer ${netlifyToken}`,
            "User-Agent": "NXQ-Web-Preview-Safety-Guard",
          },
        }
      );

      checks.netlify_site_access = siteResponse.ok
        ? {
            ok: true,
            status: "pass",
            message: "Netlify site exists and is accessible for read-only validation.",
          }
        : {
            ok: false,
            status: "fail",
            message: `Netlify site validation failed with HTTP ${siteResponse.status}.`,
          };
    }
  }

  const passed = Object.values(checks).every((check) => check.status === "pass");
  const checkedAt = new Date().toISOString();
  const safetyStatus = passed ? "passed" : "needs_attention";

  const persistenceResult = await supabase
    .from("preview_deployment_requests")
    .update({
      safety_checked_at: checkedAt,
      safety_status: safetyStatus,
      safety_details: checks,
    })
    .eq("id", previewRequest.id);

  if (persistenceResult.error) {
    return jsonResponse(
      {
        error: `Safety check completed but could not be saved: ${persistenceResult.error.message}`,
        passed,
        checked_at: checkedAt,
        checks,
      },
      500
    );
  }

  return jsonResponse({
    ok: true,
    request_id: previewRequest.id,
    project_id: previewRequest.project_id,
    client_id: previewRequest.client_id,
    passed,
    checked_at: checkedAt,
    safety_status: safetyStatus,
    checks,
    note: "This was a read-only safety check. No GitHub, Netlify, preview, or production deployment was changed.",
  });
});
