import { useEffect, useState } from "react";
import { Activity, ArrowLeft, BarChart3, Building2, FileClock, MapPin, MessageSquarePlus, Search, Target } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Summary = { leads?: { new?: number; qualified?: number; won?: number; urgent?: number }; open_change_requests?: number; open_recommendations?: number };
type Health = { health?: string; production_url?: string | null; deployment_status?: string | null; open_alerts?: number; nxq_id?: string | null };
type Access = { allowed?: boolean; tier_key?: string; reason?: string; limits?: { max_locations?: number } };

export function ClientBusinessDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [access, setAccess] = useState<Record<string, Access>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) { setError("Your Business workspace is temporarily unavailable."); setLoading(false); }
        return;
      }
      const [summaryResult, healthResult, analyticsResult, seoResult, mouseResult, locationsResult] = await Promise.all([
        supabase.rpc("current_client_business_summary"),
        supabase.rpc("current_client_operational_health"),
        supabase.rpc("current_client_feature_access", { target_feature_key: "advanced_analytics" }),
        supabase.rpc("current_client_feature_access", { target_feature_key: "advanced_seo" }),
        supabase.rpc("current_client_feature_access", { target_feature_key: "mouse_tracking" }),
        supabase.rpc("current_client_feature_access", { target_feature_key: "multi_location" }),
      ]);
      if (!active) return;
      const problem = summaryResult.error || healthResult.error || analyticsResult.error || seoResult.error || mouseResult.error || locationsResult.error;
      if (problem) setError("Some Business workspace data could not be verified right now. Unavailable sections may show setup state until you refresh.");
      setSummary(summaryResult.error ? null : (summaryResult.data || {}) as Summary);
      setHealth(healthResult.error ? null : (healthResult.data || {}) as Health);
      setAccess({
        analytics: analyticsResult.error ? {} : (analyticsResult.data || {}) as Access,
        seo: seoResult.error ? {} : (seoResult.data || {}) as Access,
        mouse: mouseResult.error ? {} : (mouseResult.data || {}) as Access,
        locations: locationsResult.error ? {} : (locationsResult.data || {}) as Access,
      });
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const tier = access.analytics?.tier_key || access.seo?.tier_key || "starter";
  const cards = [
    ["New leads", summary?.leads?.new ?? "—", Target, "/client/business/leads"],
    ["Qualified", summary?.leads?.qualified ?? "—", BarChart3, "/client/business/leads"],
    ["Open changes", summary?.open_change_requests ?? "—", MessageSquarePlus, "/client/business/changes"],
    ["Open improvements", summary?.open_recommendations ?? "—", Activity, "/client/business/reports"],
  ] as const;

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><Building2 size={22}/><div><h1>Business workspace</h1><p className="subtle">Your website, leads, locations, changes, analytics, and reports in one clean workspace.</p></div></div><a className="icon-btn" href="/client"><ArrowLeft size={16}/> Portal</a></div>{error ? <div className="auth-error" role="alert">{error}</div> : null}{loading ? <div className="empty-state">Loading your Business workspace...</div> : null}{!loading ? <><div className="portal-grid">{cards.map(([label, value, Icon, href]) => <a className="panel" href={href} key={label} style={{ textDecoration: "none" }}><div className="panel-title"><Icon size={20}/><div><h2>{label}</h2><div className="status-summary">{value}</div></div></div></a>)}</div><div className="owner-detail-grid"><section className="panel panel-wide"><div className="panel-title panel-title-row"><div><h2>Website</h2><p className="subtle">Health: {(health?.health || "unavailable").replaceAll("_", " ")} · Deployment: {(health?.deployment_status || "unavailable").replaceAll("_", " ")} · Alerts: {typeof health?.open_alerts === "number" ? health.open_alerts : "—"}</p></div><span className="status-summary">{tier.replaceAll("_", " ")}</span></div>{health?.production_url ? <a className="wide-btn" href={health.production_url} target="_blank" rel="noreferrer">Open live website</a> : null}</section><section className="panel panel-wide"><h2>Workspace</h2><div className="portal-grid"><a className="wide-btn" href="/client/business/leads"><Target size={16}/> Leads</a><a className="wide-btn" href="/client/business/changes"><MessageSquarePlus size={16}/> Website changes</a><a className="wide-btn" href="/client/business/locations"><MapPin size={16}/> Locations {access.locations?.allowed ? "· Multi-location" : "· Plan upgrade for Multi-location"}</a><a className="wide-btn" href="/client/business/analytics"><BarChart3 size={16}/> Analytics {access.analytics?.allowed ? "· Active" : "· Plan upgrade"}</a><a className="wide-btn" href="/client/business/seo"><Search size={16}/> SEO {access.seo?.allowed ? "· Advanced" : "· Core · Plan upgrade for advanced SEO"}</a><a className="wide-btn" href="/client/business/reports"><FileClock size={16}/> Reports</a><a className="wide-btn" href="/client/health"><Activity size={16}/> Website health</a></div>{access.mouse?.allowed ? <p className="subtle">Consent-gated click, scroll, and coarse heatmap insights are enabled for this plan. Form text and keystrokes are never collected.</p> : <p className="subtle">Advanced behavior insights are plan-gated. When available, click, scroll, and coarse heatmap insights remain consent-gated; form text and keystrokes are never collected.</p>}</section></div>{health?.nxq_id ? <p className="subtle">NXQ ID: {health.nxq_id}</p> : null}</> : null}</section></main>;
}
