// One command for deploy day: `npm run ready`. Runs the local safety checks in order and prints ONE verdict. Read-only: it edits nothing, deploys nothing, applies nothing.
//   1. npm run preflight      (branch safe, origin tip equals this checkout, clean tree, pending migrations exactly as expected, production-style rehearsal)
//   2. npm run test:ci-parity (the exact commands GitHub CI runs, 66 of them, including the store tests, lint and the build)
// It cannot check the things only a person can: Netlify credits, the Stripe/Supabase dashboards, or the candle client. Those are printed as a reminder list at the end.
// `node scripts/deploy-day-ready.mjs --plan` only prints what it would run (used by the offline test).
import { spawnSync } from "node:child_process";

export const steps = [
  { name: "preflight (git, migrations, production rehearsal)", cmd: "npm", args: ["run", "preflight"] },
  { name: "CI parity (the same 66 commands GitHub runs)", cmd: "npm", args: ["run", "test:ci-parity"] },
];
export const reminders = [
  "Netlify credits: open the Netlify team page and write the number down (docs/OCT22_DEPLOY_DAY_CHECKLIST.md 0.1/0.2).",
  "Find the previous good deploy in Netlify so a rollback is one click (docs/ROLLBACK_AND_EMERGENCY_PLAN.md).",
  "Next, in order: validate_foundation (dry run must list exactly 272 and 273) -> apply_migrations -> deploy_functions -> ONE site deploy -> npm run smoke -> the phone proof.",
  "Do not tell the candle client the store is public until the practice order passed.",
];

if (process.argv[2] === "--plan") {
  steps.forEach((s, i) => console.log(`${i + 1}. ${s.name}: ${s.cmd} ${s.args.join(" ")}`));
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const results = [];
  for (const step of steps) {
    console.log(`\n=== ${step.name} ===`);
    const run = spawnSync(step.cmd, step.args, { stdio: "inherit" });
    results.push({ ...step, ok: run.status === 0 });
    if (run.status !== 0) break; // later steps are meaningless once one fails
  }
  console.log("\n==================== VERDICT ====================");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  const skipped = steps.slice(results.length);
  for (const s of skipped) console.log(`SKIP  ${s.name} (an earlier step failed)`);
  const ready = results.length === steps.length && results.every((r) => r.ok);
  console.log(ready ? "\nREADY: every local check passed. Now the human checks:" : "\nNOT READY: fix the failing step above first. Do not deploy.");
  if (ready) reminders.forEach((r) => console.log(`  [ ] ${r}`));
  process.exit(ready ? 0 : 1);
}
