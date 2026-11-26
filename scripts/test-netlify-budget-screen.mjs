// The owner's Netlify build limit screen: the pure rules (src/lib/netlifyBudget.ts), the page's calls against the SQL of migration 234, and the wiring. Offline, no network.
// Node >= 22.18 imports the .ts helper directly. Planted-bug controls included: each rule is also run against a deliberately broken copy.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const read = (file) => fs.readFileSync(file, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-budget-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const importFile = (file) => import(`${pathToFileURL(file).href}?t=${Date.now()}${Math.random()}`);

const libPath = "src/lib/netlifyBudget.ts";
const real = await importFile(path.resolve(libPath));

const status = (over = {}, settings = {}) => ({
  settings: { singleton: true, enabled: true, emergency_stop: false, billing_cycle_anchor_day: 23, max_builds_per_cycle: 12, max_qa_builds_per_cycle: 12, ...settings },
  cycle_start: "2026-10-23", reserved_builds: 3, reserved_qa_builds: 2, ...over,
});

function libChecks(mod, ok) {
  const { budgetFromRpc, budgetProblem, buildsLeft, approveRunsLeft, describeChange, MAX_BUILD_LIMIT } = mod;
  const b = budgetFromRpc(status());
  ok("the status row is read into plain fields", b && b.enabled === true && b.emergencyStop === false && b.maxBuilds === 12 && b.maxQaBuilds === 12 && b.anchorDay === 23 && b.cycleStart === "2026-10-23" && b.reservedBuilds === 3 && b.reservedQaBuilds === 2);
  ok("numbers sent as text are accepted (the database may send either)", budgetFromRpc(status({ reserved_builds: "4" }, { max_builds_per_cycle: "15" }))?.maxBuilds === 15);
  ok("odd or incomplete data is refused as null, never guessed at", [null, undefined, "x", 7, [], {}, { settings: null }, { settings: [] }, status({ reserved_builds: -1 }), status({ reserved_builds: 1.5 }), status({ reserved_qa_builds: null }), status({}, { max_builds_per_cycle: -4 }), status({}, { enabled: "yes" }), status({}, { emergency_stop: null }), status({}, { billing_cycle_anchor_day: "x" })].every((v) => budgetFromRpc(v) === null));

  ok("limits: whole numbers 0 to 100 with the QA limit not above the total pass", budgetProblem(12, 12) === "" && budgetProblem(0, 0) === "" && budgetProblem(MAX_BUILD_LIMIT, 5) === "" && budgetProblem(4, 2) === "");
  ok("limits: a QA limit above the cycle limit is refused in plain words", /cannot be higher/.test(budgetProblem(4, 5)));
  ok("limits: negatives, fractions, NaN and more than 100 are refused", [[-1, 0], [101, 5], [4.5, 2], [Number.NaN, 2], [4, -1], [4, 1.5], [4, Number.NaN]].every(([x, y]) => budgetProblem(x, y) !== ""));
  ok("the limit constant is 100, like the database function", MAX_BUILD_LIMIT === 100);

  ok("builds left: the cycle total minus what is counted", buildsLeft({ maxBuilds: 12, maxQaBuilds: 12, reservedBuilds: 3, reservedQaBuilds: 2 }).total === 9);
  ok("QA builds left can never be more than the total left (QA builds count inside the total)", buildsLeft({ maxBuilds: 12, maxQaBuilds: 12, reservedBuilds: 11, reservedQaBuilds: 2 }).qa === 1 && buildsLeft({ maxBuilds: 12, maxQaBuilds: 5, reservedBuilds: 3, reservedQaBuilds: 2 }).qa === 3);
  ok("builds left is never negative, even over the limit", (() => { const l = buildsLeft({ maxBuilds: 4, maxQaBuilds: 2, reservedBuilds: 9, reservedQaBuilds: 5 }); return l.total === 0 && l.qa === 0; })());
  ok("approve runs left is a range from 3 builds per run down to 2", JSON.stringify(approveRunsLeft(9)) === JSON.stringify({ atLeast: 3, atMost: 4 }) && JSON.stringify(approveRunsLeft(0)) === JSON.stringify({ atLeast: 0, atMost: 0 }) && approveRunsLeft(-3).atMost === 0);

  const before = budgetFromRpc(status({}, { max_builds_per_cycle: 4, max_qa_builds_per_cycle: 2 }));
  ok("describeChange says nothing when nothing changes", describeChange(before, { enabled: true, emergencyStop: false, maxBuilds: 4, maxQaBuilds: 2 }).length === 0);
  const lines = describeChange(before, { enabled: true, emergencyStop: false, maxBuilds: 12, maxQaBuilds: 12 });
  ok("describeChange lists only what changed, with the old and new numbers", lines.length === 2 && lines[0].includes("4 -> 12") && lines[1].includes("2 -> 12"));
  const stop = describeChange(before, { enabled: true, emergencyStop: true, maxBuilds: 4, maxQaBuilds: 2 });
  ok("turning the emergency stop on is spelled out, including that real clients are affected", stop.length === 1 && /Emergency stop: OFF -> ON/.test(stop[0]) && /real clients/.test(stop[0]));
  const off = describeChange(before, { enabled: false, emergencyStop: false, maxBuilds: 4, maxQaBuilds: 2 });
  ok("turning the limit off says credits are then the only limit", off.length === 1 && /credits are then the only limit/.test(off[0]));
}

libChecks(real, check);

// ---- planted bugs: each rule must be able to fail -----------------------------------------------------------------------------------
const source = read(libPath);
const mutants = [
  ["a QA limit above the cycle limit is allowed", [["if (maxQaBuilds > maxBuilds) return", "if (false) return"]]],
  ["QA builds left ignores the total left", [["const qa = Math.min(total, Math.max(0, budget.maxQaBuilds - budget.reservedQaBuilds));", "const qa = Math.max(0, budget.maxQaBuilds - budget.reservedQaBuilds);"]]],
  ["negative numbers are accepted when reading", [["return Number.isInteger(n) && n >= 0 ? n : null;", "return Number.isInteger(n) ? n : null;"]]],
  ["builds left can go negative", [["const total = Math.max(0, budget.maxBuilds - budget.reservedBuilds);", "const total = budget.maxBuilds - budget.reservedBuilds;"]]],
  ["the 100 cap is gone", [["maxBuilds > MAX_BUILD_LIMIT) return", "false) return"]]],
  ["the emergency stop change is not described", [["if (before.emergencyStop !== next.emergencyStop) lines.push(", "if (false) lines.push("]]],
];
for (const [name, edits] of mutants) {
  let text = source;
  const applied = edits.every(([from, to]) => { if (!text.includes(from)) return false; text = text.replace(from, to); return true; });
  const file = path.join(tmp, `mutant-${mutants.findIndex((m) => m[0] === name)}.ts`);
  fs.writeFileSync(file, text);
  let caught = 0;
  if (applied) { try { libChecks(await importFile(file), (_n, cond) => { if (!cond) caught += 1; }); } catch { caught += 1; } }
  check(`PLANTED BUG caught: ${name}`, applied && caught > 0, applied ? "no check failed" : "the edit did not apply, so the control proves nothing");
}

// ---- the page's database calls must match the SQL --------------------------------------------------------------------------------
const sql = read("supabase/migrations/234_netlify_deployment_credit_guard.sql");
const page = read("src/pages/OwnerNetlifyBudget.tsx");
const sqlArgs = (name) => { const m = sql.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`)); return m ? m[1].split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean) : null; };
const callArgs = (name) => { const m = page.match(new RegExp(`rpc\\("${name}"(?:,\\s*\\{([^}]*)\\})?`)); return m ? (m[1] || "").split(",").map((p) => p.split(":")[0].trim()).filter(Boolean) : null; };
for (const name of ["owner_netlify_budget_status", "owner_update_netlify_budget_settings"]) {
  const wanted = sqlArgs(name); const got = callArgs(name);
  check(`the page calls ${name} with exactly the SQL's argument names`, Boolean(wanted) && Boolean(got) && JSON.stringify(wanted) === JSON.stringify(got), `sql=${wanted} page=${got}`);
}
check("control: the comparison notices a wrong argument name", JSON.stringify(sqlArgs("owner_update_netlify_budget_settings")) !== JSON.stringify(["target_enabled", "target_emergency_stop"]));
check("the SQL enforces the same limits as the page (cycle limit 0 to 100, QA limit not above it)", /target_max_builds_per_cycle not between 0 and 100/.test(sql) && /target_max_qa_builds_per_cycle not between 0 and target_max_builds_per_cycle/.test(sql));
check("the SQL functions are owner-only and callable by signed-in users, not the public", (sql.match(/is_nxq_owner\(\)/g) || []).length >= 2 && /revoke all on function public\.owner_update_netlify_budget_settings\(boolean,boolean,integer,integer\),public\.owner_netlify_budget_status\(\) from public,anon;/.test(sql));
check("the status function reports the same counts the guard uses (non-released reservations in this cycle, and QA ones)", /'reserved_builds',\(select count\(\*\) from public\.nxq_netlify_build_reservations where cycle_start=anchor and status<>'released'\)/.test(sql) && /'reserved_qa_builds'/.test(sql));

// ---- the page --------------------------------------------------------------------------------------------------------------------
check("the page asks before saving and shows what would change", page.includes("window.confirm(") && page.includes("describeChange("));
check("the page blocks saving while the limits are invalid", /disabled=\{busy \|\| !!problem\}/.test(page) && page.includes("budgetProblem("));
check("the page warns plainly that the emergency stop affects real clients and that this is not the Netlify credit balance", /real clients/.test(page) && /not your Netlify credit balance/.test(page));
check("the page never mentions a secret, a key or the service role", !/service_role|api[_ -]?key|secret|token/i.test(page.replace(/"nxq-page"/g, "")));

// ---- the wiring --------------------------------------------------------------------------------------------------------------------
const app = read("src/App.tsx");
check("/owner/netlify-budget is behind the owner login", /path === "\/owner\/netlify-budget"\) return <OwnerProtectedRoute><OwnerNetlifyBudget \/><\/OwnerProtectedRoute>/.test(app) && app.includes('import("./pages/OwnerNetlifyBudget")'));
check("the owner portal links to the build limit screen", read("src/pages/OwnerPortal.tsx").includes('href="/owner/netlify-budget"'));
check("test:store runs this test", read("scripts/run-store-tests.mjs").includes('"test-netlify-budget-screen"'));

console.log(failures ? `\n${failures} Netlify budget screen check(s) failed.` : "\nNetlify budget screen test passed.");
process.exit(failures ? 1 : 0);
