import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const node = process.execPath;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

const validators = fs.readdirSync(path.join(root, "scripts"))
  .filter((name) => name.startsWith("validate-") && name.endsWith(".mjs"))
  .sort();
for (const validator of validators) run(node, [path.join("scripts", validator)]);

run(node, ["scripts/check-runtime-stage-readiness.mjs"]);
run(node, ["scripts/check-migration-integrity.mjs"]);
run(node, ["scripts/simulate-autonomy-failures.mjs"]);
run(npm, ["run", "test:lifecycle"]);
run(npm, ["run", "test:security"]);
run(npm, ["run", "test:accessibility"]);
run(npm, ["run", "test:edge"]);
run(npm, ["run", "test:ai-protocols"]);
run(npm, ["run", "test:build-plan-fallback"]);
run(npm, ["run", "test:netlify-builds-stopped"]);
run(npm, ["run", "test:home-honest-copy"]);
run(npm, ["run", "test:dashboard-trend"]);
run(npm, ["run", "test:business-default-copy"]);
run(npm, ["run", "test:business-template-copy"]);
run(npm, ["run", "test:analytics-path-privacy"]);
run(npm, ["run", "test:top-pages"]);
run(npm, ["run", "test:commerce-launch-guide"]);
run(npm, ["run", "test:commerce-rpc-reason"]);
run(npm, ["run", "test:commerce-setup-form"]);
run(npm, ["run", "test:client-setup-sheet"]);
run(npm, ["run", "test:storefront-theme"]);
run(npm, ["run", "test:store-polish"]);
run(npm, ["run", "test:order-attention"]);
run(npm, ["run", "test:commerce-nav"]);
run(npm, ["run", "test:commerce-polish"]);
run(npm, ["run", "test:email-orders"]);
run(npm, ["run", "test:portal-help"]);
run(npm, ["run", "test:menu-mode"]);
run(npm, ["run", "test:store-profile"]);
run(npm, ["run", "test:client-wording"]);
run(npm, ["run", "test:links"]);
run(npm, ["run", "test:app-resilience"]);
run(npm, ["run", "test:a11y-basics"]);
run(npm, ["run", "test:store-catalog"]);
run(npm, ["run", "test:store-experience"]);
run(npm, ["run", "test:store-white-label"]);
run(npm, ["run", "test:shopper-account"]);
run(npm, ["run", "test:payment-links"]);
run(npm, ["run", "test:outreach-compliance"]);
run(npm, ["run", "test:outreach-dispatch"]);
run(npm, ["run", "test:ai-routing"]);
run(npm, ["run", "test:auto-approval"]);
run(npm, ["run", "test:format-helpers"]);
run(npm, ["run", "test:auth-guards"]);
run(npm, ["run", "test:premium-ui"]);
run(npm, ["run", "test:scanii"]);
run(npm, ["run", "test:select-columns"]);
run(npm, ["run", "test:safe-url"]);
run(npm, ["run", "lint", "--", "--max-warnings=0"]);
run(npm, ["audit", "--omit=dev", "--audit-level=high"]);
run(npm, ["run", "build"]);
run(npm, ["run", "test:security"]);
run(npm, ["run", "test:routes"]);
run(node, ["scripts/check-production-bundle-budget.mjs"]);

console.log("\nNXQ release gate passed.");
