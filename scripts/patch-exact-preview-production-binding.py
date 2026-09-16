from pathlib import Path

build_path = Path('supabase/functions/build-business-website/index.ts')
prod_path = Path('supabase/functions/promote-business-production/index.ts')

build = build_path.read_text()
prod = prod_path.read_text()

old = '''async function findReadyBranchDeploy(siteId: string, branch: string) {
'''
new = '''async function findReadyBranchDeploy(siteId: string, branch: string, expectedCommitSha: string) {
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  const deploy = body.find((item: JsonRecord) => item.branch === branch || item.context === `branch-deploy` && item.branch === branch);
'''
new = '''  const deploy = body.find((item: JsonRecord) =>
    item.branch === branch
    && item.commit_ref === expectedCommitSha
    && (item.context === "branch-deploy" || item.branch === branch)
  );
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  return {
    id: String(deploy.id || ""),
    url: String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || ""),
  };
'''
new = '''  return {
    id: String(deploy.id || ""),
    url: String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || ""),
    commitSha: String(deploy.commit_ref || ""),
  };
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  await upsertRepoFile(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, "site.config.js", encodeBase64(generatedConfig), token, "NXQ: generate client website config");
  await updateStep(admin, runId, "generate_website_draft", "completed", { blueprint: "business-v1" });
'''
new = '''  await upsertRepoFile(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, "site.config.js", encodeBase64(generatedConfig), token, "NXQ: generate client website config");
  const expectedPreviewCommitSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, sourceBranch, token);
  if (!expectedPreviewCommitSha) throw new Error("Generated preview branch commit could not be resolved.");
  await updateStep(admin, runId, "generate_website_draft", "completed", { blueprint: "business-v1", expected_preview_commit_sha: expectedPreviewCommitSha });
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  await updateStep(admin, runId, "run_quality_checks", "completed", quality);

  await updateStep(admin, runId, "prepare_preview_request", "running");
'''
new = '''  await updateStep(admin, runId, "run_quality_checks", "completed", { ...quality, expected_preview_commit_sha: expectedPreviewCommitSha });

  await updateStep(admin, runId, "prepare_preview_request", "running");
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  await updateStep(admin, runId, "prepare_preview_request", "completed", { branch: sourceBranch, netlify_build_id: build?.id || null });
'''
new = '''  await updateStep(admin, runId, "prepare_preview_request", "completed", { branch: sourceBranch, netlify_build_id: build?.id || null, expected_preview_commit_sha: expectedPreviewCommitSha });
'''
assert old in build
build = build.replace(old, new, 1)

old = '''    target_payload: { execution_target: "edge", website_automation_run_id: runId, source_branch: sourceBranch, netlify_site_id: configRes.data.netlify_site_id },
'''
new = '''    target_payload: { execution_target: "edge", website_automation_run_id: runId, source_branch: sourceBranch, netlify_site_id: configRes.data.netlify_site_id, expected_preview_commit_sha: expectedPreviewCommitSha },
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  const siteId = String(payload.netlify_site_id || "");
  if (!runId || !branch || !siteId) throw new Error("Preview check job is missing run, branch, or site id.");

  const deploy = await findReadyBranchDeploy(siteId, branch);
'''
new = '''  const siteId = String(payload.netlify_site_id || "");
  const expectedPreviewCommitSha = String(payload.expected_preview_commit_sha || "");
  if (!runId || !branch || !siteId || !expectedPreviewCommitSha) throw new Error("Preview check job is missing run, branch, site id, or expected commit.");

  const deploy = await findReadyBranchDeploy(siteId, branch, expectedPreviewCommitSha);
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  await updateStep(admin, runId, "client_review", "completed", { automatic_preview_validation: true, preview_url: deploy.url });

  return { run_id: runId, preview_url: deploy.url, netlify_deploy_id: deploy.id, status: "preview_ready" };
'''
new = '''  if (deploy.commitSha !== expectedPreviewCommitSha) throw new Error("Netlify preview commit does not match the generated source commit.");
  await updateStep(admin, runId, "client_review", "completed", {
    automatic_preview_validation: true,
    preview_url: deploy.url,
    netlify_deploy_id: deploy.id,
    verified_preview_commit_sha: expectedPreviewCommitSha,
  });

  return { run_id: runId, preview_url: deploy.url, netlify_deploy_id: deploy.id, verified_preview_commit_sha: expectedPreviewCommitSha, status: "preview_ready" };
'''
assert old in build
build = build.replace(old, new, 1)

old = '''  const previewUrl = String((previewRes.data?.output as JsonRecord | null)?.preview_url || "");
  if (previewRes.data?.status !== "completed" || !previewUrl.startsWith("https://")) throw new Error("A verified HTTPS preview is required before production.");
'''
new = '''  const previewOutput = (previewRes.data?.output as JsonRecord | null) || {};
  const previewUrl = String(previewOutput.preview_url || "");
  const verifiedPreviewCommitSha = String(previewOutput.verified_preview_commit_sha || "");
  if (previewRes.data?.status !== "completed" || !previewUrl.startsWith("https://") || !verifiedPreviewCommitSha) throw new Error("A verified HTTPS preview bound to an exact commit is required before production.");
'''
assert old in prod
prod = prod.replace(old, new, 1)

old = '''  const sourceSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, runRes.data.source_branch, token);
  const mainSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, "main", token);
'''
new = '''  const sourceSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, runRes.data.source_branch, token);
  if (!sourceSha || sourceSha !== verifiedPreviewCommitSha) {
    throw new Error("Production source branch moved after preview verification. A fresh preview is required before launch.");
  }
  const mainSha = await getBranchSha(configRes.data.github_owner, configRes.data.github_repo, "main", token);
'''
assert old in prod
prod = prod.replace(old, new, 1)

old = '''    source_commit: sourceSha,
    previous_main_commit: mainSha,
'''
new = '''    source_commit: sourceSha,
    verified_preview_commit: verifiedPreviewCommitSha,
    exact_preview_commit_bound: sourceSha === verifiedPreviewCommitSha,
    previous_main_commit: mainSha,
'''
assert old in prod
prod = prod.replace(old, new, 1)

build_path.write_text(build)
prod_path.write_text(prod)
print('Patched exact preview-to-production commit binding.')
