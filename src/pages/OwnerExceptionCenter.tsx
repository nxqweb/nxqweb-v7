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
  const [notice, setNotice] = useState("");
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

  async function retryException(item: ExceptionItem) {
    if (!supabase || !["automation", "maintenance"].includes(item.source)) return;
    setActionId(item.id);
    setError("");
    setNotice("");
    const result = item.source === "automation"
      ? await supabase.rpc("owner_retry_automation_exception", { target_job_id: item.id })
      : await supabase.rpc("owner_retry_maintenance_exception", { target_alert_id: item.id });
    setActionId("");
    if (result.error) {
      setError(`Retry could not be queued: ${result.error.message}`);
      return;
    }
    setNotice(`${item.business_name || "Client"}: ${item.type.replaceAll("_", " ")} was safely requeued.`);
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

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {notice ? <div className="notice-card success" role="status">{notice}</div> : null}
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
                      <p className="subtle">
                        {item.source === "automation" ? "Next step: retry through the normal worker lane; every approval, tenant, provider, and publication check runs again." : null}
                        {item.source === "maintenance" ? "Next step: requeue the original check. The alert stays acknowledged until a worker completes the task successfully." : null}
                        {item.source === "seo_publish" ? "Next step: check Automation Health for its matching SEO worker job. Production remains unchanged while this run is blocked." : null}
                        {item.source === "change_request" ? "Next step: review the requested risk and missing information. Unsafe or ambiguous changes are never force-published." : null}
                      </p>
                      <div className="subtle">
                        Source: {item.source} · Type: {item.type}
                        {typeof item.attempts === "number" ? ` · Attempts: ${item.attempts}/${item.max_attempts ?? "?"}` : ""}
                        {item.execution_target ? ` · Lane: ${item.execution_target}` : ""}
                        {` · ${formatTime(item.created_at)}`}
                      </div>
                      {["automation", "maintenance"].includes(item.source) ? (
                        <div style={{ marginTop: ".7rem" }}>
                          <button className="icon-btn" type="button" disabled={actionId === item.id} onClick={() => void retryException(item)}>
                            <RotateCcw size={15} /> {actionId === item.id ? "Queueing…" : "Retry safely"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="panel panel-wide">
              <div className="panel-title panel-title-row">
                <div><h2>Recovery controls</h2><p className="subtle">Retries re-run the original safety gates. Nothing here can mark a job successful, merge production, or bypass approval.</p></div>
                <a className="icon-btn" href="/owner/automation-health">Open automation health</a>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
