// Offline test for the deploy-day scripts: the ready script runs the right commands in the right order, and the checklist and cheat sheet mention them.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { reminders, steps } from "./deploy-day-ready.mjs";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const plan = spawnSync("node", ["scripts/deploy-day-ready.mjs", "--plan"], { encoding: "utf8" }).stdout;
check("the ready script runs preflight first, then the exact CI parity commands", steps[0].args.join(" ") === "run preflight" && steps[1].args.join(" ") === "run test:ci-parity" && /1\. preflight[\s\S]*2\. CI parity/.test(plan));
check("both commands it runs exist in package.json, and `npm run ready` is wired", pkg.scripts.preflight && pkg.scripts["test:ci-parity"] && pkg.scripts.ready === "node scripts/deploy-day-ready.mjs");
check("the human-only reminders cover credits, the rollback target, the apply order and keeping the client uninformed", reminders.length === 4 && /credits/i.test(reminders[0]) && /previous good deploy/.test(reminders[1]) && /validate_foundation[\s\S]*apply_migrations[\s\S]*deploy_functions/.test(reminders[2]) && /candle client/.test(reminders[3]));
const source = fs.readFileSync("scripts/deploy-day-ready.mjs", "utf8");
check("it never deploys, applies or pushes (no gh, supabase, netlify or git push in it)", !/\b(gh |supabase |netlify |git push|rpc\()/.test(source.replace(/\/\/.*$/gm, "").replace(/`[^`]*`/g, "")) && !/stdio: "inherit"[^;]*gh/.test(source));
check("it stops at the first failing step and says NOT READY (so a red preflight never reaches 'READY')", /if \(run\.status !== 0\) break;/.test(source) && /NOT READY/.test(source));
const checklist = fs.readFileSync("docs/OCT22_DEPLOY_DAY_CHECKLIST.md", "utf8");
check("the checklist tells the person to run `npm run ready` and links the log cheat sheet", /npm run ready/.test(checklist) && /HOW_TO_READ_THE_RUN_LOGS\.md/.test(checklist) && fs.existsSync("docs/HOW_TO_READ_THE_RUN_LOGS.md"));
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll deploy-day script checks passed (offline).");
process.exit(failures ? 1 : 0);
