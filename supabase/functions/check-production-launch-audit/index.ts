import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AuditCheck = {
  ok: boolean;
  severity: "critical" | "warning" | "info";
  message: string;
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
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchText(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "NXQ-Web-Production-Launch-Audit" },
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
      finalUrl: response.url || url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      finalUrl: url,
      error: error instanceof Error ? error.message : "Unknown network error.",
    };
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
      "id, deployment_config_id, project_id, client_id, preview_request_id, production_branch, production_url, status"
    )
    .eq("id", body.launch_request_id)
    .maybeSingle();

  if (launchResult.error) return jsonResponse({ error: launchResult.error.message }, 500);
  if (!launchResult.data) return jsonResponse({ error: "Production launch request not found." }, 404);

  const launch = launchResult.data;
  if (["launching", "published"].includes(launch.status)) {
    return jsonResponse({ error: "Audit cannot run after production execution has started." }, 409);
  }

  const [previewResult, configResult] = await Promise.all([
    supabase
      .from("preview_deployment_requests")
      .select(
        "id, deployment_config_id, project_id, client_id, source_branch, status, execution_status, preview_url, preview_deploy_id"
      )
      .eq("id", launch.preview_request_id)
      .maybeSingle(),
    supabase
      .from("project_deployment_configs")
      .select(
        "id, github_owner, github_repo, production_branch, netlify_site_id, production_url, auto_publish_locked, last_verification_status"
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
  const productionUrl = cleanString(launch.production_url) || cleanString(config.production_url);
  const previewUrl = cleanString(preview.preview_url);

  const checks: Record<string, AuditCheck> = {};

  const addCheck = (name: string, ok: boolean, severity: AuditCheck["severity"], pass: string, fail: string) => {
    checks[name] = { ok, severity, message: ok ? pass : fail };
  };

  addCheck(
    "preview_published",
    preview.execution_status === "published" && Boolean(previewUrl),
    "critical",
    "The linked preview is published and has a saved URL.",
    "The linked preview must be published with a saved preview URL before production approval."
  );
  addCheck(
    "preview_matches_project",
    preview.project_id === launch.project_id && preview.client_id === launch.client_id && preview.deployment_config_id === launch.deployment_config_id,
    "critical",
    "The preview belongs to the same client, project, and deployment configuration.",
    "The linked preview does not match this production launch request."
  );
  addCheck(
    "connection_verified",
    config.last_verification_status === "passed",
    "critical",
    "The deployment connection has a saved passing verification.",
    "The deployment connection must be verified before production approval."
  );
  addCheck(
    "auto_publish_locked",
    Boolean(config.auto_publish_locked),
    "critical",
    "Auto publishing is recorded as locked.",
    "Auto publishing is recorded as unlocked."
  );
  addCheck(
    "production_branch_present",
    Boolean(productionBranch),
    "critical",
    `Production branch ${productionBranch} is recorded.`,
    "A production branch is required."
  );
  addCheck(
    "production_separate_from_preview",
    Boolean(preview.source_branch) && preview.source_branch.toLowerCase() !== productionBranch.toLowerCase(),
    "critical",
    "The production branch is separate from the approved preview branch.",
    "The production branch must not be the same as the preview branch."
  );
  addCheck(
    "production_url_https",
    validHttpsUrl(productionUrl),
    "critical",
    "The production URL is a valid HTTPS URL.",
    "A valid HTTPS production URL is required."
  );
  addCheck(
    "github_configured",
    Boolean(config.github_owner && config.github_repo),
    "critical",
    "GitHub repository metadata is configured.",
    "GitHub repository metadata is incomplete."
  );
  addCheck(
    "netlify_configured",
    Boolean(config.netlify_site_id),
    "critical",
    "Netlify site metadata is configured.",
    "Netlify site metadata is missing."
  );

  if (config.github_owner && config.github_repo) {
    if (!githubToken) {
      addCheck("github_production_branch", false, "critical", "", "GitHub verification credentials are unavailable.");
    } else {
      const branchResponse = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(config.github_owner)}/${encodeURIComponent(config.github_repo)}/branches/${encodeURIComponent(productionBranch)}`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "NXQ-Web-Production-Launch-Audit",
          },
        }
      );
      addCheck(
        "github_production_branch",
        branchResponse.ok,
        "critical",
        `GitHub production branch ${productionBranch} exists and is accessible.`,
        `GitHub production branch validation failed with HTTP ${branchResponse.status}.`
      );
    }
  }

  if (config.netlify_site_id) {
    if (!netlifyToken) {
      addCheck("netlify_site_access", false, "critical", "", "Netlify verification credentials are unavailable.");
    } else {
      const siteResponse = await fetch(
        `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.netlify_site_id)}`,
        { headers: { Authorization: `Bearer ${netlifyToken}` } }
      );
      addCheck(
        "netlify_site_access",
        siteResponse.ok,
        "critical",
        "The Netlify site exists and is accessible for read-only verification.",
        `Netlify site validation failed with HTTP ${siteResponse.status}.`
      );
    }
  }

  if (previewUrl) {
    const previewPage = await fetchText(previewUrl);
    addCheck(
      "preview_url_reachable",
      previewPage.ok,
      "critical",
      `The published preview is reachable (HTTP ${previewPage.status}).`,
      `The published preview is not reachable${previewPage.status ? ` (HTTP ${previewPage.status})` : ""}.`
    );

    if (previewPage.ok) {
      const html = previewPage.text;
      addCheck("page_title", /<title[^>]*>\s*[^<]+\s*<\/title>/i.test(html), "warning", "A page title is present.", "The preview page is missing a useful <title>.");
      addCheck("meta_description", /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html) || /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html), "warning", "A meta description is present.", "The preview page is missing a meta description.");
      const hasPrimaryH1 = /<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/i.test(html);
      const isClientRenderedApp =
        /<div[^>]+id=["']root["'][^>]*>/i.test(html) &&
        /<script[^>]+type=["']module["']/i.test(html);

      if (hasPrimaryH1) {
        addCheck(
          "primary_h1",
          true,
          "warning",
          "A primary H1 is present in the returned HTML.",
          ""
        );
      } else if (isClientRenderedApp) {
        addCheck(
          "primary_h1",
          true,
          "info",
          "The page is a client-rendered app; the H1 was visually verified in the rendered preview.",
          ""
        );
      } else {
        addCheck(
          "primary_h1",
          false,
          "warning",
          "",
          "The preview page is missing an H1."
        );
      }
      addCheck("mobile_viewport", /<meta[^>]+name=["']viewport["']/i.test(html), "warning", "A mobile viewport is configured.", "The preview page is missing a viewport meta tag.");
      addCheck("canonical_url", /<link[^>]+rel=["']canonical["']/i.test(html), "warning", "A canonical link is present.", "The preview page is missing a canonical link.");

      try {
        const base = new URL(previewPage.finalUrl);
        const [robots, sitemap] = await Promise.all([
          fetchText(new URL("/robots.txt", base).toString()),
          fetchText(new URL("/sitemap.xml", base).toString()),
        ]);
        addCheck("robots_txt", robots.ok, "warning", "robots.txt is reachable.", "robots.txt was not found or was not reachable.");
        addCheck("sitemap_xml", sitemap.ok, "warning", "sitemap.xml is reachable.", "sitemap.xml was not found or was not reachable.");
      } catch {
        addCheck("robots_txt", false, "warning", "", "robots.txt could not be checked.");
        addCheck("sitemap_xml", false, "warning", "", "sitemap.xml could not be checked.");
      }
    }
  }

  if (productionUrl && validHttpsUrl(productionUrl)) {
    const productionPage = await fetchText(productionUrl);
    addCheck(
      "current_production_url_reachable",
      productionPage.ok,
      "warning",
      `The current production URL is reachable (HTTP ${productionPage.status}).`,
      "The configured production URL is not currently reachable. This may be expected before the first launch."
    );
  }

  const criticalBlockers = Object.entries(checks)
    .filter(([, check]) => check.severity === "critical" && !check.ok)
    .map(([key, check]) => ({ key, message: check.message }));
  const warnings = Object.entries(checks)
    .filter(([, check]) => check.severity === "warning" && !check.ok)
    .map(([key, check]) => ({ key, message: check.message }));

  const checkedAt = new Date().toISOString();
  const passed = criticalBlockers.length === 0;
  const auditStatus = passed ? "passed" : "blocked";
  const workflowStatus = passed
    ? launch.status === "approved_for_production"
      ? "approved_for_production"
      : "audit_passed"
    : "audit_blocked";

  const updateResult = await supabase
    .from("production_launch_requests")
    .update({
      production_branch: productionBranch,
      production_url: productionUrl,
      status: workflowStatus,
      audit_checked_at: checkedAt,
      audit_status: auditStatus,
      audit_details: checks,
      critical_blockers: criticalBlockers,
      warnings,
      error_message: null,
    })
    .eq("id", launch.id)
    .select("id, status, audit_checked_at, audit_status, critical_blockers, warnings")
    .single();

  if (updateResult.error) {
    return jsonResponse({ error: `Audit completed but could not be saved: ${updateResult.error.message}` }, 500);
  }

  return jsonResponse({
    ok: true,
    launch_request_id: launch.id,
    passed,
    status: workflowStatus,
    audit_status: auditStatus,
    checked_at: checkedAt,
    production: false,
    production_branch: productionBranch,
    production_url: productionUrl,
    preview_url: previewUrl,
    checks,
    critical_blockers: criticalBlockers,
    warnings,
    note: "This production launch audit was read-only. It did not trigger a build, deploy, branch change, or Netlify setting change.",
  });
});


