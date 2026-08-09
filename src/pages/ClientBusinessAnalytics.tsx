import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, MousePointer2, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Profile = { status:string;mouse_tracking_enabled:boolean;retention_days:number;consent_mode:string };
type Rollup = { rollup_date:string;page_views:number;clicks:number;max_scroll_depth:number|null;heatpoint_count:number };
type Access = { allowed?:boolean;tier_key?:string;reason?:string };

export function ClientBusinessAnalytics() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<Rollup[]>([]);
  const [analyticsAccess, setAnalyticsAccess] = useState<Access>({});
  const [mouseAccess, setMouseAccess] = useState<Access>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!isSupabaseConfigured || !supabase) { if (active) { setError("Supabase is not configured yet."); setLoading(false); } return; }
      const [analyticsResult, mouseResult] = await Promise.all([
        supabase.rpc("current_client_feature_access", { target_feature_key: "advanced_analytics" }),
        supabase.rpc("current_client_feature_access", { target_feature_key: "mouse_tracking" }),
      ]);
      if (!active) return;
      if (analyticsResult.error || mouseResult.error) { setError(analyticsResult.error?.message || mouseResult.error?.message || "Plan access could not be verified."); setLoading(false); return; }
      const nextAnalyticsAccess = (analyticsResult.data || {}) as Access;
      setAnalyticsAccess(nextAnalyticsAccess);
      setMouseAccess((mouseResult.data || {}) as Access);
      if (!nextAnalyticsAccess.allowed) { setLoading(false); return; }
      const session = await supabase.auth.getSession();
      const user = session.data.session?.user;
      if (!user) { setError("Sign in again to view analytics."); setLoading(false); return; }
      const client = await supabase.from("clients").select("id").eq("auth_user_id", user.id).maybeSingle();
      if (client.error || !client.data) { setError(client.error?.message || "Client not found."); setLoading(false); return; }
      const project = await supabase.from("projects").select("id").eq("client_id", client.data.id).order("created_at", { ascending:false }).limit(1).maybeSingle();
      if (project.error || !project.data) { setError(project.error?.message || "Project not found."); setLoading(false); return; }
      const [profileResult, rollupResult] = await Promise.all([
        supabase.from("website_analytics_profiles").select("status,mouse_tracking_enabled,retention_days,consent_mode").eq("project_id", project.data.id).maybeSingle(),
        supabase.from("website_analytics_daily_rollups").select("rollup_date,page_views,clicks,max_scroll_depth,heatpoint_count").eq("project_id", project.data.id).order("rollup_date", { ascending:false }).limit(90),
      ]);
      if (!active) return;
      if (profileResult.error || rollupResult.error) setError(profileResult.error?.message || rollupResult.error?.message || "Analytics could not load.");
      else { setProfile((profileResult.data || null) as Profile | null); setRows((rollupResult.data || []) as Rollup[]); }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const totals = useMemo(() => rows.reduce((total, row) => ({ views:total.views+row.page_views,clicks:total.clicks+row.clicks,heat:total.heat+row.heatpoint_count,maxScroll:Math.max(total.maxScroll,row.max_scroll_depth||0) }), { views:0,clicks:0,heat:0,maxScroll:0 }), [rows]);

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><BarChart3 size={22}/><div><h1>Analytics</h1><p className="subtle">Privacy-safe engagement summaries. Raw form text, passwords, and keystrokes are never collected.</p></div></div><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a></div>{error ? <div className="auth-error">{error}</div> : null}{loading ? <div className="empty-state">Checking analytics access...</div> : null}{!loading && !analyticsAccess.allowed ? <section className="panel panel-wide"><div className="panel-title"><ShieldCheck size={20}/><div><h2>Advanced analytics is not included in {analyticsAccess.tier_key || "this"} plan</h2><p className="subtle">Growth adds privacy-safe page, click, and scroll summaries. Intelligence adds consent-gated coarse heatmap insights. Your managed website and core SEO remain active.</p></div></div><a className="wide-btn" href="/client">Review plan options</a></section> : null}{!loading && analyticsAccess.allowed ? <><div className="portal-grid"><section className="panel"><h2>Page views</h2><div className="status-summary">{totals.views}</div></section><section className="panel"><h2>Clicks</h2><div className="status-summary">{totals.clicks}</div></section><section className="panel"><h2>Max scroll</h2><div className="status-summary">{totals.maxScroll}%</div></section><section className="panel"><h2>Heatpoints</h2><div className="status-summary"><MousePointer2 size={16}/> {mouseAccess.allowed ? totals.heat : "Plan locked"}</div></section></div><section className="panel panel-wide"><h2>Analytics profile</h2><p className="subtle">Status: {profile?.status || "not configured"} · Consent: {profile?.consent_mode || "required"} · Raw retention: {profile?.retention_days || 0} days · Mouse heatmaps: {profile?.mouse_tracking_enabled && mouseAccess.allowed ? "enabled with consent" : "not enabled for this plan"}</p></section><section className="panel panel-wide"><h2>Recent days</h2>{rows.length === 0 ? <div className="empty-state">No verified rollups yet. Analytics stays honest and empty until protected ingest is connected and real visits arrive.</div> : rows.slice(0,30).map((row) => <div className="owner-message-card" key={row.rollup_date}><strong>{new Date(`${row.rollup_date}T00:00:00`).toLocaleDateString()}</strong><span className="subtle">Views {row.page_views} · Clicks {row.clicks} · Max scroll {row.max_scroll_depth || 0}%{mouseAccess.allowed ? ` · Heatpoints ${row.heatpoint_count}` : ""}</span></div>)}</section></> : null}</section></main>;
}
