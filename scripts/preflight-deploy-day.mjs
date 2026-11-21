// One command for the morning of a deploy (`npm run preflight`). Read-only: it edits nothing, deploys nothing and contacts nothing except `git ls-remote`.
//   1. the branch tip on GitHub equals this checkout, and the working tree is clean
//   2. the pending migrations are exactly the ones the owner expects (anything else stops the deploy and needs a decision)
//   3. which Edge functions changed since the last functions deploy (so you know whether deploy_functions is needed)
//   4. a production-style rehearsal: build the site against a MOCKED Supabase, serve it with Netlify's real security headers, and open ~36 pages (needs Playwright
//      and Chromium, present in the cloud container; skipped with a notice elsewhere)
// It does NOT replace `npm run test:ci-parity` (the exact CI commands); run both before publishing.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Update these two lines when the plan changes (they are checked against the files on disk).
const expectedPendingMigrations = []; // 2026-10-29: 286 (each store's look in the database) was APPLIED to staging (run #278, owner-approved, log read). Staging is up to date through 286. Add a file name here only when a new migration is added and not yet applied.
const lastAppliedMigration = 286; // applied to staging 2026-10-29 (run #278: 286, log read, no error); 285 on 2026-10-28 (run #276); 280-284 on 2026-10-26 (run #272)
const lastFunctionsDeploy = "2026-10-27T00:17:46Z"; // run #274 (2026-10-26 5:17 PM PDT, owner-run, all 45 functions, coverage check passed; build-business-website and run-staging-evidence-suite were the two with changes); earlier run #270 failed on a registry rate limit before deploying, run #267 on 2026-10-22; later commits that touch supabase/functions need deploy_functions

let failures = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } };
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: "utf8", ...options });

// 1. git
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
const remote = run("git", ["ls-remote", "origin", `refs/heads/${branch}`]).stdout.split("\t")[0].trim();
ok(`on a safe branch (${branch}), never main`, branch !== "main" && /^safe\//.test(branch));
ok("the tip on GitHub equals this checkout", Boolean(remote) && remote === head, `local ${head.slice(0, 8)} vs origin ${remote ? remote.slice(0, 8) : "(unreachable)"}`);
ok("the working tree is clean", run("git", ["status", "--porcelain"]).stdout.trim() === "");

// 2. migrations
const files = fs.readdirSync("supabase/migrations").filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const pending = files.filter((f) => Number(f.slice(0, 3)) > lastAppliedMigration);
ok(`pending migrations are exactly what the owner expects (${expectedPendingMigrations.length ? expectedPendingMigrations.map((f) => f.slice(0, 3)).join(" + ") : "none: staging is up to date through 286"})`, JSON.stringify(pending) === JSON.stringify(expectedPendingMigrations), `found: ${pending.join(", ") || "none"}`);

// 3. functions
const changed = run("git", ["log", `--since=${lastFunctionsDeploy}`, "--format=%h %s", "--", "supabase/functions"]).stdout.trim().split("\n").filter(Boolean);
console.log(changed.length ? `INFO  ${changed.length} commit(s) touched supabase/functions since the last functions deploy (${lastFunctionsDeploy}), so deploy_functions IS needed:\n        ${changed.map((l) => l.slice(0, 100)).join("\n        ")}` : "INFO  no Edge function changed since the last functions deploy, so deploy_functions can be skipped");

// 4. production-style rehearsal
const pw = process.env.PW_FROM || "/node-tools/node_modules/";
let hasPlaywright = true;
try { createRequire(pw)("playwright"); } catch { hasPlaywright = false; }
if (!hasPlaywright) {
  console.log("SKIP  production rehearsal (Playwright not found; set PW_FROM=<folder containing node_modules/playwright>/)");
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-rehearsal-"));
  const build = run("npx", ["vite", "build", "--outDir", dir, "--emptyOutDir"], { env: { ...process.env, VITE_SUPABASE_URL: "https://mock.supabase.co", VITE_SUPABASE_ANON_KEY: "mock-anon-key" } });
  ok("a production build of the site succeeds", build.status === 0, (build.stderr || build.stdout || "").slice(-200));
  if (build.status === 0) {
    const port = 5390 + Math.floor(Math.random() * 9);
    const server = spawn("node", ["scripts/manual/serve-dist.mjs", dir, String(port)], { stdio: "ignore", detached: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const result = run("node", ["scripts/manual/prod-rehearsal.mjs"], { env: { ...process.env, BASE_URL: `http://127.0.0.1:${port}`, PW_FROM: pw }, timeout: 600000 });
    try { process.kill(-server.pid); } catch { /* already stopped */ }
    const lines = (result.stdout || "").trim().split("\n");
    ok("every rehearsed page loads cleanly under Netlify's real security headers", result.status === 0, lines.filter((l) => l.startsWith("FAIL")).slice(0, 3).join(" | ") || lines.slice(-1)[0]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} preflight check(s) failed. Do not publish yet.` : "\nPreflight passed. Now run `npm run test:ci-parity`, then follow docs/OCT22_DEPLOY_DAY_CHECKLIST.md.");
process.exit(failures ? 1 : 0);
