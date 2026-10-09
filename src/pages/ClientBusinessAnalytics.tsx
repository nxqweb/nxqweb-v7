import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, MousePointer2, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { DailyTrendChart } from "../components/DailyTrendChart";
import { lastDays } from "../lib/dashboardTrend";
import { aggregateTopPages } from "../lib/topPages";
import "../styles/top-pages.css";

type Profile = { status:string;mouse_tracking_enabled:boolean;retention_days:number;consent_mode:string };
type Rollup = { rollup_date:string;page_views:number;clicks:number;max_scroll_depth:number|null;heatpoint_count:number;summary?:unknown };
type Access = { allowed?:boolean;tier_key?:string;reason?:string };

const ROLLUP_COLUMNS = "rollup_date,page_views,clicks,max_scroll_depth,heatpoint_count,summary";
const REFRESH_MS = 5 * 60 * 1000;

function updatedLabel(fetchedAt: number | null, now: number) {
  if (fetchedAt === null) return "";
  const minutes = Math.floor((now - fetchedAt) / 60000);
  return minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`;
}

export function ClientBusinessAnalytics() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<Rollup[]>([]);
  const [analyticsAccess, setAnalyticsAccess] = useState<Access>({});
  const [mouseAccess, setMouseAccess] = useState<Access>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [range, setRange] = useState<30 | 90>(30);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) { setError("Analytics is temporarily unavailable."); setLoading(false); }
        return;
      }

      const [analyticsResult, mouseResult] = await Promise.all([
        supabase.rpc("current_client_feature_access", { target_feature_key: "advanced_analytics" }),
        supabase.rpc("current_client_feature_access", { target_feature_key: "mouse_tracking" }),
      ]);
      if (!active) return;
      if (analyticsResult.error || mouseResult.error) {
        setError("Analytics access could not be verified right now. No analytics values are being inferred.");
        setLoading(false);
        return;
      }

      const nextAnalyticsAccess = (analyticsResult.data || {}) as Access;
      setAnalyticsAccess(nextAnalyticsAccess);
      setMouseAccess((mouseResult.data || {}) as Access);
      if (!nextAnalyticsAccess.allowed) { setVerified(true); setLoading(false); return; }

      const session = await supabase.auth.getSession();
      const user = session.data.session?.user;
      if (!user) { window.location.replace("/portal/login"); return; }

      const client = await supabase.from("clients").select("id").eq("auth_user_id", user.id).maybeSingle();
      if (client.error || !client.data) {
        setError("Analytics could not be loaded right now. Your account data was not changed.");
        setLoading(false);
        return;
      }

      const project = await supabase.from("projects").select("id").eq("client_id", client.data.id).order("created_at", { ascending:false }).limit(1).maybeSingle();
      if (project.error || !project.data) {
        setError("Analytics is not ready for this website yet.");
        setLoading(false);
        return;
      }

      const [profileResult, rollupResult] = await Promise.all([
        supabase.from("website_analytics_profiles").select("status,mouse_tracking_enabled,retention_days,consent_mode").eq("project_id", project.data.id).maybeSingle(),
        supabase.from("website_analytics_daily_rollups").select(ROLLUP_COLUMNS).eq("project_id", project.data.id).order("rollup_date", { ascending:false }).limit(90),
      ]);
      if (!active) return;

      if (profileResult.error || rollupResult.error) {
        setError("Analytics data could not be verified right now. Unverified values are not shown.");
      } else {
        setProfile((profileResult.data || null) as Profile | null);
        setRows((rollupResult.data || []) as Rollup[]);
        setProjectId(project.data.id as string);
        setFetchedAt(Date.now());
        setVerified(true);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const refreshRollups = useCallback(async () => {
    if (!supabase || !projectId) return;
    const result = await supabase.from("website_analytics_daily_rollups").select(ROLLUP_COLUMNS).eq("project_id", projectId).order("rollup_date", { ascending:false }).limit(90);
    if (result.error) { setRefreshFailed(true); return; }
    setRefreshFailed(false);
    setRows((result.data || []) as Rollup[]);
    setFetchedAt(Date.now());
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return undefined;
    const refresh = window.setInterval(() => { void refreshRollups(); }, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearInterval(refresh); window.clearInterval(clock); };
  }, [projectId, refreshRollups]);

  const hourKey = Math.floor(now / 3600000);
  const days = useMemo(() => lastDays(range, hourKey * 3600000), [range, hourKey]);
  const series = useMemo(() => {
    const byDay = new Map(rows.map((row) => [row.rollup_date, row]));
    return days.map((day) => ({ day, row: byDay.get(day) }));
  }, [rows, days]);
  const viewPoints = useMemo(() => series.map(({ day, row }) => ({ date: day, value: row?.page_views ?? 0 })), [series]);
  const clickPoints = useMemo(() => series.map(({ day, row }) => ({ date: day, value: row?.clicks ?? 0 })), [series]);
  const topPages = useMemo(() => aggregateTopPages(rows, days), [rows, days]);
  const hasData = rows.length > 0;
  const totals = useMemo(() => series.reduce((total, { row }) => row ? ({ views:total.views+row.page_views,clicks:total.clicks+row.clicks,heat:total.heat+row.heatpoint_count,maxScroll:Math.max(total.maxScroll,row.max_scroll_depth||0) }) : total, { views:0,clicks:0,heat:0,maxScroll:0 }), [series]);

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><BarChart3 size={22}/><div><h1>Analytics</h1><p className="subtle">Privacy-safe engagement summaries. Raw form text, passwords, and keystrokes are never collected.</p></div></div><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a></div>{error ? <div className="auth-error" role="alert">{error}</div> : null}{loading ? <div className="empty-state">Checking analytics access...</div> : null}{!loading && verified && !analyticsAccess.allowed ? <section className="panel panel-wide"><div className="panel-title"><ShieldCheck size={20}/><div><h2>Advanced analytics is not included in {analyticsAccess.tier_key || "this"} plan</h2><p className="subtle">Growth adds privacy-safe page, click, and scroll summaries. Intelligence adds consent-gated coarse heatmap insights. Your managed website and core SEO remain active.</p></div></div><a className="wide-btn" href="/client">Review plan options</a></section> : null}{!loading && verified && analyticsAccess.allowed ? <><div className="nxq-range" role="group" aria-label="Date range">{([30, 90] as const).map((value) => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>Last {value} days</button>)}<span className="nxq-updated" role="status">{refreshFailed ? "Could not refresh. Showing earlier data. " : ""}{updatedLabel(fetchedAt, now)}</span></div><div className="portal-grid"><section className="panel"><h2>Page views</h2><div className="status-summary">{totals.views}</div></section><section className="panel"><h2>Clicks</h2><div className="status-summary">{totals.clicks}</div></section><section className="panel"><h2>Max scroll</h2><div className="status-summary">{totals.maxScroll}%</div></section><section className="panel"><h2>Heatpoints</h2><div className="status-summary"><MousePointer2 size={16}/> {mouseAccess.allowed ? totals.heat : "Plan locked"}</div></section></div><section className="panel panel-wide"><h2>Daily trend</h2>{hasData ? <><DailyTrendChart title="Page views per day" points={viewPoints} valueLabel="views" /><DailyTrendChart title="Clicks per day" points={clickPoints} valueLabel="clicks" /><p className="subtle">Days with no stored summary are drawn as 0. Figures follow your site's consent setting and refresh about every 5 minutes while this page is open.</p></> : <div className="empty-state">No charts yet. They appear once real visits are recorded through protected analytics ingest.</div>}</section><section className="panel panel-wide"><h2>Top pages</h2>{topPages.length === 0 ? <div className="empty-state">No page-level data yet. Pages appear here once they have at least 3 views in a day.</div> : <><div className="nxq-table-scroll" role="region" aria-label="Top pages" tabIndex={0}><table className="nxq-table"><thead><tr><th scope="col">Page</th><th scope="col">Views</th><th scope="col">Clicks</th><th scope="col">Deepest scroll</th></tr></thead><tbody>{topPages.map((page) => <tr key={page.path}><th scope="row">{page.path}</th><td>{page.views}</td><td>{page.clicks}</td><td>{page.maxScroll === null ? "—" : `${page.maxScroll}%`}</td></tr>)}</tbody></table></div><p className="subtle">Top 10 pages for the selected range. Pages with fewer than 3 views in a day are left out so no single visitor can be identified, so these numbers can be lower than your site total. A page that most visitors leave before scrolling far may need a clearer top section. Scroll depth is only shown when scroll tracking recorded it.</p></>}</section><section className="panel panel-wide"><h2>Analytics profile</h2><p className="subtle">Status: {profile?.status || "not configured"} · Consent: {profile?.consent_mode || "required"} · Raw retention: {profile ? `${profile.retention_days} days` : "—"} · Mouse heatmaps: {profile?.mouse_tracking_enabled && mouseAccess.allowed ? "enabled with consent" : "not enabled"}</p></section><section className="panel panel-wide"><h2>Recent days (table view)</h2>{rows.length === 0 ? <div className="empty-state">No verified rollups yet. Analytics stays empty until protected ingest is connected and real visits arrive.</div> : rows.slice(0,30).map((row) => <div className="owner-message-card" key={row.rollup_date}><strong>{new Date(`${row.rollup_date}T00:00:00`).toLocaleDateString()}</strong><span className="subtle">Views {row.page_views} · Clicks {row.clicks} · Max scroll {row.max_scroll_depth ?? "—"}%{mouseAccess.allowed ? ` · Heatpoints ${row.heatpoint_count}` : ""}</span></div>)}</section></> : null}</section></main>;
}
