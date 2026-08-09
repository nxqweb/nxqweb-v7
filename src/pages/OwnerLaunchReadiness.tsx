import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, FlaskConical, RefreshCcw, Rocket, ShieldAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Check = {
  id: string;
  check_key: string;
  category: string;
  title: string;
  required: boolean;
  status: string;
  evidence: Record<string, unknown>;
  last_checked_at: string | null;
  checked_by: string | null;
};

type QaRun = {
  id: string;
  run_code: string;
  test_kind: string;
  target_outcome: "approve" | "deny" | null;
  status: string;
  phase: string;
  sequence_group: string | null;
  sequence_number: number | null;
  failure_reason: string | null;
  started_at: string;
  completed_at: string | null;
};

export function OwnerLaunchReadiness() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [qaRuns, setQaRuns] = useState<QaRun[]>([]);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [startingQa, setStartingQa] = useState<"approve" | "deny" | null>(null);

  async function load() {
    if (!isSupabaseConfigured || !supabase) return;
    const [checkResult, qaResult] = await Promise.all([
      supabase.from("launch_readiness_checks").select("*").order("category").order("title"),
      supabase
        .from("qa_lifecycle_runs")
        .select("id,run_code,test_kind,target_outcome,status,phase,sequence_group,sequence_number,failure_reason,started_at,completed_at")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);
    if (checkResult.error || qaResult.error) {
      setError(checkResult.error?.message || qaResult.error?.message || "Launch readiness could not be loaded.");
      return;
    }
    setError("");
    setChecks((checkResult.data || []) as Check[]);
    setQaRuns((qaResult.data || []) as QaRun[]);
  }

  async function startQaRun(targetOutcome: "approve" | "deny") {
    if (!supabase) return;
    const confirmed = window.confirm(
      targetOutcome === "approve"
        ? "Start one disposable APPROVE-path Business QA run?\n\nThis creates a fictional QA client and a pending approval only. No GitHub or Netlify infrastructure is created until you review and Accept that normal approval. If accepted, the isolated test may create one private repository, one Netlify QA site, and publish that disposable test site. Billing and external customer notifications are database-blocked."
        : "Start one disposable DENY-path Business QA run?\n\nThis creates a fictional QA client and a pending approval only. Deny it in the normal approval queue. The strict test passes only if zero project, repository, Netlify, billing, and external notification infrastructure is created."
    );
    if (!confirmed) return;

    setStartingQa(targetOutcome);
    setError("");
    setActionMessage("");
    const result = await supabase.rpc("start_disposable_business_qa_run", {
      target_outcome: targetOutcome,
      target_sequence_group: null,
    });
    setStartingQa(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const data = result.data as { run_code?: string } | null;
    setActionMessage(`${data?.run_code || "Disposable QA"} created. Complete its ${targetOutcome.toUpperCase()} decision in the normal owner approval queue.`);
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  const required = checks.filter((check) => check.required);
  const ready = required.filter((check) => check.status === "ready").length;
  const blocked = required.filter((check) => check.status === "blocked" || check.status === "unknown").length;
  const pct = required.length ? Math.round((ready / required.length) * 100) : 0;

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Rocket size={22} />
            <div>
              <h1>Launch readiness</h1>
              <p className="subtle">Evidence-driven launch gate. This never replaces your explicit final launch approval.</p>
            </div>
          </div>
          <div className="client-control-row">
            <button className="icon-btn" type="button" onClick={() => void load()}><RefreshCcw size={16} /> Refresh</button>
            <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Owner</a>
          </div>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {actionMessage ? <div className="auth-success">{actionMessage}</div> : null}

        <div className="portal-grid">
          <section className="panel"><h2>Required ready</h2><div className="status-summary">{ready}/{required.length}</div></section>
          <section className="panel"><h2>Readiness</h2><div className="status-summary">{pct}%</div></section>
          <section className="panel"><h2>Blocking/unknown</h2><div className="status-summary">{blocked}</div></section>
        </div>

        <section className="panel panel-wide">
          {checks.map((check) => (
            <article className="owner-message-card" key={check.id}>
              <div className="panel-title panel-title-row">
                <div className="panel-title">
                  {check.status === "ready" ? <CheckCircle2 size={18} /> : check.status === "warning" ? <AlertTriangle size={18} /> : <ShieldAlert size={18} />}
                  <div>
                    <strong>{check.title}</strong>
                    <p className="subtle">{check.category} · {check.check_key} · {check.required ? "required" : "optional"}</p>
                  </div>
                </div>
                <span className="status-summary">{check.status.replaceAll("_", " ")}</span>
              </div>
              {check.last_checked_at ? <p className="subtle">Checked {new Date(check.last_checked_at).toLocaleString()} {check.checked_by ? `by ${check.checked_by}` : ""}</p> : null}
            </article>
          ))}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title panel-title-row">
            <div className="panel-title">
              <FlaskConical size={20} />
              <div>
                <h2>Disposable Business lifecycle QA</h2>
                <p className="subtle">Starts one fictional client at a time. You still make the normal APPROVE or DENY decision; monitoring and strict evidence evaluation are automatic.</p>
              </div>
            </div>
            <a className="icon-btn" href="/owner">Open approval queue</a>
          </div>

          <div className="client-control-row">
            <button type="button" disabled={startingQa !== null || qaRuns.some((run) => run.status === "running")} onClick={() => void startQaRun("approve")}>
              {startingQa === "approve" ? "Starting…" : "Start APPROVE-path QA"}
            </button>
            <button type="button" disabled={startingQa !== null || qaRuns.some((run) => run.status === "running")} onClick={() => void startQaRun("deny")}>
              {startingQa === "deny" ? "Starting…" : "Start DENY-path QA"}
            </button>
          </div>

          {qaRuns.length === 0 ? <div className="empty-state">No monitored disposable QA runs yet.</div> : null}
          <div className="owner-message-list">
            {qaRuns.map((run) => (
              <article className="owner-message-card" key={run.id}>
                <div className="panel-title panel-title-row">
                  <div>
                    <strong>{run.run_code} · {(run.target_outcome || run.test_kind).replaceAll("_", " ").toUpperCase()}</strong>
                    <p className="subtle">
                      {run.sequence_group || "unsequenced"}{run.sequence_number ? ` #${run.sequence_number}` : ""} · started {new Date(run.started_at).toLocaleString()}
                    </p>
                  </div>
                  <span className="status-summary">{run.status.replaceAll("_", " ")}</span>
                </div>
                <p className="subtle">Phase: {run.phase.replaceAll("_", " ")}</p>
                {run.failure_reason ? <div className="auth-error">{run.failure_reason}</div> : null}
                {run.completed_at ? <p className="subtle">Completed {new Date(run.completed_at).toLocaleString()}.</p> : null}
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
