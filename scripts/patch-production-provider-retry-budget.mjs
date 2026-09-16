import fs from "node:fs";

const path = "supabase/functions/promote-business-production/index.ts";
let source = fs.readFileSync(path, "utf8");

if (source.includes('admin.rpc("defer_external_provider_billing_job"')) {
  console.log("Provider retry-budget preservation already wired.");
  process.exit(0);
}

const oldBlock = `      const deferred = await admin.from("automation_jobs").update({
        status: "queued",
        run_after: retryAt,
        last_error: blocker,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      if (deferred.error) {
        console.error("Failed to defer provider billing blocker", deferred.error.message);
        return response({ error: message, job_id: job.id }, 500);
      }
`;

const newBlock = `      const deferred = await admin.rpc("defer_external_provider_billing_job", {
        target_job_id: job.id,
        worker_name: workerName,
        target_error: blocker,
      });
      if (deferred.error) {
        console.error("Failed to defer provider billing blocker", deferred.error.message);
        return response({ error: message, job_id: job.id }, 500);
      }
`;

if (!source.includes(oldBlock)) throw new Error("Provider billing defer block not found.");
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source);
console.log("Wired provider billing deferral to retry-budget-preserving RPC.");
