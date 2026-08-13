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

const productionAllowlist = new Set([
  "promote-business-production",
  "execute-production-netlify-build",
  "publish-production-netlify-deploy",
]);
for (const dirent of fs.readdirSync(functionsDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const file = path.join(functionsDir, dirent.name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (!productionAllowlist.has(dirent.name)) {
    check(!/builds\?branch=main/.test(source), `${dirent.name} does not explicitly trigger a production-main Netlify build`);
  }
  if (/git\/refs\/heads\/main/.test(source) && !productionAllowlist.has(dirent.name)) {
    check(false, `${dirent.name} must not write the production main Git ref`);
  }
  if (/force\s*:\s*true/.test(source)) check(false, `${dirent.name} contains a force:true provider write`);
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
console.log(`\nRuntime error-surface audit passed across ${uniqueWakeNames.length} scheduled lanes, all Edge workers, Commerce preview safety, production-write guards, and one-shot workflows.`);
