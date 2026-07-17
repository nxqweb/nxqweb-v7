import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CheckResult = {
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

async function checkProductionUrl(url: string | null): Promise<CheckResult> {
  if (!url) {
    return {
      ok: false,
      status: "not_configured",
      message: "Production URL is not configured.",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 405) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    }

    clearTimeout(timeout);

    if (response.ok) {
      return {
        ok: true,
        status: "pass",
        message: `Production URL responded with HTTP ${response.status}.`,
      };
    }

    return {
      ok: false,
      status: "fail",
      message: `Production URL responded with HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "fail",
      message: error instanceof Error ? error.message : "Production URL check failed.",
    };
  }
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

  const userResult = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));

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

  let body: { config_id?: string };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!body.config_id) {
    return jsonResponse({ error: "config_id is required." }, 400);
  }

  const configResult = await supabase
    .from("project_deployment_configs")
    .select(
      "id, project_id, client_id, github_owner, github_repo, production_branch, netlify_site_id, production_url, auto_publish_locked"
    )
    .eq("id", body.config_id)
    .maybeSingle();

  if (configResult.error) {
    return jsonResponse({ error: configResult.error.message }, 500);
  }

  if (!configResult.data) {
    return jsonResponse({ error: "Deployment configuration not found." }, 404);
  }

  const config = configResult.data;

  let githubRepository: CheckResult = {
    ok: false,
    status: "not_configured",
    message: "GitHub repository is not configured.",
  };

  let githubBranch: CheckResult = {
    ok: false,
    status: "not_configured",
    message: "GitHub branch is not configured.",
  };

  if (config.github_owner && config.github_repo) {
    const githubHeaders: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NXQ-Web-Connection-Verifier",
    };

    if (githubToken) {
      githubHeaders.Authorization = `Bearer ${githubToken}`;
    }

    const repositoryResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}`,
      { headers: githubHeaders }
    );

    githubRepository = repositoryResponse.ok
      ? {
          ok: true,
          status: "pass",
          message: "GitHub repository exists and is accessible.",
        }
      : {
          ok: false,
          status: "fail",
          message: githubToken
            ? `GitHub repository check failed with HTTP ${repositoryResponse.status}.`
            : `GitHub repository check failed with HTTP ${repositoryResponse.status}. Add NXQ_GITHUB_VERIFY_TOKEN for private repositories.`,
        };

    if (repositoryResponse.ok && config.production_branch) {
      const branchResponse = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}/branches/${encodeURIComponent(config.production_branch)}`,
        { headers: githubHeaders }
      );

      githubBranch = branchResponse.ok
        ? {
            ok: true,
            status: "pass",
            message: `Branch ${config.production_branch} exists.`,
          }
        : {
            ok: false,
            status: "fail",
            message: `Branch check failed with HTTP ${branchResponse.status}.`,
          };
    } else if (!repositoryResponse.ok && config.production_branch) {
      githubBranch = {
        ok: false,
        status: "fail",
        message: `Branch ${config.production_branch} was not checked because the repository could not be accessed.`,
      };
    }
  }

  let netlifySite: CheckResult = {
    ok: false,
    status: "not_configured",
    message: "Netlify site ID is not configured.",
  };

  if (config.netlify_site_id) {
    if (!netlifyToken) {
      netlifySite = {
        ok: false,
        status: "not_configured",
        message: "NXQ_NETLIFY_VERIFY_TOKEN is not configured in Supabase secrets.",
      };
    } else {
      const siteResponse = await fetch(
        `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}`,
        {
          headers: {
            Authorization: `Bearer ${netlifyToken}`,
            "User-Agent": "NXQ-Web-Connection-Verifier",
          },
        }
      );

      netlifySite = siteResponse.ok
        ? {
            ok: true,
            status: "pass",
            message: "Netlify site exists and is accessible.",
          }
        : {
            ok: false,
            status: "fail",
            message: `Netlify site check failed with HTTP ${siteResponse.status}.`,
          };
    }
  }

  const productionUrl = await checkProductionUrl(config.production_url);
  const checks = {
    github_repository: githubRepository,
    github_branch: githubBranch,
    netlify_site: netlifySite,
    production_url: productionUrl,
    auto_publish_locked: {
      ok: Boolean(config.auto_publish_locked),
      status: config.auto_publish_locked ? "pass" : "fail",
      message: config.auto_publish_locked
        ? "Auto publishing is recorded as locked."
        : "Auto publishing is recorded as unlocked.",
    } satisfies CheckResult,
  };

  const verified = Object.values(checks).every((check) => check.status === "pass");
  const checkedAt = new Date().toISOString();
  const verificationStatus = verified ? "passed" : "needs_attention";

  const persistenceResult = await supabase
    .from("project_deployment_configs")
    .update({
      last_verified_at: checkedAt,
      last_verification_status: verificationStatus,
      last_verification_details: checks,
    })
    .eq("id", config.id);

  if (persistenceResult.error) {
    return jsonResponse(
      {
        error: `Verification completed but could not be saved: ${persistenceResult.error.message}`,
        verified,
        checked_at: checkedAt,
        checks,
      },
      500
    );
  }

  return jsonResponse({
    ok: true,
    config_id: config.id,
    project_id: config.project_id,
    client_id: config.client_id,
    verified,
    checked_at: checkedAt,
    verification_status: verificationStatus,
    checks,
    note: "Verification is read-only. No repository, branch, Netlify site, or deployment was changed.",
  });
});
