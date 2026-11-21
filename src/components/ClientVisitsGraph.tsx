import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { DailyTrendChart } from "./DailyTrendChart";
import { lastDays, trendSeries, weekOverWeek, type Rollup } from "../lib/dashboardTrend";
import { visitsGraphCopy, visitsGraphMode, visitsGraphSentence, type VisitsAccess } from "../lib/visitsGraph";

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "upgrade" }
  | { kind: "waiting" }
  | { kind: "failed" }
  | { kind: "graph"; empty: boolean; points: { date: string; value: number }[]; weekChange: ReturnType<typeof weekOverWeek> };

// A 14-day visits graph under the portal hero. Real data only (the client's own project, row-level security), the same numbers and chart as the Business workspace; when there is
// nothing honest to draw it says why instead. A failure here never affects the rest of the portal.
export function ClientVisitsGraph() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    const set = (next: State) => { if (active) setState(next); };
    async function load() {
      if (!isSupabaseConfigured || !supabase) return set({ kind: "hidden" });
      try {
        const session = await supabase.auth.getSession();
        const user = session.data.session?.user;
        if (!user) return set({ kind: "hidden" });
        const accessResult = await supabase.rpc("current_client_feature_access", { target_feature_key: "advanced_analytics" });
        if (accessResult.error) return set({ kind: "hidden" });
        const mode = visitsGraphMode((accessResult.data || null) as VisitsAccess);
        if (mode !== "graph") return set({ kind: mode });
        const client = await supabase.from("clients").select("id").eq("auth_user_id", user.id).maybeSingle();
        if (client.error || !client.data) return set({ kind: "failed" });
        const project = await supabase.from("projects").select("id").eq("client_id", client.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (project.error || !project.data) return set({ kind: "failed" });
        const rollups = await supabase.from("website_analytics_daily_rollups").select("rollup_date,page_views,clicks").eq("project_id", project.data.id).order("rollup_date", { ascending: false }).limit(14);
        if (rollups.error) return set({ kind: "failed" });
        const rows = (rollups.data || []) as Rollup[];
        const points = trendSeries(rows, lastDays(14, Date.now()), "page_views");
        set({ kind: "graph", empty: rows.length === 0, points, weekChange: weekOverWeek(points) });
      } catch {
        set({ kind: "failed" });
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  if (state.kind === "loading" || state.kind === "hidden") return null;

  const sentence =
    state.kind === "graph" ? (state.empty ? visitsGraphCopy.empty : visitsGraphSentence(state.weekChange))
    : state.kind === "upgrade" ? visitsGraphCopy.upgrade
    : state.kind === "waiting" ? visitsGraphCopy.waiting
    : visitsGraphCopy.failed;

  return (
    <section aria-labelledby="visits-graph-title" className="panel panel-wide" data-testid="visits-graph" data-visits-state={state.kind}>
      <div className="panel-title panel-title-row">
        <div className="panel-title">
          <BarChart3 size={20} />
          <div>
            <h2 id="visits-graph-title">{visitsGraphCopy.title}</h2>
            <p className="subtle">{sentence}</p>
          </div>
        </div>
        {state.kind === "graph" ? <a className="icon-btn" href="/client/business/analytics">All analytics</a> : null}
        {state.kind === "upgrade" ? <a className="icon-btn" href="/client/settings">Plan options</a> : null}
      </div>
      {state.kind === "graph" && !state.empty ? <DailyTrendChart title="Page views per day, last 14 days" points={state.points} valueLabel="views" /> : null}
    </section>
  );
}
