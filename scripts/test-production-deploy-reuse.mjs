// The production promotion must not pay for a second build of a commit that Netlify's own Git integration already started: the pure waiting rule
// (supabase/functions/_shared/production-deploy-wait.mjs) and how promote-business-production uses it. Offline, no network. Planted-bug controls included.
// Background: docs/PROMOTION_DOUBLE_DEPLOY_PLAN.md (the first measured QA run made two production deploys of one commit).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-deploy-reuse-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const importFile = (file) => import(`${pathToFileURL(file).href}?t=${Date.now()}${Math.random()}`);

const helperPath = "supabase/functions/_shared/production-deploy-wait.mjs";
const real = await importFile(path.resolve(helperPath));

async function ruleChecks(mod, ok) {
  const { reuseGitTriggeredDeploy, GIT_BUILD_WAIT } = mod;
  const fakeClock = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };

  let looks = 0; let clock = fakeClock();
  const second = await reuseGitTriggeredDeploy({ find: async () => (++looks === 2 ? { id: "git-build" } : null), sleep: clock.sleep });
  ok("a deploy that appears on the second look is reused, after two waits of 4 seconds", second?.id === "git-build" && looks === 2 && clock.waits.length === 2 && clock.waits.every((ms) => ms === 4000));

  looks = 0; clock = fakeClock();
  const first = await reuseGitTriggeredDeploy({ find: async () => { looks += 1; return { id: "early" }; }, sleep: clock.sleep });
  ok("a deploy already there on the first look is reused with one short wait, and nothing more is asked", first?.id === "early" && looks === 1 && clock.waits.length === 1);

  looks = 0; clock = fakeClock();
  const never = await reuseGitTriggeredDeploy({ find: async () => { looks += 1; return null; }, sleep: clock.sleep });
  ok("when Netlify never starts a build it gives up after exactly 6 looks and 24 seconds, and returns null (the caller then builds as before)", never === null && looks === 6 && clock.waits.length === 6 && clock.waits.reduce((a, b) => a + b, 0) === 24000);

  clock = fakeClock();
  let thrown = "";
  try { await reuseGitTriggeredDeploy({ find: async () => { throw new Error("Netlify production deploy failed: build error"); }, sleep: clock.sleep }); } catch (e) { thrown = e.message; }
  ok("a failed deploy is never hidden: the error reaches the caller", thrown === "Netlify production deploy failed: build error");

  looks = 0; clock = fakeClock();
  const none = await reuseGitTriggeredDeploy({ find: async () => { looks += 1; return { id: "x" }; }, sleep: clock.sleep, attempts: 0 });
  ok("zero attempts asks nothing and returns null", none === null && looks === 0 && clock.waits.length === 0);

  // slow Netlify: each lookup takes 20 seconds of fake time; the 60 second budget must stop the loop after 3 looks, not 6
  let fakeNow = 0; looks = 0;
  const slow = await reuseGitTriggeredDeploy({ find: async () => { looks += 1; fakeNow += 20000; return null; }, sleep: async (ms) => { fakeNow += ms; }, now: () => fakeNow });
  ok("slow lookups cannot stretch the wait past its 60 second budget (stops after 3 looks, returns null)", slow === null && looks === 3);

  ok("the wait is 6 looks 4 seconds apart, 24 seconds in all, comfortably inside an Edge function's time limit", GIT_BUILD_WAIT.attempts === 6 && GIT_BUILD_WAIT.delayMs === 4000 && GIT_BUILD_WAIT.attempts * GIT_BUILD_WAIT.delayMs <= 30000 && GIT_BUILD_WAIT.budgetMs === 60000);
}
await ruleChecks(real, check);

// ---- planted bugs: each rule must be able to fail ----------------------------------------------------------------------------------
const source = fs.readFileSync(helperPath, "utf8");
const mutants = [
  ["a found deploy is ignored (it always pays for a second build)", [["if (found) return found;", ""]]],
  ["a failed deploy is swallowed", [["const found = await find();", "let found = null; try { found = await find(); } catch { found = null; }"]]],
  ["it never waits between looks", [["await sleep(delayMs);", ""]]],
  ["the total time budget is ignored", [["if (now() - startedAt >= budgetMs) return null;", ""]]],
  ["it waits one look longer than allowed", [["attempt < attempts;", "attempt <= attempts;"]]],
];
for (const [name, edits] of mutants) {
  let text = source;
  const applied = edits.every(([from, to]) => { if (!text.includes(from)) return false; text = text.replace(from, to); return true; });
  const file = path.join(tmp, `mutant-${mutants.findIndex((m) => m[0] === name)}.mjs`);
  fs.writeFileSync(file, text);
  let caught = 0;
  if (applied) { try { await ruleChecks(await importFile(file), (_n, cond) => { if (!cond) caught += 1; }); } catch { caught += 1; } }
  check(`PLANTED BUG caught: ${name}`, applied && caught > 0, applied ? "no check failed" : "the edit did not apply, so the control proves nothing");
}

// ---- how the promotion function uses it --------------------------------------------------------------------------------------------
const fn = fs.readFileSync("supabase/functions/promote-business-production/index.ts", "utf8");
check("the function imports the waiting rule from the shared module", /import \{ reuseGitTriggeredDeploy \} from "\.\.\/_shared\/production-deploy-wait\.mjs";/.test(fn));
const firstLook = fn.indexOf("let build = await findExistingProductionDeploy(configRes.data.netlify_site_id, sourceSha);");
const waitCall = fn.indexOf("reuseGitTriggeredDeploy({");
const reserve = fn.indexOf("await reserveNetlifyBuild(admin, job, runId, sourceSha);");
const explicit = fn.indexOf("await triggerProductionBuild(configRes.data.netlify_site_id);");
check("the order is: look once, wait for Netlify's own build, and only then reserve and trigger an explicit build", firstLook > 0 && firstLook < waitCall && waitCall < reserve && reserve < explicit);
check("it waits only after a push (sourceSha differs from main) and only when no deploy was found yet", fn.includes("if (!build && sourceSha !== mainSha) {"));
check("the explicit build is still the fallback, behind its provider-mutation check and its budget reservation", /if \(!build\) \{\s*await assertProviderMutationAllowed\(admin, job\);\s*await reserveNetlifyBuild\(admin, job, runId, sourceSha\);\s*const started = await triggerProductionBuild/.test(fn));
check("the lookup it polls is the same exact-commit lookup as before (branch main, that commit)", /find: \(\) => findExistingProductionDeploy\(configRes\.data\.netlify_site_id, sourceSha\)/.test(fn));
check("the helper holds no secret and makes no network call itself", !/fetch\(|Deno\.env|secret|token/i.test(source.replace(/\/\/.*$/gm, "")));

console.log(failures ? `\n${failures} production deploy reuse check(s) failed.` : "\nProduction deploy reuse test passed.");
process.exit(failures ? 1 : 0);
