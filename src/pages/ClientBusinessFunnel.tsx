import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Filter, RefreshCcw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { DailyTrendChart } from "../components/DailyTrendChart";
import { buildFunnel, percent } from "../lib/leadFunnel";
import type { FunnelLead } from "../lib/leadFunnel";
import { parseLeadSources } from "../lib/leadSources";
import type { SourceRow, SourcesSummary } from "../lib/leadSources";

type LeadPage = { rows?: FunnelLead[]; has_more?: boolean; next_offset?: number };

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function updatedLabel(fetchedAt: number | null, now: number) {
  if (fetchedAt === null) return "";
  const minutes = Math.floor((now - fetchedAt) / 60000);
  return minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`;
}

export function ClientBusinessFunnel() {
  const [leads, setLeads] = useState<FunnelLead[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [sources, setSources] = useState<SourcesSummary | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Lead data is temporarily unavailable. No figures are shown.");
      setVerified(false);
      setLoading(false);
      return;
    }
    const session = await supabase.auth.getSession();
    if (!session.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    // Read the client's own leads through the same tenant-safe RPC the Leads page uses, newest first.
    const collected: FunnelLead[] = [];
    let offset = 0;
    let more = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await supabase.rpc("current_client_leads_page", { target_view: "all", page_limit: PAGE_SIZE, page_offset: offset });
      if (result.error) {
        // A partial read would produce wrong percentages, so show nothing instead.
        setError("Lead data could not be verified right now. No figures are shown.");
        setVerified(false);
        setLoading(false);
        return;
      }
      const data = (result.data || {}) as LeadPage;
      collected.push(...(data.rows || []));
      more = Boolean(data.has_more);
      if (!more) break;
      offset = Number(data.next_offset ?? offset + (data.rows || []).length);
    }

    // Source / campaign counts come from a separate aggregate function; if it fails the funnel above still shows.
    const sourcesResult = await supabase.rpc("current_client_lead_sources", { target_days: 90 });
    setSources(sourcesResult.error ? null : parseLeadSources(sourcesResult.data));

    setLeads(collected);
    setTruncated(more);
    setVerified(true);
    setFetchedAt(Date.now());
    setNow(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(clock);
  }, []);

  const hourKey = Math.floor(now / 3600000);
  const summary = useMemo(() => buildFunnel(leads, hourKey * 3600000), [leads, hourKey]);
  const received = summary.stages[0].count;
  const hasLeads = received > 0;
  const steps = [
    { label: "Contacted", value: summary.conversion.contacted, note: "of received" },
    { label: "Qualified", value: summary.conversion.qualified, note: "of contacted" },
    { label: "Won", value: summary.conversion.won, note: "of qualified" },
  ];

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Filter size={22} />
            <div>
              <h1>Lead funnel</h1>
              <p className="subtle">How enquiries from your website move from first contact to a won job.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/business"><ArrowLeft size={16} /> Business</a>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state" role="status">Loading your leads...</div> : null}

        {!loading && verified ? (
          <>
            <div className="nxq-range" role="group" aria-label="Refresh">
              <button type="button" onClick={() => void load()}><RefreshCcw size={14} /> Refresh</button>
              <span className="nxq-updated" role="status">{updatedLabel(fetchedAt, now)}</span>
            </div>

            {!hasLeads ? (
              <section className="panel panel-wide">
                <div className="empty-state">No leads yet. This fills in when your website form receives its first enquiry.</div>
              </section>
            ) : (
              <>
                <section className="panel panel-wide">
                  <h2>Where your leads get to</h2>
                  <div className="nxq-funnel" role="list">
                    {summary.stages.map((stage) => (
                      <div className="nxq-funnel-row" role="listitem" key={stage.key}>
                        <span className="nxq-funnel-label">{stage.label}</span>
                        <span className="nxq-funnel-track">
                          {stage.count > 0 ? <span className="nxq-funnel-bar" style={{ width: `${Math.max(2, (stage.count / received) * 100)}%` }} /> : null}
                        </span>
                        <strong className="nxq-funnel-value">{stage.count.toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="portal-grid">
                    {steps.map((step) => (
                      <section className="panel" key={step.label}>
                        <h2>{step.label}</h2>
                        <div className="status-summary">{percent(step.value)}</div>
                        <p className="subtle">{step.note}</p>
                      </section>
                    ))}
                    <section className="panel">
                      <h2>Overall</h2>
                      <div className="status-summary">{percent(summary.conversion.overall)}</div>
                      <p className="subtle">of received leads won</p>
                    </section>
                  </div>
                  <p className="subtle">
                    Counted from each lead's current status, so a Won lead also counts as Contacted and Qualified. Lost and archived leads count only as Received.
                    {summary.spam > 0 ? ` ${summary.spam} spam ${summary.spam === 1 ? "lead is" : "leads are"} left out.` : ""}
                    {summary.urgent > 0 ? ` ${summary.urgent} marked urgent.` : ""}
                  </p>
                  {truncated ? <p className="subtle">Based on your most recent {(MAX_PAGES * PAGE_SIZE).toLocaleString()} leads.</p> : null}
                </section>

                <section className="panel panel-wide">
                  <h2>New leads per week</h2>
                  <DailyTrendChart title="Leads per week" points={summary.weekly} valueLabel="leads" />
                  <p className="subtle">The last 8 weeks, starting each Monday. Spam is left out.</p>
                </section>

                <section className="panel panel-wide">
                  <h2>Leads by service</h2>
                  {summary.services.map((row) => (
                    <div className="owner-message-card" key={row.service}>
                      <strong>{row.service.replaceAll("_", " ")}</strong>
                      <span className="subtle">{row.total} {row.total === 1 ? "lead" : "leads"} · {row.won} won</span>
                    </div>
                  ))}
                </section>
              </>
            )}

            <section className="panel panel-wide">
              <h2>Where your leads come from</h2>
              {sources === null ? (
                <p className="subtle">Lead source details could not be loaded right now. The funnel above is not affected.</p>
              ) : sources.total === 0 ? (
                <p className="subtle">No leads in the last {sources.days} days to break down yet.</p>
              ) : (
                <>
                  <p className="subtle">
                    {sources.tagged.toLocaleString()} of {sources.total.toLocaleString()} leads in the last {sources.days} days came with campaign tags.
                    Leads without tags show as "Not tagged".
                  </p>
                  {sources.tagged === 0 ? (
                    <p className="subtle">
                      None of your recent leads carried tags yet. Add tags to links that point to your website, for example
                      ?utm_source=google&amp;utm_campaign=spring, and they will appear here.
                    </p>
                  ) : null}
                  {([["By source", sources.sources], ["By medium", sources.mediums], ["By campaign", sources.campaigns]] as [string, SourceRow[]][]).map(([title, rows]) =>
                    rows.length === 0 ? null : (
                      <div key={title}>
                        <h3>{title}</h3>
                        {rows.map((row) => (
                          <div className="owner-message-card" key={`${title}-${row.label}`}>
                            <strong>{row.label}</strong>
                            <span className="subtle">{row.leads} {row.leads === 1 ? "lead" : "leads"} · {row.won} won</span>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
