import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, Clock3, ServerCog } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Worker = {
  worker_key: string;
  execution_target: string;
  status: string;
  worker_version: string | null;
  queue_depth: number | null;
  oldest_job_age_seconds: number | null;
  average_job_ms: number | null;
  last_job_type: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  heartbeat_at: string;
};

type Job = {
  execution_target: string;
  status: string;
  created_at: string;
  run_after: string;
};

export function OwnerAutomationHealth() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [oldestMinutes, setOldestMinutes] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      if (!isSupabaseConfigured || !supabase) return;
      const [workerResult, jobResult] = await Promise.all([
        supabase.from("automation_worker_heartbeats").select("*").order("worker_key"),
        supabase
          .from("automation_jobs")
          .select("execution_target,status,created_at,run_after")
          .in("status", ["queued", "running", "failed", "blocked"])
          .order("created_at", { ascending: true })
          .limit(500),
      ]);

      if (!active) return;
      if (workerResult.error || jobResult.error) {
        setError(workerResult.error?.message || jobResult.error?.message || "Automation health could not load.");
        return;
      }

      const nextJobs = (jobResult.data || []) as Job[];
      setWorkers((workerResult.data || []) as Worker[]);
      setJobs(nextJobs);

      if (nextJobs.length > 0) {
        const firstCreatedAt = new Date(nextJobs[0].created_at).getTime();
        const now = new Date().getTime();
        setOldestMinutes(Math.max(0, Math.round((now - firstCreatedAt) / 60000)));
      } else {
        setOldestMinutes(0);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const queue = useMemo(
    () => jobs.reduce((acc, job) => {
      const key = `${job.execution_target}:${job.status}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    [jobs],
  );

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ServerCog size={22} />
            <div>
              <h1>Automation health</h1>
              <p className="subtle">Worker heartbeats, queue depth, stalled work, and execution-lane health.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Owner</a>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}

        <div className="portal-grid">
          <section className="panel"><Activity size={20} /><h2>Workers</h2><div className="status-summary">{workers.length}</div></section>
          <section className="panel"><Clock3 size={20} /><h2>Open jobs</h2><div className="status-summary">{jobs.length}</div></section>
          <section className="panel"><Clock3 size={20} /><h2>Oldest open</h2><div className="status-summary">{oldestMinutes} min</div></section>
        </div>

        <section className="panel panel-wide">
          <h2>Execution lanes</h2>
          {["backend", "edge", "ai"].map((lane) => (
            <div className="owner-message-card" key={lane}>
              <strong>{lane}</strong>
              <span className="subtle">
                queued {queue[`${lane}:queued`] || 0} · running {queue[`${lane}:running`] || 0} · failed {queue[`${lane}:failed`] || 0} · blocked {queue[`${lane}:blocked`] || 0}
              </span>
            </div>
          ))}
        </section>

        <section className="panel panel-wide">
          <h2>Workers</h2>
          {workers.length === 0 ? (
            <div className="empty-state">No heartbeat records yet. Workers will register here when runtime deployment is connected.</div>
          ) : (
            workers.map((worker) => (
              <article className="owner-message-card" key={worker.worker_key}>
                <div className="panel-title panel-title-row">
                  <div>
                    <strong>{worker.worker_key}</strong>
                    <p className="subtle">{worker.execution_target} · heartbeat {new Date(worker.heartbeat_at).toLocaleString()}</p>
                  </div>
                  <span className="status-summary">{worker.status}</span>
                </div>
                <p className="subtle">
                  Queue {worker.queue_depth ?? "—"} · oldest {worker.oldest_job_age_seconds ?? "—"}s · avg {worker.average_job_ms ?? "—"}ms · last job {worker.last_job_type || "—"}
                </p>
                {worker.last_error ? <div className="auth-error">{worker.last_error}</div> : null}
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
