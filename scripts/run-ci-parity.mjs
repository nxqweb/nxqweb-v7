// Runs the same commands GitHub Actions runs on every push/PR (parsed from the workflow files, not hand-copied),
// so "green locally" means "green in CI". Read-only: it never edits a workflow. Usage: npm run test:ci-parity
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const workflows = [
  "ci", "ci-mega-extended", "security-audit", "client-canonical-stage-contract",
  "client-lead-pagination-contract", "client-file-domain-isolation-contract", "portal-scale-contract",
];
const commands = new Set();
for (const name of workflows) {
  const file = `.github/workflows/${name}.yml`;
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:- )?run:\s*(node scripts\/[^|&;]+|npm run lint[^|&;]*|npm run test:[A-Za-z0-9:_-]+)$/);
    if (match) commands.add(match[1].trim());
  }
}

// CI builds before the bundle budget check; mirror that so the budget script has a dist/ to read.
const ordered = [...commands].sort((a, b) => Number(a.includes("bundle-budget")) - Number(b.includes("bundle-budget")));
// The build is also a CI step in its own right (it runs the TypeScript compiler over the whole app), so it is ALWAYS run here, never skipped because an old
// dist/ folder exists: a stale dist/ once let a real type error through to GitHub (found 2026-10-17). `tsc --noEmit -p .` alone checks nothing in this repo
// (the root tsconfig only holds references), so the build is the real type check.
console.log("building (always, so type errors cannot hide behind an old dist/)...");
const build = spawnSync("npm", ["run", "build"], { stdio: "ignore", timeout: 600000 });
const buildFailed = build.status !== 0;

const failed = [];
console.log(`${buildFailed ? "FAIL" : "PASS"}  npm run build`);
if (buildFailed) failed.push("npm run build");
for (const command of ordered) {
  const result = spawnSync(command, { shell: true, stdio: "ignore", timeout: 180000 });
  const ok = result.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${command}`);
  if (!ok) failed.push(command);
}
console.log(failed.length ? `\n${failed.length} of ${ordered.length + 1} CI command(s) FAILED. Do not push until these pass.` : `\nAll ${ordered.length + 1} CI commands passed.`);
process.exit(failed.length ? 1 : 0);
