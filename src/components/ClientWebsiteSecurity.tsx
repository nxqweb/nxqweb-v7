import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type SecurityProfile = {
  monitoring_status: string;
  website_health: string;
  ssl_status: string;
  monitored_url: string | null;
  threats_blocked_total: number;
  last_scan_at: string | null;
};

type HealthCheck = {
  status: string;
  check_type: string;
  response_time_ms: number | null;
  http_status: number | null;
  checked_at: string;
};

type SecurityOverview = {
  profile: SecurityProfile | null;
  latest_check: HealthCheck | null;
  active_incidents: number;
};

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ClientWebsiteSecurity() {
  const [profile, setProfile] = useState<SecurityProfile | null>(null);
  const [latestCheck, setLatestCheck] = useState<HealthCheck | null>(null);
  const [activeIncidents, setActiveIncidents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void loadSecurityOverview();
  }, []);

  async function loadSecurityOverview() {
    setLoading(true);
    setLoadError("");

    if (!isSupabaseConfigured || !supabase) {
      setLoadError("Security monitoring data is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    try {
      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data.session;

      if (!session) {
        setLoading(false);
        return;
      }

      const overviewResult = await supabase.rpc("get_client_security_overview");

      if (overviewResult.error) {
        throw new Error(overviewResult.error.message);
      }

      const overview = (overviewResult.data || {
        profile: null,
        latest_check: null,
        active_incidents: 0,
      }) as SecurityOverview;

      setProfile(overview.profile);
      setLatestCheck(overview.latest_check);
      setActiveIncidents(Number(overview.active_incidents || 0));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown security overview error";
      setLoadError(`Security overview could not be loaded: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  const overallState = useMemo(() => {
    if (!profile) return "Setup pending";
    if (activeIncidents > 0) return "Attention needed";
    if (profile.website_health === "healthy" && profile.ssl_status === "active") return "Protected";
    return formatStatus(profile.monitoring_status);
  }, [activeIncidents, profile]);

  const statusIcon = activeIncidents > 0 ? (
    <AlertTriangle size={20} />
  ) : profile?.monitoring_status === "active" ? (
    <ShieldCheck size={20} />
  ) : (
    <CheckCircle2 size={20} />
  );

  return (
    <section className="panel panel-wide">
      <div className="panel-title">
        {statusIcon}
        <div>
          <h2>Website security</h2>
          <p className="subtle">
            Real monitoring, website health, SSL, and incident information for this project.
          </p>
        </div>
      </div>

      {loadError ? <div className="notice-card error">{loadError}</div> : null}

      <div className="settings-grid">
        <article className="settings-card">
          <span>Security status</span>
          <strong>{loading ? "Loading..." : overallState}</strong>
          <p>
            {profile?.monitored_url
              ? `Monitoring ${profile.monitored_url}.`
              : "Monitoring has not been connected to a live website yet."}
          </p>
        </article>

        <article className="settings-card">
          <span>Website health</span>
          <strong>{loading ? "Loading..." : formatStatus(profile?.website_health || "not_connected")}</strong>
          <p>
            {latestCheck
              ? `Latest ${formatStatus(latestCheck.check_type)} check: ${formatStatus(latestCheck.status)}${
                  latestCheck.response_time_ms !== null ? ` in ${latestCheck.response_time_ms} ms` : ""
                }.`
              : "No website health check has been recorded yet."}
          </p>
        </article>

        <article className="settings-card">
          <span>Threats blocked</span>
          <strong>{profile ? profile.threats_blocked_total.toLocaleString("en-US") : "Not connected"}</strong>
          <p>Only verified blocked events from connected security logs are counted.</p>
        </article>

        <article className="settings-card">
          <span>SSL status</span>
          <strong>{formatStatus(profile?.ssl_status || "not_checked")}</strong>
          <p>
            {latestCheck?.check_type === "ssl" && latestCheck.http_status
              ? `Latest certificate endpoint returned HTTP ${latestCheck.http_status}.`
              : "Certificate checks begin after the monitored website is connected."}
          </p>
        </article>

        <article className="settings-card">
          <span>Active incidents</span>
          <strong>{loading ? "Loading..." : activeIncidents.toLocaleString("en-US")}</strong>
          <p>{activeIncidents > 0 ? "NXQ review or repair is required." : "No active incidents are recorded."}</p>
        </article>

        <article className="settings-card">
          <span>Last security scan</span>
          <strong>{loading ? "Loading..." : formatDate(profile?.last_scan_at || null)}</strong>
          <p>
            {activeIncidents > 0
              ? "NXQ is reviewing the active incident details."
              : "No client-facing scan issue is currently recorded."}
          </p>
        </article>
      </div>
    </section>
  );
}
