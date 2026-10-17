import fs from "node:fs";
import path from "node:path";
import { edgeFunctionManifest } from "./edge-function-manifest.mjs";

const root = process.cwd();
const failures = [];
const check = (ok, message) => {
  if (ok) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures.push(message); }
};
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const workflow = read(".github", "workflows", "runtime-worker-dispatch.yml");
const wakeNames = [...workflow.matchAll(/^\s*wake\s+([a-z0-9-]+)\s+\d+/gm)].map((match) => match[1]);
const uniqueWakeNames = [...new Set(wakeNames)];
const manifestByName = new Map(edgeFunctionManifest.map((item) => [item.name, item]));

check(uniqueWakeNames.length >= 14, `fallback enumerates ${uniqueWakeNames.length} runtime lanes`);
for (const name of uniqueWakeNames) {
  const item = manifestByName.get(name);
  check(Boolean(item), `${name} is declared in the Edge manifest`);
  if (!item) continue;
  check(item.verifyJwt === false, `${name} can reach source-level worker auth without gateway JWT rejection`);
  check(
    item.authBoundary === "worker-token" || item.authBoundary === "trusted-worker-or-owner",
    `${name} has a worker-capable source-level authentication boundary`,
  );
  const source = read("supabase", "functions", name, "index.ts");
  check(source.includes("x-nxq-worker-token"), `${name} source checks the protected worker token`);
}

check(workflow.includes("failures=0"), "fallback accumulates lane failures");
check(workflow.includes("if ! curl"), "fallback continues after an individual wake failure");
check(workflow.includes("every configured lane was attempted"), "fallback reports failure only after all lanes are attempted");
check(workflow.includes("--connect-timeout 15") && workflow.includes("--max-time 60"), "fallback requests are bounded by connection and request timeouts");

const functionsDir = path.join(root, "supabase", "functions");
for (const dirent of fs.readdirSync(functionsDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const file = path.join(functionsDir, dirent.name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");

  if (source.includes("GITHUB_APP_PRIVATE_KEY") && source.includes("importPKCS8")) {
    check(
      source.includes("normalizeGithubPrivateKey") && source.includes("importPKCS8(normalizeGithubPrivateKey("),
      `${dirent.name} normalizes PKCS#1/PKCS#8 GitHub App private keys`,
    );
  }
  if (/force\s*:\s*true/.test(source)) check(false, `${dirent.name} contains a force:true provider write`);

  // Every awaited raw fetch must be isolated inside one bounded network helper. A file
  // with a helper plus another raw await fetch is exactly the maintenance bug this audit
  // is designed to prevent.
  const rawAwaitFetches = [...source.matchAll(/await\s+fetch\s*\(/g)].length;
  if (rawAwaitFetches > 0) {
    const signalledFetches = [...source.matchAll(/signal\s*:/g)].length;
    const hasBoundedHelper =
      source.includes("async function timedFetch(") ||
      source.includes("async function boundedProviderFetch(") ||
      source.includes("async function fetchWithTimeout(") ||
      (source.includes("AbortController") && source.includes(".abort()") && signalledFetches >= rawAwaitFetches);
    check(hasBoundedHelper, `${dirent.name} defines a bounded network helper for raw fetch`);
    check(signalledFetches >= rawAwaitFetches, `${dirent.name} has no raw awaited fetch without an abort signal`);
  }
}

const storefront = read("supabase", "functions", "provision-storefront", "index.ts");
const storefrontSafety = [
  [!storefront.includes("builds?branch=main"), "Commerce preview worker has no explicit main-branch Netlify build trigger"],
  [storefront.includes("commercePreviewBranch("), "Commerce preview worker derives a dedicated preview branch"],
  [storefront.includes("stop_builds: true"), "Commerce Netlify site starts with builds stopped"],
  [storefront.includes("allowed_branches: [previewBranch]"), "Commerce Netlify config limits branch builds to the dedicated preview branch"],
  [storefront.includes('previewBranch === "main"'), "Commerce preview code has explicit main-branch refusal guards"],
  [storefront.includes('candidate.context === "branch-deploy"'), "Commerce preview readiness requires branch-deploy context"],
  [storefront.includes("workerAuthorized = protectedTokenMatches"), "Commerce source enforces protected worker token before background access"],
  [storefront.includes("if (!workerAuthorized)"), "Commerce retains guarded owner-session fallback"],
];
for (const [ok, message] of storefrontSafety) check(ok, message);

const infrastructure = read("supabase", "functions", "provision-project-infrastructure", "index.ts");
check(infrastructure.includes("stop_builds: true"), "new Business Netlify sites start with builds stopped");
check(!infrastructure.includes("builds?branch=main"), "infrastructure provisioning cannot spend a production-main deploy before preview");
check(!infrastructure.includes("triggerBaselineBuild("), "infrastructure provisioning has no baseline production build path");

const businessBuilder = read("supabase", "functions", "build-business-website", "index.ts");
check(businessBuilder.includes("activatePreviewBuilds("), "Business preview worker explicitly activates builds only when preview generation is ready");
check(businessBuilder.includes("triggerBranchBuild(configRes.data.netlify_site_id, sourceBranch)"), "Business preview worker explicitly targets its safe source branch");
check(!businessBuilder.includes("builds?branch=main"), "Business preview worker cannot explicitly build production main");
check(businessBuilder.includes('defer_external_automation_job'), "Business preview waiting uses transient deferral");
check(businessBuilder.includes('"deferred" in result && result.deferred === true'), "Business preview defer path cannot be completed as a finished job");
check(!businessBuilder.includes('if (!deploy) throw new Error("Netlify preview is still building.")'), "Business preview waiting does not consume failure retries");

const productionWorker = read("supabase", "functions", "promote-business-production", "index.ts");
check(productionWorker.includes('Production wait deferral failed:'), "Business production waiting uses transient deferral");
check(productionWorker.includes('"deferred" in result && result.deferred === true'), "Business production defer path cannot be completed as a finished job");
check(!productionWorker.includes('if (!deploy) throw new Error("Exact Netlify production commit is still building.")'), "Business production waiting does not consume failure retries");

const transientMigration = read("supabase", "migrations", "201_transient_external_job_deferral.sql");
check(transientMigration.includes("attempts = greatest(attempts - 1, 0)"), "transient provider deferral restores the attempt consumed by claim");
check(transientMigration.includes("auth.role() <> 'service_role'"), "transient provider deferral is service-role restricted");
check(transientMigration.includes("status = 'running'") && transientMigration.includes("locked_by = worker_name"), "transient provider deferral requires current worker ownership");

const boundedDeploymentFunctions = [
  "execute-preview-netlify-build",
  "execute-production-netlify-build",
  "check-preview-netlify-status",
  "check-production-netlify-status",
  "publish-production-netlify-deploy",
];
for (const name of boundedDeploymentFunctions) {
  const source = read("supabase", "functions", name, "index.ts");
  check(source.includes("async function boundedProviderFetch("), `${name} uses bounded provider networking`);
  check(source.includes("status: 599"), `${name} converts timeout/network failure into a controlled provider response`);
}

const maintenance = read("supabase", "functions", "run-website-maintenance", "index.ts");
check(!maintenance.includes("const tokenRes = await fetch(`https://api.github.com/app/installations/"), "maintenance GitHub App token exchange uses the bounded HTTP wrapper");
check(maintenance.includes("const { res: tokenRes } = await timedFetch(`https://api.github.com/app/installations/"), "maintenance GitHub token exchange has timeout protection");

const seoWorker = read("supabase", "functions", "build-business-seo-artifacts", "index.ts");
const seoProductionGuards = [
  [seoWorker.includes('if(String(run.status)!=="preview_ready")'), "SEO production promotion requires verified preview-ready state"],
  [seoWorker.includes('currentMain!==String(run.base_main_sha)'), "SEO production promotion detects main changing after preview"],
  [seoWorker.includes('["ahead","identical"].includes(compare)'), "SEO production promotion requires clean fast-forward compare status"],
  [seoWorker.includes("force:false"), "SEO production promotion explicitly forbids force push"],
  [seoWorker.includes('triggerNetlifyBuild(ctx.config.netlify_site_id,"main")'), "SEO main build occurs only inside the guarded production promotion lane"],
];
for (const [ok, message] of seoProductionGuards) check(ok, message);

const productionAllowlist = new Set([
  "promote-business-production",
  "execute-production-netlify-build",
  "publish-production-netlify-deploy",
  "build-business-seo-artifacts",
]);
for (const dirent of fs.readdirSync(functionsDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const file = path.join(functionsDir, dirent.name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (!productionAllowlist.has(dirent.name)) {
    check(!/builds\?branch=main/.test(source), `${dirent.name} does not explicitly trigger a production-main Netlify build`);
    if (/git\/refs\/heads\/main/.test(source)) check(false, `${dirent.name} must not write the production main Git ref`);
  }
}

const oneShotDir = path.join(root, ".github", "workflows");
const oneShots = fs.readdirSync(oneShotDir).filter((name) => name.startsWith("one-shot-") && name.endsWith(".yml"));
for (const name of oneShots) {
  const source = fs.readFileSync(path.join(oneShotDir, name), "utf8");
  check(!/^\s*schedule\s*:/m.test(source), `${name} cannot run on a recurring schedule`);
}

if (failures.length) {
  console.error(`\nRuntime error-surface audit failed (${failures.length} issue(s)).`);
  process.exit(1);
}
console.log(`\nRuntime error-surface audit passed across ${uniqueWakeNames.length} scheduled lanes, all Edge workers, bounded provider networking, retry-safe waits, key handling, preview safety, guarded production writes, and one-shot workflows.`);
