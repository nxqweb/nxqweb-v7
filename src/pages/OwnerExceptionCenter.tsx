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

type RuntimeDispatchIncident = {
  id: string;
  client_id: string;
  project_id?: string | null;
  business_name?: string | null;
  severity: string;
  status: string;
  title: string;
  summary: string;
  created_at?: string;
};

type RuntimeDispatchData = {
  open_count: number;
  incidents: RuntimeDispatchIncident[];
  generated_at: string;
};

type EscalationRow = {
  id: string;
  client_id: string;
  project_id?: string | null;
  escalation_type: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  created_at?: string;
  clients?: { business_name?: string | null } | { business_name?: string | null }[] | null;
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

    const [exceptionResult, runtimeResult, escalationResult] = await Promise.all([
      supabase.rpc("owner_exception_center"),
      supabase.rpc("owner_runtime_dispatch_incidents"),
      // Billing, file-security and infrastructure escalations are written to
      // automation_escalations but are not part of owner_exception_center().
      // The dispatch-outage type is excluded: it is already shown via the
      // runtime incidents above.
      supabase
        .from("automation_escalations")
        .select("id, client_id, project_id, escalation_type, severity, status, title, summary, created_at, clients(business_name)")
        .in("status", ["open", "acknowledged"])
        .neq("escalation_type", "internal_edge_dispatch_network_unreachable")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (exceptionResult.error) {
      setError(`Exception center failed to load: ${exceptionResult.error.message}`);
      setLoading(false);
      return;
    }

    const base = exceptionResult.data as ExceptionCenterData;
    const escalationItems: ExceptionItem[] = ((escalationResult.data || []) as unknown as EscalationRow[]).map((row) => {
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      return {
        source: "escalation",
        id: row.id,
        client_id: row.client_id,
        project_id: row.project_id,
        business_name: client?.business_name,
        severity: row.severity,
        status: row.status,
        title: row.title,
        summary: row.summary,
        type: row.escalation_type,
        created_at: row.created_at,
      };
    });
    const escalationNotice = escalationResult.error
      ? `Escalations failed to load: ${escalationResult.error.message}`
      : "";
    if (runtimeResult.error) {
      setData({
        ...base,
        needs_owner_attention: base.needs_owner_attention + escalationItems.length,
        exceptions: [...(base.exceptions || []), ...escalationItems],
      });
      setError(`Runtime dispatch health failed to load: ${runtimeResult.error.message}`);
      setLoading(false);
      return;
    }
    if (escalationNotice) setError(escalationNotice);

    const runtime = runtimeResult.data as RuntimeDispatchData;
    const runtimeItems: ExceptionItem[] = (runtime.incidents || []).map((incident) => ({
      source: "runtime",
      id: incident.id,
      client_id: incident.client_id,
      project_id: incident.project_id,
      business_name: incident.business_name,
      severity: incident.severity,
      status: incident.status,
      title: incident.title,
      summary: incident.summary,
      type: "internal_edge_dispatch_network_unreachable",
      created_at: incident.created_at,
    }));

    setData({
      ...base,
      needs_owner_attention: base.needs_owner_attention + (runtime.open_count || 0) + escalationItems.length,
      exceptions: [...(base.exceptions || []), ...runtimeItems, ...escalationItems],
      generated_at: runtime.generated_at || base.generated_at,
    });
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
                        {item.source === "runtime" ? "NXQ detected an internal dispatch transport outage. Client jobs stay queued without burning retry attempts; use the external staging dispatcher until database networking recovers." : null}
                        {item.source === "escalation" ? "Next step: resolve the underlying billing, file-security or infrastructure cause. This view is read-only; the escalation record is unchanged." : null}
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
