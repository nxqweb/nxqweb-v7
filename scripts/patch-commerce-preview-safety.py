from pathlib import Path

P = Path('supabase/functions/provision-storefront/index.ts')
s = P.read_text()

# 1) Add dedicated GitHub preview-branch helper before Netlify provisioning.
if 'async function ensureCommercePreviewBranch(' not in s:
    marker = 'async function createNetlifySite(repositoryFullName: string) {'
    if marker not in s:
        raise SystemExit('Commerce Netlify site function marker missing; refusing ambiguous patch.')
    helper = r'''function commercePreviewBranch(storefrontId: string) {
  const suffix = storefrontId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "storefront";
  return `nxq/commerce-preview-${suffix}`;
}

async function ensureCommercePreviewBranch(repositoryFullName: string, branch: string) {
  if (!branch || branch === "main") throw new Error("Commerce preview branch must be a non-main branch.");
  const token = await githubInstallationToken();
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  const existing = await timedFetch(
    `https://api.github.com/repos/${repositoryFullName}/git/ref/heads/${encodedBranch}`,
    { headers: githubHeaders(token) },
  );
  if (existing.ok) {
    const body = await readJson(existing);
    return { branch, sha: body?.object?.sha || null };
  }
  if (existing.status !== 404) {
    const body = await readJson(existing);
    throw new Error(`GitHub preview branch lookup failed (${existing.status}): ${body?.message || "Unknown GitHub error"}`);
  }

  const mainRefResponse = await timedFetch(
    `https://api.github.com/repos/${repositoryFullName}/git/ref/heads/main`,
    { headers: githubHeaders(token) },
  );
  const mainRef = await readJson(mainRefResponse);
  const mainSha = mainRef?.object?.sha;
  if (!mainRefResponse.ok || typeof mainSha !== "string" || !mainSha) {
    throw new Error(`GitHub main ref lookup failed (${mainRefResponse.status}): ${mainRef?.message || "Missing main SHA"}`);
  }

  const create = await timedFetch(
    `https://api.github.com/repos/${repositoryFullName}/git/refs`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    },
  );
  const created = await readJson(create);
  if (!create.ok) {
    throw new Error(`GitHub preview branch creation failed (${create.status}): ${created?.message || "Unknown GitHub error"}`);
  }
  return { branch, sha: created?.object?.sha || mainSha };
}

'''
    s = s.replace(marker, helper + 'async function createNetlifySite(repositoryFullName: string, previewBranch: string) {', 1)
elif 'async function createNetlifySite(repositoryFullName: string) {' in s:
    s = s.replace('async function createNetlifySite(repositoryFullName: string) {', 'async function createNetlifySite(repositoryFullName: string, previewBranch: string) {', 1)

# 2) Stop builds at link time and allow only the dedicated preview branch in addition to production metadata.
if 'stop_builds: true' not in s:
    needle = '        installation_id: installationId,\n'
    replacement = '        installation_id: installationId,\n        allowed_branches: [previewBranch],\n        stop_builds: true,\n'
    if needle not in s:
        raise SystemExit('Netlify installation marker missing; refusing ambiguous patch.')
    s = s.replace(needle, replacement, 1)

# 3) Add explicit activation helper. Activating builds is separate from triggering the branch build.
if 'async function activateNetlifyBuilds(' not in s:
    marker = 'async function getNetlifySite(siteId: string) {'
    if marker not in s:
        raise SystemExit('getNetlifySite marker missing; refusing ambiguous patch.')
    helper = r'''async function activateNetlifyBuilds(siteId: string, previewBranch: string) {
  if (!previewBranch || previewBranch === "main") throw new Error("Refusing to activate Commerce preview builds for main.");
  const token = requiredSecret("NETLIFY_ACCESS_TOKEN");
  const current = await getNetlifySite(siteId);
  const existing = current?.build_settings && typeof current.build_settings === "object" ? current.build_settings : {};
  const patchResponse = await timedFetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: netlifyHeaders(token),
    body: JSON.stringify({
      build_settings: {
        ...existing,
        allowed_branches: [previewBranch],
        stop_builds: false,
      },
    }),
  });
  const patched = await readJson(patchResponse);
  if (!patchResponse.ok) {
    throw new Error(`Netlify build activation failed (${patchResponse.status}): ${patched?.message || patched?.error || "Unknown Netlify error"}`);
  }
  return patched;
}

'''
    s = s.replace(marker, helper + marker, 1)

# 4) The explicit Netlify build MUST target a non-main branch.
s = s.replace('async function triggerNetlifyBuild(siteId: string, token: string) {', 'async function triggerNetlifyBuild(siteId: string, token: string, previewBranch: string) {', 1)
s = s.replace('`https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=main&clear_cache=true`', '`https://api.netlify.com/api/v1/sites/${siteId}/builds?branch=${encodeURIComponent(previewBranch)}&clear_cache=true`', 1)
if 'async function triggerNetlifyBuild(siteId: string, token: string, previewBranch: string)' not in s:
    raise SystemExit('Could not harden Netlify trigger signature.')

# Add a hard runtime guard inside trigger function.
trigger_marker = 'async function triggerNetlifyBuild(siteId: string, token: string, previewBranch: string) {\n'
if 'Refusing to trigger a Commerce preview build for main.' not in s:
    if trigger_marker not in s:
        raise SystemExit('Trigger function marker missing after signature patch.')
    s = s.replace(trigger_marker, trigger_marker + '  if (!previewBranch || previewBranch === "main") throw new Error("Refusing to trigger a Commerce preview build for main.");\n', 1)

# 5) Preview verification must match the exact branch-deploy, never the latest arbitrary deploy.
s = s.replace('async function checkPreview(siteId: string) {', 'async function checkPreview(siteId: string, previewBranch: string) {', 1)
old_latest = '  const latest = Array.isArray(deploys) ? deploys[0] : null;'
new_latest = '''  const latest = Array.isArray(deploys)
    ? deploys.find((deploy: any) => deploy?.branch === previewBranch && deploy?.context === "branch-deploy") || null
    : null;'''
if old_latest in s:
    s = s.replace(old_latest, new_latest, 1)
elif new_latest not in s:
    raise SystemExit('Preview latest-deploy selector missing; refusing ambiguous patch.')

# 6) Insert preview-branch checkpoint before Netlify site creation.
old = '''    const repositoryFullName = metadata.github_full_name || `${job.repository_owner}/${job.repository_name}`;

    if (!job.netlify_site_id) {'''
new = '''    const repositoryFullName = metadata.github_full_name || `${job.repository_owner}/${job.repository_name}`;
    const previewBranch = typeof metadata.commerce_preview_branch === "string" && metadata.commerce_preview_branch
      ? metadata.commerce_preview_branch
      : commercePreviewBranch(job.storefront_id);

    if (!metadata.commerce_preview_branch) {
      step = "github_preview_branch";
      await saveCheckpoint(admin, job, workerToken, step, "Creating the protected Commerce preview branch.");
      const previewRef = await ensureCommercePreviewBranch(repositoryFullName, previewBranch);
      await admin.from("commerce_storefront_provisioning").update({
        status: "queued",
        provider_metadata: {
          ...metadata,
          github_full_name: repositoryFullName,
          commerce_preview_branch: previewBranch,
          commerce_preview_source_sha: previewRef.sha,
          checkpoint: "preview_branch_ready",
        },
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        lock_token: null,
        last_error: null,
        error_step: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("lock_token", workerToken);
      return response({ ok: true, job_id: job.id, status: "preview_branch_ready" });
    }

    if (!job.netlify_site_id) {'''
if old in s:
    s = s.replace(old, new, 1)
elif 'commerce_preview_branch' not in s[s.find('const repositoryFullName'):]:
    raise SystemExit('Repository-to-Netlify transition marker missing; refusing ambiguous patch.')

# 7) Pass branch into Netlify site creation and retain it in checkpoint metadata.
s = s.replace('const site = await createNetlifySite(repositoryFullName);', 'const site = await createNetlifySite(repositoryFullName, previewBranch);', 1)

# 8) Activate builds only after env setup, then trigger the exact non-main branch.
old = '      await triggerNetlifyBuild(String(job.netlify_site_id), token);'
new = '      await activateNetlifyBuilds(String(job.netlify_site_id), previewBranch);\n      const build = await triggerNetlifyBuild(String(job.netlify_site_id), token, previewBranch);'
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit('Netlify trigger call marker missing; refusing ambiguous patch.')

# Preserve build evidence if the provider returned an id.
needle = '          netlify_build_triggered_at: new Date().toISOString(),\n          checkpoint: "preview_building",'
replacement = '          netlify_build_triggered_at: new Date().toISOString(),\n          netlify_build_id: build?.id || null,\n          commerce_preview_branch: previewBranch,\n          checkpoint: "preview_building",'
if needle in s:
    s = s.replace(needle, replacement, 1)

# 9) Verify exact preview branch on polling.
s = s.replace('const previewUrl = await checkPreview(String(job.netlify_site_id));', 'const previewUrl = await checkPreview(String(job.netlify_site_id), previewBranch);', 1)

# 10) Guard against accidental explicit production build regressions.
if 'builds?branch=main' in s:
    raise SystemExit('Commerce worker still contains an explicit Netlify main-branch build trigger.')

required = [
    'commercePreviewBranch(',
    'ensureCommercePreviewBranch(',
    'stop_builds: true',
    'allowed_branches: [previewBranch]',
    'activateNetlifyBuilds(',
    'previewBranch === "main"',
    'branch=${encodeURIComponent(previewBranch)}',
    'deploy?.branch === previewBranch',
    'deploy?.context === "branch-deploy"',
    'commerce_preview_branch',
]
missing = [x for x in required if x not in s]
if missing:
    raise SystemExit(f'Commerce preview hardening incomplete: {missing}')

P.write_text(s)
print('Commerce provisioning now uses a protected non-main Netlify branch-deploy preview path.')
