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
run(npm, ["run", "lint", "--", "--max-warnings=0"]);
run(npm, ["audit", "--omit=dev", "--audit-level=high"]);
run(npm, ["run", "build"]);
run(npm, ["run", "test:security"]);
run(npm, ["run", "test:routes"]);
run(node, ["scripts/check-production-bundle-budget.mjs"]);

console.log("\nNXQ release gate passed.");
