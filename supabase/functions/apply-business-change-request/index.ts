import { createClient } from "npm:@supabase/supabase-js@2";

type Job = {
  id: string;
  lock_token: string;
  client_id: string;
  project_id: string;
  job_type: string;
  payload?: Record<string, unknown> | null;
};
type JsonRecord = Record<string, unknown>;

const workerName = "apply-business-change-request";
const headers = { "Content-Type": "application/json" };

function secret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing protected secret: ${name}`);
  return value;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}
function normalize(value: unknown): Job | null {
  if (value == null) return null;
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (Array.isArray(parsed)) parsed = parsed[0] ?? null;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid change job.");
  const job = parsed as Job;
  if (!job.id || !job.lock_token || !job.client_id || !job.project_id) {
    throw new Error("Change job missing job, lease, client, or project id.");
  }
  return job;
}
function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  if (req.headers.get("x-nxq-worker-token") !== secret("NXQ_AUTOMATION_WORKER_TOKEN")) {
    return response({ ok: false, error: "Unauthorized." }, 401);
  }

  const admin = createClient(
    secret("SUPABASE_URL"),
    secret("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  let job: Job | null = null;

  try {
    const claim = await admin.rpc("claim_next_external_automation_job_v2", {
      target_execution_target: "edge",
      worker_name: workerName,
      target_job_types: ["website_apply_change_request"],
    });
    if (claim.error) throw new Error(`Change job claim failed: ${claim.error.message}`);
    job = normalize(claim.data);
    if (!job) return response({ ok: true, claimed: false });

    const changeId = String(job.payload?.change_request_id || "");
    if (!changeId) throw new Error("Change job missing change_request_id.");

    const applied = await admin.rpc("apply_structured_website_change_atomic", {
      target_change_request_id: changeId,
      target_client_id: job.client_id,
      target_project_id: job.project_id,
    });
    if (applied.error) throw new Error(`Atomic website change failed: ${applied.error.message}`);

    const appliedResult = record(applied.data);
    if (appliedResult.ok !== true) throw new Error("Atomic website change did not confirm success.");
    const changed = stringArray(appliedResult.changed_fields);
    const buildPlanVersion = Number(appliedResult.build_plan_version || 0);
    if (!Number.isFinite(buildPlanVersion) || buildPlanVersion < 1) {
      throw new Error("Atomic website change did not return a valid build-plan version.");
    }

    // This step is intentionally outside the plan mutation transaction. If it fails,
    // the automation job retries and the atomic RPC returns the already-persisted
    // revision rather than applying the same client change twice.
    const bootstrap = await admin.rpc("bootstrap_ready_website_automation");
    if (bootstrap.error) throw new Error(`Website rebuild bootstrap failed: ${bootstrap.error.message}`);

    const runRes = await admin.from("website_automation_runs")
      .select("id,status,source_branch")
      .eq("client_id", job.client_id)
      .eq("project_id", job.project_id)
      .not("status", "in", "(published,failed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runRes.error) throw new Error(`Website rebuild run lookup failed: ${runRes.error.message}`);
    if (!runRes.data?.id) throw new Error("Website rebuild bootstrap did not produce an active automation run.");

    const automationPlan = {
      route: "structured_rebuild",
      changed_fields: changed,
      build_plan_version: buildPlanVersion,
      website_automation_run_id: runRes.data.id,
      source_branch: runRes.data.source_branch,
      run_status: runRes.data.status,
      atomic_change_applied: true,
      replayed_atomic_change: appliedResult.already_applied === true,
    };
    const changeUpdate = await admin.from("website_change_requests")
      .update({
        status: "building",
        automation_plan: automationPlan,
        updated_at: new Date().toISOString(),
      })
      .eq("id", changeId)
      .eq("client_id", job.client_id)
      .eq("project_id", job.project_id);
    if (changeUpdate.error) throw new Error(`Change request state failed: ${changeUpdate.error.message}`);

    const complete = await admin.rpc("complete_external_automation_job_v2", {
      target_job_id: job.id,
      target_lock_token: job.lock_token,
      worker_name: workerName,
      target_result: {
        change_request_id: changeId,
        changed_fields: changed,
        build_plan_version: buildPlanVersion,
        website_automation_run_id: runRes.data.id,
        website_automation_bootstrap: bootstrap.data,
        replayed_atomic_change: appliedResult.already_applied === true,
      },
    });
    if (complete.error) throw new Error(`Change job completion failed: ${complete.error.message}`);

    return response({
      ok: true,
      claimed: true,
      job_id: job.id,
      change_request_id: changeId,
      changed_fields: changed,
      build_plan_version: buildPlanVersion,
      website_automation_run_id: runRes.data.id,
      replayed_atomic_change: appliedResult.already_applied === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown change request worker failure";
    if (job?.id && job.lock_token) {
      await admin.rpc("fail_external_automation_job_v2", {
        target_job_id: job.id,
        target_lock_token: job.lock_token,
        worker_name: workerName,
        target_error: message,
      });
    }
    return response({ ok: false, job_id: job?.id || null, error: message }, 500);
  }
});
