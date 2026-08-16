import { useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, Phone, RefreshCcw, Target } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Lead = {
  id: string;
  lead_code: string;
  status: string;
  urgency: string;
  service_key: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  message: string | null;
  lead_score: number;
  created_at: string;
};

type LeadPage = { rows?: Lead[]; has_more?: boolean; next_offset?: number };

const statuses = ["new", "contacted", "qualified", "won", "lost", "spam", "archived"];
const PAGE_SIZE = 50;

export function ClientBusinessLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [busyId, setBusyId] = useState("");

  async function load(view = filter, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    const offset = append ? nextOffset : 0;
    const result = await supabase.rpc("current_client_leads_page", {
      target_view: view,
      page_limit: PAGE_SIZE,
      page_offset: offset,
    });

    if (result.error) setError(result.error.message);
    else {
      const page = (result.data || {}) as LeadPage;
      const rows = page.rows || [];
      setLeads((current) => append ? [...current, ...rows] : rows);
      setHasMore(Boolean(page.has_more));
      setNextOffset(Number(page.next_offset || offset + rows.length));
    }
    setLoading(false);
    setLoadingMore(false);
  }

  useEffect(() => { void load(filter, false); }, [filter]);

  async function setStatus(lead: Lead, status: string) {
    if (!supabase || status === lead.status) return;
    setBusyId(lead.id);
    setError("");
    setNotice("");
    const result = await supabase.rpc("current_client_update_lead_status", {
      target_lead_id: lead.id,
      target_status: status,
    });
    setBusyId("");
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNotice(`${lead.lead_code} moved to ${status.replaceAll("_", " ")}.`);
    await load(filter, false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title"><Target size={22}/><div><h1>Leads</h1><p className="subtle">Website inquiries, urgency, qualification, and conversion status.</p></div></div>
          <div className="client-control-row"><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a><button className="icon-btn" onClick={() => void load(filter, false)} type="button"><RefreshCcw size={16}/> Refresh</button></div>
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
        {notice ? <div className="auth-success">{notice}</div> : null}
        <div className="panel panel-wide"><label>View <select className="auth-input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Open leads</option><option value="all">All leads</option>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div>
        {loading ? <div className="empty-state">Loading your leads...</div> : null}
        {!loading ? <div style={{ display: "grid", gap: "1rem" }}>{leads.length === 0 ? <div className="empty-state">No leads in this view yet.</div> : leads.map((lead) => <article className="panel" key={lead.id}><div className="panel-title panel-title-row"><div><strong>{lead.contact_name || "Website visitor"}</strong><p className="subtle">{lead.lead_code} · {new Date(lead.created_at).toLocaleString()} · Score {lead.lead_score}</p></div>{["urgent", "emergency"].includes(lead.urgency) ? <span className="status-summary"><CircleAlert size={15}/> {lead.urgency}</span> : null}</div>{lead.service_key ? <p><strong>Service:</strong> {lead.service_key}</p> : null}{lead.message ? <p>{lead.message}</p> : null}<p className="subtle">{lead.contact_email || ""}{lead.contact_email && lead.contact_phone ? " · " : ""}{lead.contact_phone || ""}</p><div className="client-control-row">{lead.contact_phone ? <a className="icon-btn" href={`tel:${lead.contact_phone}`}><Phone size={15}/> Call</a> : null}<select aria-label={`Status for ${lead.lead_code}`} className="auth-input" disabled={busyId === lead.id || lead.status === "archived"} value={lead.status} onChange={(event) => void setStatus(lead, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></div>{busyId === lead.id ? <p className="subtle">Saving securely...</p> : null}</article>)}{hasMore ? <button className="wide-btn" disabled={loadingMore} onClick={() => void load(filter, true)} type="button">{loadingMore ? "Loading…" : "Load more leads"}</button> : null}</div> : null}
      </section>
    </main>
  );
}
