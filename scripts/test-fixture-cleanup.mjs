// The evidence suite must remove its temporary fixtures one record at a time, retry a timed-out delete briefly, treat "already gone" as removed, never report a
// failure it did not have, and never retry forever. Real incident 2026-11-12: deleting both fixture clients in one statement timed out, the run returned HTTP 500,
// and two clients were left behind. Offline; planted-bug controls included.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-fixture-cleanup-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const importFile = (file) => import(`${pathToFileURL(file).href}?t=${Date.now()}${Math.random()}`);
const helperPath = "supabase/functions/_shared/fixture-cleanup.mjs";

async function rules(mod, ok) {
  const { removeOneByOne, alreadyGone, CLEANUP_RETRY } = mod;
  const noSleep = async () => {};
  const timeout = { error: { message: "canceling statement due to statement timeout" } };

  let calls = [];
  let errs = await removeOneByOne({ ids: ["a", "b"], label: "clients", sleep: noSleep, deleteOne: async (id) => { calls.push(id); return { error: null }; } });
  ok("every record is deleted separately (one call per id, never a batch)", errs.length === 0 && calls.join() === "a,b");

  let n = 0; calls = [];
  errs = await removeOneByOne({ ids: ["a"], label: "clients", sleep: noSleep, deleteOne: async (id) => { calls.push(id); n += 1; return n < 3 ? timeout : { error: null }; } });
  ok("a delete that times out twice and then works is retried and reported as success", errs.length === 0 && calls.length === 3);

  calls = [];
  errs = await removeOneByOne({ ids: ["a"], label: "clients", sleep: noSleep, deleteOne: async (id) => { calls.push(id); return timeout; } });
  ok("a delete that always fails is tried exactly 3 times and then reported with its real message", calls.length === 3 && errs.length === 1 && errs[0] === "clients: canceling statement due to statement timeout", JSON.stringify(errs));

  errs = await removeOneByOne({ ids: ["x"], label: "auth user", sleep: noSleep, deleteOne: async () => ({ error: { message: "User not found" } }) });
  ok('"User not found" means it is already gone: success, no error reported', errs.length === 0);
  ok("the already-gone rule matches the real wordings and nothing broader", alreadyGone("User not found") && alreadyGone("no rows") && !alreadyGone("canceling statement due to statement timeout") && !alreadyGone("permission denied"));

  calls = [];
  errs = await removeOneByOne({ ids: ["bad", "good"], label: "clients", sleep: noSleep, deleteOne: async (id) => { calls.push(id); return id === "bad" ? timeout : { error: null }; } });
  ok("one stubborn record does not stop the others being removed", calls.filter((c) => c === "good").length === 1 && errs.length === 1 && errs[0].startsWith("clients:"));

  errs = await removeOneByOne({ ids: ["a"], label: "clients", sleep: noSleep, deleteOne: async () => { throw new Error("network reset"); }, attempts: 2 });
  ok("a thrown error is caught and reported, not allowed to crash the cleanup", errs.length === 1 && errs[0] === "clients: network reset");

  const waits = [];
  await removeOneByOne({ ids: ["a"], label: "clients", sleep: async (ms) => { waits.push(ms); }, deleteOne: async () => timeout });
  ok("it waits 3 seconds between attempts (2 waits for 3 attempts)", waits.length === 2 && waits.every((ms) => ms === 3000));

  // time budget: each attempt takes 20 fake seconds; the 45 second budget must stop further retries
  let fake = 0; calls = [];
  errs = await removeOneByOne({ ids: ["a", "b"], label: "clients", sleep: async (ms) => { fake += ms; }, now: () => fake, deleteOne: async (id) => { calls.push(id); fake += 20000; return timeout; } });
  ok("slow failures cannot run past the 45 second budget (the Edge function has a wall clock)", calls.length < 6 && errs.length === 2, `calls=${calls.length}`);
  ok("the defaults are 3 attempts, 3 seconds, 45 second budget", CLEANUP_RETRY.attempts === 3 && CLEANUP_RETRY.delayMs === 3000 && CLEANUP_RETRY.budgetMs === 45000);
}
const real = await importFile(path.resolve(helperPath));
await rules(real, check);

// planted bugs: each rule must be able to fail
const source = fs.readFileSync(helperPath, "utf8");
const mutants = [
  ["no retry at all (the original behaviour on a timeout)", [["attempt < attempts && !gone", "attempt < 1 && !gone"]]],
  ["one attempt too many", [["attempt < attempts && !gone", "attempt <= attempts && !gone"]]],
  ['"not found" is reported as an error (the phantom errors)', [["if (!message || alreadyGone(message)) gone = true;", "if (!message) gone = true;"]]],
  ["a stubborn record is never reported (failures swallowed)", [['if (!gone) errors.push(', 'if (false) errors.push(']]],
  ["the time budget is ignored", [["if (now() - startedAt >= budgetMs) break;", ""]]],
  ["it never waits between attempts", [["await sleep(delayMs);", ""]]],
];
for (let i = 0; i < mutants.length; i += 1) {
  const [name, edits] = mutants[i];
  let text = source;
  const applied = edits.every(([from, to]) => { if (!text.includes(from)) return false; text = text.replace(from, to); return true; });
  const file = path.join(tmp, `mutant-${i}.mjs`);
  fs.writeFileSync(file, text);
  let caught = 0;
  if (applied) { try { await rules(await importFile(file), (_n, cond) => { if (!cond) caught += 1; }); } catch { caught += 1; } }
  check(`PLANTED BUG caught: ${name}`, applied && caught > 0, applied ? "no check failed" : "the edit did not apply");
}

// how the suite uses it
const fn = fs.readFileSync("supabase/functions/run-staging-evidence-suite/index.ts", "utf8");
check("the suite imports the helper", fn.includes('import { CLEANUP_RETRY, removeOneByOne } from "../_shared/fixture-cleanup.mjs";'));
check("the single batched delete of all clients is gone", !/\.delete\(\)\.in\("id", clientIds\)/.test(fn));
check("each client is deleted by its own id", fn.includes('admin.from("clients").delete().eq("id", id)'));
check("auth users go through the same helper (already-gone is not an error)", /label: "auth user"/.test(fn) && fn.includes("admin.auth.admin.deleteUser(id)"));
check("the cleanup still runs on success and on failure (the validator needs 3 removeFixtures references)", (fn.match(/removeFixtures\(/g) || []).length >= 3);
check("a cleanup failure still fails the run (unchanged behaviour; the owner decides if that should change)", fn.includes("Evidence passed but fixture cleanup failed"));

console.log(failures ? `\n${failures} fixture cleanup check(s) failed.` : "\nFixture cleanup test passed.");
process.exit(failures ? 1 : 0);
