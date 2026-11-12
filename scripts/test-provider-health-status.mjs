// check-provider-health must never crash a whole sweep because ONE provider answered "not_configured" (no read-only check exists for it).
// Real incident 2026-11-12: the adapter's "not_configured" reached the health-events INSERT, which only allows the statuses of migration 134
// (healthy, degraded, error, rate_limited, unauthorized, timeout, recovered), and every sweep returned HTTP 500. Offline; planted-bug controls included.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-health-status-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const importFile = (file) => import(`${pathToFileURL(file).href}?t=${Date.now()}${Math.random()}`);

const helperPath = "supabase/functions/_shared/provider-health-status.mjs";
const migration = fs.readFileSync("supabase/migrations/134_provider_observability_and_recovery_foundation.sql", "utf8");
const allowedInDatabase = (migration.match(/create table if not exists public\.nxq_provider_health_events[\s\S]*?status text not null check \(status in \(([^)]*)\)\)/) || [])[1]
  ?.split(",").map((s) => s.trim().replace(/'/g, "")) || [];
check("the allowed event statuses were read from migration 134", allowedInDatabase.length === 7 && allowedInDatabase.includes("unauthorized"), allowedInDatabase.join(","));
const adapterWords = ["healthy", "degraded", "unauthorized", "rate_limited", "timeout", "error", "not_configured"]; // the adapter's HealthStatus type

function rules(mod, ok) {
  const { classifyHealthStatus, HEALTH_EVENT_STATUSES } = mod;
  ok("the helper's event statuses are exactly the ones the database allows", [...HEALTH_EVENT_STATUSES].sort().join() === [...allowedInDatabase].sort().join());
  for (const word of adapterWords) {
    const r = classifyHealthStatus(word);
    const insertable = r.kind === "not_configured" ? r.eventStatus === null : allowedInDatabase.includes(r.eventStatus);
    ok(`adapter status "${word}" never produces a value the events table rejects`, insertable, JSON.stringify(r));
  }
  const nc = classifyHealthStatus("not_configured");
  ok('"not_configured" is skipped (no event) and the provider stays "not_configured", never "degraded"', nc.kind === "not_configured" && nc.eventStatus === null && nc.connectionStatus === "not_configured");
  ok("an unknown word from the adapter is recorded as an error instead of crashing", classifyHealthStatus("weird_new_status").eventStatus === "error" && classifyHealthStatus("weird_new_status").connectionStatus === "error");
  ok("a missing status is an error", classifyHealthStatus(undefined).eventStatus === "error" && classifyHealthStatus("").eventStatus === "error");
  ok("healthy and recovered make the connection healthy", classifyHealthStatus("healthy").connectionStatus === "healthy" && classifyHealthStatus("recovered").connectionStatus === "healthy");
  ok("degraded, rate_limited and timeout make it degraded", ["degraded", "rate_limited", "timeout"].every((w) => classifyHealthStatus(w).connectionStatus === "degraded"));
  ok("unauthorized and error make it error (a dead token is not hidden)", ["unauthorized", "error"].every((w) => classifyHealthStatus(w).connectionStatus === "error") && classifyHealthStatus("unauthorized").eventStatus === "unauthorized");
}
rules(await importFile(path.resolve(helperPath)), check);

// planted bugs
const source = fs.readFileSync(helperPath, "utf8");
const mutants = [
  ["not_configured is passed through to the events table (the real bug)", [['if (value === "not_configured") return', 'if (false) return']]],
  ["not_configured is called degraded", [['connectionStatus: "not_configured" }', 'connectionStatus: "degraded" }']]],
  ["unknown words are passed through unchanged", [['HEALTH_EVENT_STATUSES.includes(value) ? value : "error"', "value"]]],
  ["unauthorized is hidden as healthy", [['let connectionStatus = "error";', 'let connectionStatus = "healthy";']]],
];
mutants.forEach(([name, edits], i) => {
  let text = source;
  const applied = edits.every(([from, to]) => { if (!text.includes(from)) return false; text = text.replace(from, to); return true; });
  const file = path.join(tmp, `mutant-${i}.mjs`);
  fs.writeFileSync(file, text);
  let caught = 0;
  return importFile(file).then((mod) => { rules(mod, (_n, cond) => { if (!cond) caught += 1; }); }).catch(() => { caught += 1; }).finally(() => {
    check(`PLANTED BUG caught: ${name}`, applied && caught > 0, applied ? "no check failed" : "the edit did not apply");
  });
});
await new Promise((r) => setTimeout(r, 500));

// how the function uses it
const fn = fs.readFileSync("supabase/functions/check-provider-health/index.ts", "utf8");
check("the function imports the helper", fn.includes('import { classifyHealthStatus } from "../_shared/provider-health-status.mjs";'));
const skip = fn.indexOf('outcome.kind === "not_configured"');
const insert = fn.indexOf('.from("nxq_provider_health_events")');
check("the not_configured skip comes BEFORE the health-events insert", skip > 0 && insert > skip);
check("the skip continues the loop and does not insert", /outcome\.kind === "not_configured"\) \{[\s\S]*?notConfigured \+= 1;\s*continue;\s*\}/.test(fn));
check("the event row is written with the classified status, not the raw adapter word", fn.includes("status: healthStatus,") && fn.includes("String(outcome.eventStatus)"));
check("connectionStatusFromHealth is kept (the contract validator looks for it)", fn.includes("function connectionStatusFromHealth"));

console.log(failures ? `\n${failures} provider health status check(s) failed.` : "\nProvider health status test passed.");
process.exit(failures ? 1 : 0);
