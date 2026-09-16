import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, MessageSquarePlus } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type RequestRow = {
  id: string;
  request_code: string;
  request_type: string;
  title: string;
  priority: string;
  risk_level: string;
  status: string;
  preview_url: string | null;
  published_url: string | null;
  last_error: string | null;
  created_at: string;
};

export function ClientBusinessChanges() {
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [type, setType] = useState("content");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [service, setService] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyVerified, setHistoryVerified] = useState(false);

  async function load() {
    setLoading(true);
    setHistoryVerified(false);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Website changes are temporarily unavailable. No request was changed.");
      setLoading(false);
      return;
    }

    const session = await supabase.auth.getSession();
    const user = session.data.session?.user;
    if (!user) {
      window.location.replace("/portal/login");
      return;
    }

    const client = await supabase.from("clients").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (client.error || !client.data) {
      setError("Your client workspace could not be verified right now. No request was changed.");
      setLoading(false);
      return;
    }

    const project = await supabase
      .from("projects")
      .select("id")
      .eq("client_id", client.data.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (project.error || !project.data) {
      setError("Your website project is not available yet. No request was changed.");
      setLoading(false);
      return;
    }

    setProjectId(project.data.id);

    const req = await supabase
      .from("website_change_requests")
      .select("id,request_code,request_type,title,priority,risk_level,status,preview_url,published_url,last_error,created_at")
      .eq("project_id", project.data.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (req.error) {
      setError("Change-request history could not be verified right now. No request was changed.");
      setLoading(false);
      return;
    }

    setRows((req.data || []) as RequestRow[]);
    setHistoryVerified(true);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit() {
    if (!supabase || !projectId || sending) return;

    setSending(true);
    setError("");
    setMessage("");

    const patch: Record<string, unknown> = {};
    if (phone.trim()) patch.contact_phone = phone.trim();
    if (email.trim()) patch.contact_email = email.trim();
    if (service.trim()) patch.add_services = service.split(",").map((value) => value.trim()).filter(Boolean);

    const result = await supabase.rpc("submit_current_client_change_request", {
      target_project_id: projectId,
      target_request_type: type,
      target_title: title,
      target_description: description,
      target_priority: priority,
      target_payload: { patch },
    });

    setSending(false);

    if (result.error) {
      setError("Your change request could not be submitted. Nothing was queued or published; please try again.");
      return;
    }

    setMessage("Change request submitted. NXQ will route it through the protected review, build, and preview path before any publish action.");
    setTitle("");
    setDescription("");
    setPhone("");
    setEmail("");
    setService("");
    await load();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <MessageSquarePlus size={22} />
            <div>
              <h1>Website changes</h1>
              <p className="subtle">Request updates without emailing back and forth. NXQ routes changes through a protected build, review, and preview path.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/business"><ArrowLeft size={16} /> Business</a>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {message ? <div className="auth-success"><CheckCircle2 size={16} /> {message}</div> : null}

        <section className="panel panel-wide">
          <h2>New request</h2>
          <div className="notice-card">Submitting a request does not publish changes directly. Existing approval, preview, risk, and production gates still apply.</div>
          <div className="setup-form-grid">
            <label><span>Type</span><select className="auth-input" disabled={sending || loading} value={type} onChange={(event) => setType(event.target.value)}>{["content", "image", "service", "pricing", "new_page", "domain", "seo", "design", "location", "other"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
            <label><span>Priority</span><select className="auth-input" disabled={sending || loading} value={priority} onChange={(event) => setPriority(event.target.value)}>{["low", "normal", "high", "urgent"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Title</span><input className="auth-input" disabled={sending || loading} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>Description</span><textarea className="auth-input" disabled={sending || loading} value={description} maxLength={6000} rows={5} onChange={(event) => setDescription(event.target.value)} /></label>
            <label><span>New phone (optional structured change)</span><input className="auth-input" disabled={sending || loading} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label><span>New email (optional structured change)</span><input className="auth-input" disabled={sending || loading} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Add services (comma separated)</span><input className="auth-input" disabled={sending || loading} value={service} onChange={(event) => setService(event.target.value)} /></label>
          </div>
          <button className="wide-btn" disabled={sending || loading || !projectId || title.trim().length < 3 || description.trim().length < 5} onClick={() => void submit()} type="button">{sending ? "Submitting…" : "Submit change request"}</button>
        </section>

        <section className="panel panel-wide">
          <h2>Request history</h2>
          {loading ? <div className="empty-state">Loading change requests...</div> : null}
          {!loading && historyVerified && rows.length === 0 ? <div className="empty-state">No change requests yet.</div> : null}
          {!loading && historyVerified && rows.length > 0 ? <div style={{ display: "grid", gap: ".8rem" }}>{rows.map((row) => <article className="owner-message-card" key={row.id}><div className="panel-title panel-title-row"><div><strong>{row.title}</strong><p className="subtle">{row.request_code} · {row.request_type} · {row.risk_level} risk · {new Date(row.created_at).toLocaleString()}</p></div><span className="status-summary">{row.status.replaceAll("_", " ")}</span></div>{row.last_error ? <p className="auth-error">This request needs attention before it can continue. Internal error details are hidden for security.</p> : null}{row.preview_url ? <a className="icon-btn" href={row.preview_url} target="_blank" rel="noreferrer">Preview</a> : null}{row.published_url ? <a className="icon-btn" href={row.published_url} target="_blank" rel="noreferrer">Published site</a> : null}</article>)}</div> : null}
        </section>
      </section>
    </main>
  );
}
