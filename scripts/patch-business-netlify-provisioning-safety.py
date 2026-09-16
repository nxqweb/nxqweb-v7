from pathlib import Path

infra_path = Path('supabase/functions/provision-project-infrastructure/index.ts')
build_path = Path('supabase/functions/build-business-website/index.ts')
infra = infra_path.read_text()
build = build_path.read_text()

# Reconcile an already-created deterministic Netlify site before attempting POST creation.
old = '''  const siteName = slugify(repositoryFullName.split("/")[1]);
  const buildCommand = familySlug === "business" ? "" : "npm run build";
  const publishDirectory = familySlug === "business" ? "." : "dist";
  const created = await timedFetch("https://api.netlify.com/api/v1/sites", {
'''
new = '''  const siteName = slugify(repositoryFullName.split("/")[1]);
  const buildCommand = familySlug === "business" ? "" : "npm run build";
  const publishDirectory = familySlug === "business" ? "." : "dist";

  const lookup = await timedFetch(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(siteName)}`, {
    headers: netlifyHeaders(token),
  });
  const lookupBody = await readJson(lookup);
  if (!lookup.ok) {
    throw new Error(`Netlify site reconciliation failed (${lookup.status}).`);
  }
  if (Array.isArray(lookupBody)) {
    const existing = lookupBody.find((item) => {
      if (!item || typeof item !== "object") return false;
      const row = item as JsonRecord;
      const repo = row.build_settings && typeof row.build_settings === "object"
        ? (row.build_settings as JsonRecord).repo_path || (row.build_settings as JsonRecord).repo_url
        : null;
      return row.name === siteName && (repo === repositoryFullName || repo === `https://github.com/${repositoryFullName}`);
    });
    if (existing && typeof existing === "object") return existing as JsonRecord;
  }

  const created = await timedFetch("https://api.netlify.com/api/v1/sites", {
'''
assert old in infra
infra = infra.replace(old, new, 1)

old = '''        public_repo: false,
        installation_id: installationId,
      },
'''
new = '''        public_repo: false,
        installation_id: installationId,
        stop_builds: true,
      },
'''
assert old in infra
infra = infra.replace(old, new, 1)

# The infrastructure stage must never start a production-main build.
start = infra.index('async function triggerBaselineBuild(siteId: string) {')
end = infra.index('\nDeno.serve(async (request) => {', start)
infra = infra[:start] + infra[end+1:]

old = '''    await saveCheckpoint({ checkpoint: "netlify_environment_ready" });

    if (!checkpoint.baseline_build_id) {
      const build = await triggerBaselineBuild(netlifySiteId);
      await saveCheckpoint({
        checkpoint: "baseline_build_started",
        baseline_build_id: typeof build.id === "string" ? build.id : null,
      });
    }

    const completed = await admin.rpc("complete_external_automation_job_v2", {
'''
new = '''    await saveCheckpoint({
      checkpoint: "netlify_environment_ready",
      netlify_builds_stopped: true,
      production_build_started: false,
    });

    const completed = await admin.rpc("complete_external_automation_job_v2", {
'''
assert old in infra
infra = infra.replace(old, new, 1)

# Build worker: only activate builds for a verified non-main source branch immediately
# before requesting that branch preview.
anchor = '''async function triggerBranchBuild(siteId: string, branch: string) {
'''
assert anchor in build
helper = '''async function activatePreviewBuilds(siteId: string, branch: string) {
  if (!branch || branch === "main") throw new Error("Refusing to activate preview builds for main.");
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const currentRes = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    headers: netlifyHeaders(token),
  });
  const current = await readJson(currentRes);
  if (!currentRes.ok || !current || Array.isArray(current)) throw new Error(`Netlify site lookup failed (${currentRes.status}).`);
  const buildSettings = current.build_settings && typeof current.build_settings === "object"
    ? current.build_settings as JsonRecord
    : {};
  const patchRes = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: netlifyHeaders(token),
    body: JSON.stringify({
      build_settings: {
        ...buildSettings,
        allowed_branches: [branch],
        stop_builds: false,
      },
    }),
  });
  const patched = await readJson(patchRes);
  if (!patchRes.ok) throw new Error(`Netlify preview build activation failed (${patchRes.status}): ${String((patched as JsonRecord | null)?.message || "Unknown Netlify error")}`);
}

'''
build = build.replace(anchor, helper + anchor, 1)

old = '''  await updateStep(admin, runId, "prepare_preview_request", "running");
  const build = await triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch);
'''
new = '''  await updateStep(admin, runId, "prepare_preview_request", "running");
  await activatePreviewBuilds(configRes.data.netlify_site_id, sourceBranch);
  const build = await triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch);
'''
assert old in build
build = build.replace(old, new, 1)

assert 'triggerBaselineBuild' not in infra
assert 'builds?branch=main' not in infra
assert 'stop_builds: true' in infra
assert 'sites?name=' in infra
assert 'activatePreviewBuilds' in build
assert 'allowed_branches: [branch]' in build

infra_path.write_text(infra)
build_path.write_text(build)
print('Patched Business Netlify reconciliation and preview-only activation.')
