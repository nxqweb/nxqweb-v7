import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCcw, RotateCcw, ShieldAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ExceptionItem = {
  source: "maintenance" | "automation" | string;
  id: string;
  client_id: string;
  project_id?: string | null;
  business_name?: string | null;
  severity: string;
  status: string;
  title: string;
  summary: string;
  type: string;
  execution_target?: string;
  attempts?: number;
  max_attempts?: number;
  created_at?: string;
};

type ExceptionCenterData = {
  healthy_clients: number;
  auto_retrying: number;
  needs_owner_attention: number;
  open_maintenance_alerts: number;
  exceptions: ExceptionItem[];
  generated_at: string;
};

function formatTime(value?: string) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function OwnerExceptionCenter() {
  const [data, setData] = useState<ExceptionCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const result = await supabase.rpc("owner_exception_center");
    if (result.error) {
      setError(`Exception center failed to load: ${result.error.message}`);
    } else {
      setData(result.data as ExceptionCenterData);
    }
    setLoading(false);
  }

  async function retryAutomation(item: ExceptionItem) {
    if (!supabase || item.source !== "automation") return;
    setActionId(item.id);
    setError("");
    const result = await supabase.rpc("owner_retry_automation_exception", { target_job_id: item.id });
    setActionId("");
    if (result.error) {
      setError(`Retry could not be queued: ${result.error.message}`);
      return;
    }
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  const sortedExceptions = useMemo(() => {
    const priority: Record<string, number> = { critical: 0, high: 1, warning: 2, info: 3 };
    return [...(data?.exceptions || [])].sort((a, b) => (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9));
  }, [data]);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShieldAlert size={24} />
            <div>
              <h1>NXQ Exception Center</h1>
              <p className="subtle">The owner view for things automation could not safely finish on its own.</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
            <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCcw size={16} /> Refresh
            </button>
            <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a>
          </div>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading operational health...</div> : null}

        {!loading && data ? (
          <>
            <div className="owner-detail-grid">
              <section className="panel">
                <CheckCircle2 size={22} />
                <h2>{data.healthy_clients}</h2>
                <p className="subtle">Healthy clients</p>
              </section>
              <section className="panel">
                <RotateCcw size={22} />
                <h2>{data.auto_retrying}</h2>
                <p className="subtle">Auto-retrying now</p>
              </section>
              <section className="panel">
                <AlertTriangle size={22} />
                <h2>{data.needs_owner_attention}</h2>
                <p className="subtle">Needs owner attention</p>
              </section>
            </div>

            <section className="panel panel-wide" style={{ marginTop: "1rem" }}>
              <div className="panel-title">
                <ShieldAlert size={20} />
                <div>
                  <h2>Exceptions</h2>
                  <p className="subtle">Routine retries stay hidden here until NXQ exhausts its safe recovery path.</p>
                </div>
              </div>

              {sortedExceptions.length === 0 ? (
                <div className="empty-state">No owner exceptions. Automation is handling current work.</div>
              ) : (
                <div style={{ display: "grid", gap: ".8rem" }}>
                  {sortedExceptions.map((item) => (
                    <article className="owner-message-card" key={`${item.source}-${item.id}`}>
                      <div className="panel-title panel-title-row">
                        <div>
                          <strong>{item.business_name || "Unknown client"}</strong>
                          <div className="subtle">{item.title}</div>
                        </div>
                        <span className="status-chip">{item.severity}</span>
                      </div>
                      <p>{item.summary}</p>
                      <div className="subtle">
                        Source: {item.source} · Type: {item.type}
                        {typeof item.attempts === "number" ? ` · Attempts: ${item.attempts}/${item.max_attempts ?? "?"}` : ""}
                        {item.execution_target ? ` · Lane: ${item.execution_target}` : ""}
                        {` · ${formatTime(item.created_at)}`}
                      </div>
                      {item.source === "automation" ? (
                        <div style={{ marginTop: ".7rem" }}>
                          <button className="icon-btn" type="button" disabled={actionId === item.id} onClick={() => void retryAutomation(item)}>
                            <RotateCcw size={15} /> {actionId === item.id ? "Queueing…" : "Retry safely"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}