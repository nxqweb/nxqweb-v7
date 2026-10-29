// AI Desk plans for the build-plan worker. Pure functions that take the service-role client as a parameter so they can be tested offline.
// Flow: with no AI key configured, the worker records the exact task it would have sent (a 'waiting' row), the owner has the AI Desk chat
// write the answer and saves it, and the worker uses the saved answer only after its normal full validation. See docs/AI_DESK_KIT.md.
// Everything here tolerates the table not existing yet (migration 09 not applied): that case is reported as "unavailable", never thrown.

export const DESK_TABLE = "ai_desk_build_plans";

export function isMissingDeskTable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || (message.includes(DESK_TABLE) && (message.includes("does not exist") || message.includes("schema cache")));
}

// Returns one of:
//   { kind: "unavailable" }                         the table is not there (old behaviour: "adapter not configured")
//   { kind: "plan", id, result }                    a saved answer for exactly this task fingerprint
//   { kind: "waiting" }                             the task is recorded; the owner has to supply the answer
//   { kind: "error", message }                      the lookup or the bookkeeping failed (the worker fails the job and retries later)
const DESK_REQUEST_MAX = 12000;

export async function resolveDeskPlan(admin, { clientId, request }) {
  const fingerprint = request.request_fingerprint;
  // The table limits what one task may hold; refuse a bigger one with a plain message instead of a database error.
  if (JSON.stringify(request).length > DESK_REQUEST_MAX) return { kind: "error", message: "This client's setup sheet is too long for one AI Desk task. Ask the client to shorten the long answers." };
  const open = await admin.from(DESK_TABLE).select("id,status,desk_fingerprint,result").eq("client_id", clientId).in("status", ["waiting", "saved"]);
  if (open.error) return isMissingDeskTable(open.error) ? { kind: "unavailable" } : { kind: "error", message: `AI Desk lookup failed: ${open.error.message}` };
  const rows = Array.isArray(open.data) ? open.data : [];

  const saved = rows.find((row) => row.status === "saved" && row.desk_fingerprint === fingerprint && row.result);
  if (saved) return { kind: "plan", id: saved.id, result: saved.result };

  const current = rows.find((row) => row.status === "waiting" && row.desk_fingerprint === fingerprint);
  // Anything else open was made for an older version of the setup sheet: retire it so the one-open-row-per-client rule lets the new task in.
  for (const stale of rows.filter((row) => row !== current)) {
    const retired = await admin.from(DESK_TABLE).update({ status: "superseded" }).eq("id", stale.id).eq("status", stale.status);
    if (retired.error) return { kind: "error", message: `AI Desk bookkeeping failed: ${retired.error.message}` };
  }
  if (!current) {
    const created = await admin.from(DESK_TABLE).insert({ client_id: clientId, desk_fingerprint: fingerprint, request, status: "waiting" });
    if (created.error) return { kind: "error", message: `AI Desk bookkeeping failed: ${created.error.message}` };
  }
  return { kind: "waiting" };
}

// A saved answer failed the worker's full validation: say why, and put a fresh task up so the owner can try again.
export async function rejectDeskPlan(admin, { clientId, id, reason, request }) {
  const marked = await admin.from(DESK_TABLE).update({ status: "rejected", last_error: String(reason || "Rejected.").slice(0, 2000) }).eq("id", id);
  if (marked.error) return { ok: false, message: marked.error.message };
  const again = await resolveDeskPlan(admin, { clientId, request });
  return again.kind === "error" ? { ok: false, message: again.message } : { ok: true };
}

export async function markDeskPlanUsed(admin, id) {
  const done = await admin.from(DESK_TABLE).update({ status: "used", used_at: new Date().toISOString() }).eq("id", id).eq("status", "saved");
  return done.error ? { ok: false, message: done.error.message } : { ok: true };
}
