import { spawnSync } from "node:child_process";
import { runRemoteLaunchArchitectureChecks } from "./remote-launch-architecture-contract.mjs";

const childEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: "" };
const local = spawnSync(process.execPath, ["scripts/check-runtime-stage-readiness.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: childEnv,
});
if ((local.status ?? 1) !== 0) process.exit(local.status ?? 1);

const pass = (label) => console.log(`PASS  ${label}`);
const fail = (label) => { console.error(`FAIL  ${label}`); process.exitCode = 1; };

// The canonical query and check list now live in one place only:
// ./remote-launch-architecture-contract.mjs. This used to keep its own
// smaller, drifted copy of the checks; it now runs the exact same ones
// as check-runtime-stage-readiness.mjs.
await runRemoteLaunchArchitectureChecks({ pass, fail });

if (process.exitCode) process.exit(process.exitCode);
pass("Remote launch-architecture contract passed through read-only Supabase query endpoint");
