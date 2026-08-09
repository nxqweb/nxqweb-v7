import { useEffect, useMemo, useState } from "react";
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

const statuses = ["new", "contacted", "qualified", "won", "lost", "spam", "archived"];

export function ClientBusinessLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      setLoading(false);
      return;
    }
    const result = await supabase
      .from("client_leads")
      .select("id,lead_code,status,urgency,service_key,contact_name,contact_email,contact_phone,message,lead_score,created_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (result.error) setError(result.error.message);
    else setLeads((result.data || []) as Lead[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(
    () => filter === "all"
      ? leads
      : filter === "open"
        ? leads.filter((lead) => !["won", "lost", "spam", "archived"].includes(lead.status))
        : leads.filter((lead) => lead.status === filter),
    [leads, filter]
  );

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
    await load();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title"><Target size={22}/><div><h1>Leads</h1><p className="subtle">Website inquiries, urgency, qualification, and conversion status.</p></div></div>
          <div className="client-control-row"><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a><button className="icon-btn" onClick={() => void load()} type="button"><RefreshCcw size={16}/> Refresh</button></div>
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
        {notice ? <div className="auth-success">{notice}</div> : null}
        <div className="panel panel-wide"><label>View <select className="auth-input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Open leads</option><option value="all">All leads</option>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div>
        {loading ? <div className="empty-state">Loading your leads...</div> : null}
        {!loading ? <div style={{ display: "grid", gap: "1rem" }}>{visible.length === 0 ? <div className="empty-state">No leads in this view yet.</div> : visible.map((lead) => <article className="panel" key={lead.id}><div className="panel-title panel-title-row"><div><strong>{lead.contact_name || "Website visitor"}</strong><p className="subtle">{lead.lead_code} · {new Date(lead.created_at).toLocaleString()} · Score {lead.lead_score}</p></div>{["urgent", "emergency"].includes(lead.urgency) ? <span className="status-summary"><CircleAlert size={15}/> {lead.urgency}</span> : null}</div>{lead.service_key ? <p><strong>Service:</strong> {lead.service_key}</p> : null}{lead.message ? <p>{lead.message}</p> : null}<p className="subtle">{lead.contact_email || ""}{lead.contact_email && lead.contact_phone ? " · " : ""}{lead.contact_phone || ""}</p><div className="client-control-row">{lead.contact_phone ? <a className="icon-btn" href={`tel:${lead.contact_phone}`}><Phone size={15}/> Call</a> : null}<select aria-label={`Status for ${lead.lead_code}`} className="auth-input" disabled={busyId === lead.id || lead.status === "archived"} value={lead.status} onChange={(event) => void setStatus(lead, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></div>{busyId === lead.id ? <p className="subtle">Saving securely...</p> : null}</article>)}</div> : null}
      </section>
    </main>
  );
}
