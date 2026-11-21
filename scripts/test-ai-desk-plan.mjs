// The build-plan worker's AI Desk logic (supabase/functions/_shared/ai-desk-plan.mjs) against a tiny in-memory fake of the service-role client,
// plus source checks that prepare-build-plan wires it safely. Offline, no network, no secrets.
import fs from "node:fs";
import { resolveDeskPlan, rejectDeskPlan, markDeskPlanUsed, isMissingDeskTable } from "../supabase/functions/_shared/ai-desk-plan.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

// Minimal fake: from(table).select().eq().in() / .update(v).eq().eq() / .insert(v). Enforces the one-open-row-per-client rule like the real index.
function fakeAdmin({ missingTable = false, failOn = "" } = {}) {
  const rows = [];
  let nextId = 1;
  const api = {
    rows,
    from(table) {
      if (missingTable) return { select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } }) }) }) };
      const filters = [];
      const matches = (row) => filters.every(([k, op, v]) => (op === "in" ? v.includes(row[k]) : row[k] === v));
      return {
        select() {
          const q = { eq(k, v) { filters.push([k, "eq", v]); return q; }, in(k, v) { filters.push([k, "in", v]); return Promise.resolve({ data: rows.filter(matches).map((r) => ({ ...r })), error: null }); } };
          return q;
        },
        update(values) {
          const q = { eq(k, v) { filters.push([k, "eq", v]); return q; }, then(resolve) {
            if (failOn === "update") return resolve({ error: { message: "update boom" } });
            if (values.status === "waiting" || values.status === "saved") {
              /* not used by the worker */
            }
            rows.filter(matches).forEach((r) => Object.assign(r, values));
            return resolve({ error: null });
          } };
          return q;
        },
        insert(values) {
          if (failOn === "insert") return Promise.resolve({ error: { message: "insert boom" } });
          if (rows.some((r) => r.client_id === values.client_id && ["waiting", "saved"].includes(r.status)) && ["waiting", "saved"].includes(values.status || "waiting")) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint ai_desk_build_plans_one_open_idx" } });
          }
          rows.push({ id: `row-${nextId++}`, status: "waiting", result: null, ...values });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return api;
}

const FP1 = "a".repeat(64);
const FP2 = "b".repeat(64);
const req = (fp) => ({ task: "enrich_business_build_plan_v1", schema_version: "nxq-business-build-plan-v1", request_fingerprint: fp, input: { business_name: "Candle Co" }, contract: {} });

// 1. first run: no row yet -> records the exact task and waits
let admin = fakeAdmin();
let out = await resolveDeskPlan(admin, { clientId: "c1", request: req(FP1) });
check("first run records the exact task and reports waiting", out.kind === "waiting" && admin.rows.length === 1 && admin.rows[0].status === "waiting" && admin.rows[0].desk_fingerprint === FP1 && admin.rows[0].request.request_fingerprint === FP1);
out = await resolveDeskPlan(admin, { clientId: "c1", request: req(FP1) });
check("a second run does not duplicate the waiting task", out.kind === "waiting" && admin.rows.length === 1);

// 2. the owner saves an answer for that task -> used as a plan
admin.rows[0].status = "saved"; admin.rows[0].result = { confidence: 0.9 };
out = await resolveDeskPlan(admin, { clientId: "c1", request: req(FP1) });
check("a saved answer for the same fingerprint is returned as the plan", out.kind === "plan" && out.id === admin.rows[0].id && out.result.confidence === 0.9);

// 3. planted bug control: the setup sheet changed (new fingerprint) -> the old answer must NOT be used
out = await resolveDeskPlan(admin, { clientId: "c1", request: req(FP2) });
check("a saved answer for an OLDER fingerprint is never used", out.kind === "waiting");
check("the stale row is retired and a fresh task for the new fingerprint is waiting", admin.rows[0].status === "superseded" && admin.rows.length === 2 && admin.rows[1].status === "waiting" && admin.rows[1].desk_fingerprint === FP2);

// 4. another client's saved answer is never picked up
admin = fakeAdmin();
admin.rows.push({ id: "other", client_id: "c2", status: "saved", desk_fingerprint: FP1, result: { confidence: 0.9 } });
out = await resolveDeskPlan(admin, { clientId: "c1", request: req(FP1) });
check("another client's saved answer is never used", out.kind === "waiting" && admin.rows.find((r) => r.id === "other").status === "saved");

// 5. rejection: marked rejected with the reason, and a fresh task is waiting
admin = fakeAdmin();
admin.rows.push({ id: "p1", client_id: "c1", status: "saved", desk_fingerprint: FP1, result: { confidence: 0.9 }, request: req(FP1) });
const rejected = await rejectDeskPlan(admin, { clientId: "c1", id: "p1", reason: "AI build-plan contains unsupported marketing claims: quality claim.", request: req(FP1) });
check("a rejected answer is marked with its plain reason", rejected.ok && admin.rows[0].status === "rejected" && /quality claim/.test(admin.rows[0].last_error));
check("after a rejection a fresh waiting task exists for the same fingerprint", admin.rows.length === 2 && admin.rows[1].status === "waiting" && admin.rows[1].desk_fingerprint === FP1);
const longReason = await rejectDeskPlan(fakeAdmin(), { clientId: "c1", id: "none", reason: "x".repeat(5000), request: req(FP1) });
check("rejection reasons are capped for the database", longReason.ok);
const capped = fakeAdmin(); capped.rows.push({ id: "p9", client_id: "c1", status: "saved", desk_fingerprint: FP1, result: {}, request: req(FP1) });
await rejectDeskPlan(capped, { clientId: "c1", id: "p9", reason: "x".repeat(5000), request: req(FP1) });
check("the stored reason is at most 2000 characters", capped.rows[0].last_error.length === 2000);

// 6. used
admin = fakeAdmin();
admin.rows.push({ id: "p1", client_id: "c1", status: "saved", desk_fingerprint: FP1, result: {} });
check("marking used works on a saved row", (await markDeskPlanUsed(admin, "p1")).ok && admin.rows[0].status === "used" && Boolean(admin.rows[0].used_at));
admin.rows.push({ id: "p2", client_id: "c1", status: "waiting", desk_fingerprint: FP1 });
await markDeskPlanUsed(admin, "p2");
check("marking used never touches a row that is not saved", admin.rows[1].status === "waiting");

// 7. table missing (migration not applied yet) -> "unavailable", never a throw
out = await resolveDeskPlan(fakeAdmin({ missingTable: true }), { clientId: "c1", request: req(FP1) });
check("a missing table is reported as unavailable (the old not-configured behaviour)", out.kind === "unavailable");
check("missing-table detection covers Postgres and PostgREST wording", isMissingDeskTable({ code: "42P01" }) && isMissingDeskTable({ code: "PGRST205" }) && isMissingDeskTable({ message: "Could not find the table 'public.ai_desk_build_plans' in the schema cache" }) && !isMissingDeskTable({ code: "42501", message: "permission denied" }) && !isMissingDeskTable(null));

// 8. real database errors are surfaced, not swallowed
out = await resolveDeskPlan(fakeAdmin({ failOn: "insert" }), { clientId: "c1", request: req(FP1) });
check("a failed insert is reported as an error", out.kind === "error" && /bookkeeping/.test(out.message));

// 9. an oversized task is refused with a plain message, not a database error
const big = req(FP1); big.input = { ...big.input, goals: "g".repeat(13000) };
out = await resolveDeskPlan(fakeAdmin(), { clientId: "c1", request: big });
check("a task too big for the table is refused with a plain message", out.kind === "error" && /too long/.test(out.message));

// Worker wiring (source)
const worker = fs.readFileSync("supabase/functions/prepare-build-plan/index.ts", "utf8");
const helper = fs.readFileSync("supabase/functions/_shared/ai-desk-plan.mjs", "utf8");
check("retiring an old row only touches a row that is still in the state we read", /superseded" \}\)\.eq\("id", stale\.id\)\.eq\("status", stale\.status\)/.test(helper));
check("the worker looks again after one minute, matching what the owner screen promises", !/retry_after: "5 minutes"/.test(worker.split("resolveDeskPlan(admin")[1] || "") && (worker.match(/retry_after: "1 minute"/g) || []).length >= 2);
check("worker imports the desk helper", worker.includes('from "../_shared/ai-desk-plan.mjs"'));
check("the AI adapter wins whenever it is configured; the desk is only the no-key path", /if \(adapterConfigured\) \{\s*aiResult = await requestAiStrategy/.test(worker) && /\} else \{\s*\/\/ No AI key yet/.test(worker));
check("a desk answer goes through the same validateAiStrategy as an adapter reply", /validateAiStrategy\(desk\.result, services, pages, aiInput\)/.test(worker));
check("a desk answer's fingerprint is compared with this intake's fingerprint", worker.includes("aiResult.request_fingerprint !== inputFingerprint"));
check("waiting and rejected deferrals use the defer RPC (retries are not used up)", (worker.match(/defer_external_automation_job_v2/g) || []).length >= 2 && !/fail_external_automation_job_v2[\s\S]{0,200}Waiting for the owner/.test(worker));
check("the desk plan is marked used only after the job completed", worker.indexOf("complete_external_automation_job_v2") < worker.indexOf("markDeskPlanUsed(admin, deskPlanId)"));
check("the plan records where it came from", worker.includes('ai_source: deskPlanId ? "owner_ai_desk" : "ai_adapter"'));
check("the worker and the desk task use one request builder", (worker.match(/adapterRequestBody\(/g) || []).length === 3);
check("contacts are still kept out of the desk task input", !/aiInput = \{[^}]*contact/.test(worker));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll AI Desk worker checks passed.");
process.exit(failures ? 1 : 0);
