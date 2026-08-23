import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, ExternalLink, Fingerprint, RefreshCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ProductMembership = {
  product_slug: string;
  product_name: string;
  membership_status: string;
  product_role: string;
};

type RecentCheck = {
  task_type: string;
  status: string;
  checked_at: string;
  result?: Record<string, unknown>;
  last_error?: string | null;
};

type HealthData = {
  client_id: string;
  client_code: string | null;
  business_name: string;
  client_status: string;
  nxq_id: string | null;
  nxq_account_status: string | null;
  assurance_level: number;
  email_verified: boolean;
  phone_verified: boolean;
  product_memberships: ProductMembership[];
  project_id: string | null;
  project_stage: string | null;
  website_status: string | null;
  production_url: string | null;
  deployment_status: string | null;
  maintenance_status: string | null;
  last_maintenance_at: string | null;
  latest_maintenance_error: string | null;
  open_alerts: number;
  high_alerts: number;
  health: string;
  recent_checks: RecentCheck[];
};

function pretty(value: string | null | undefined) {
  return (value || "Not available").replaceAll("_", " ");
}

function formatTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function ClientWebsiteHealth() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("current_client_operational_health");
    if (result.error) setError(`Website health failed to load: ${result.error.message}`);
    else setData(result.data as HealthData);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const healthTone = useMemo(() => {
    if (!data) return "info";
    if (data.health === "healthy") return "success";
    if (data.health === "needs_attention") return "danger";
    if (data.health === "watching") return "warning";
    return "info";
  }, [data]);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Activity size={24} />
            <div>
              <h1>Website health</h1>
              <p className="subtle">Live status, monitoring, maintenance, and your NXQ identity.</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
            <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCcw size={16} /> Refresh
            </button>
            <a className="icon-btn" href="/client"><ArrowLeft size={16} /> Back to portal</a>
          </div>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading website health...</div> : null}

        {!loading && data ? (
          <>
            <section className={`notice-card portal-decision-notice ${healthTone}`}>
              <div className="panel-title">
                {data.health === "healthy" ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}
                <div>
                  <strong>{pretty(data.health)}</strong>
                  <p>
                    {data.health === "healthy"
                      ? "NXQ is monitoring this website and no current exception needs attention."
                      : "NXQ is still setting up, watching, or recovering part of this website automatically."}
                  </p>
                </div>
              </div>
            </section>

            <div className="owner-detail-grid" style={{ marginTop: "1rem" }}>
              <section className="panel">
                <ShieldCheck size={20} />
                <h2>Website</h2>
                <p className="subtle">Deployment: {pretty(data.deployment_status)}</p>
                <p className="subtle">Monitoring: {pretty(data.maintenance_status)}</p>
                <p className="subtle">Open alerts: {data.open_alerts}</p>
                {data.production_url ? (
                  <a className="wide-btn" href={data.production_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} /> Open live website
                  </a>
                ) : null}
              </section>

              <section className="panel">
                <Fingerprint size={20} />
                <h2>NXQ ID</h2>
                <p><strong>{data.nxq_id || "Pending setup"}</strong></p>
                <p className="subtle">NXQ-Web Client ID: {data.client_code || "Pending"}</p>
                <p className="subtle">Identity assurance: Level {data.assurance_level}</p>
                <p className="subtle">Account: {pretty(data.nxq_account_status)}</p>
              </section>

              <section className="panel">
                <Activity size={20} />
                <h2>Maintenance</h2>
                <p className="subtle">Last maintenance: {formatTime(data.last_maintenance_at)}</p>
                <p className="subtle">Project stage: {pretty(data.project_stage)}</p>
                <p className="subtle">Website status: {pretty(data.website_status)}</p>
                {data.latest_maintenance_error ? <p className="auth-error">{data.latest_maintenance_error}</p> : null}
              </section>
            </div>

            <section className="panel panel-wide" style={{ marginTop: "1rem" }}>
              <div className="panel-title">
                <Activity size={20} />
                <div>
                  <h2>Recent automated checks</h2>
                  <p className="subtle">Evidence-based checks NXQ has actually run.</p>
                </div>
              </div>
              {data.recent_checks.length === 0 ? (
                <div className="empty-state">No maintenance checks have completed yet.</div>
              ) : (
                <div style={{ display: "grid", gap: ".7rem" }}>
                  {data.recent_checks.map((check, index) => (
                    <article className="owner-message-card" key={`${check.task_type}-${check.checked_at}-${index}`}>
                      <strong>{pretty(check.task_type)}</strong>
                      <span className="subtle">Status: {pretty(check.status)} · {formatTime(check.checked_at)}</span>
                      {check.last_error ? <span className="subtle">{check.last_error}</span> : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel panel-wide" style={{ marginTop: "1rem" }}>
              <div className="panel-title">
                <Fingerprint size={20} />
                <div>
                  <h2>NXQ ecosystem access</h2>
                  <p className="subtle">Your NXQ ID can carry approved identity state into future NXQ products.</p>
                </div>
              </div>
              {data.product_memberships.length === 0 ? (
                <div className="empty-state">No NXQ product memberships found yet.</div>
              ) : (
                data.product_memberships.map((membership) => (
                  <div className="owner-message-card" key={membership.product_slug}>
                    <strong>{membership.product_name}</strong>
                    <span className="subtle">{pretty(membership.membership_status)} · {pretty(membership.product_role)}</span>
                  </div>
                ))
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}