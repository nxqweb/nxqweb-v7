import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, MessageSquarePlus } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { ClientSitePhotos } from "../components/ClientSitePhotos";
import { sitePhotosGateway } from "../lib/sitePhotosConfig";
import { createPhotoUploader } from "../lib/sitePhotoUpload";
import { colourModeOptions, defaultBriefOptions, redesignDescription, redesignProblem, type ColourMode } from "../lib/websiteBrief";

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
  const [clientId, setClientId] = useState("");
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
  const [redesignOpen, setRedesignOpen] = useState(() => new URLSearchParams(window.location.search).get("mode") === "redesign");
  const [rdChange, setRdChange] = useState("");
  const [rdStyle, setRdStyle] = useState("");
  const [rdPages, setRdPages] = useState("");
  const [rdColour, setRdColour] = useState<ColourMode>(defaultBriefOptions.colourMode);
  const [rdSeo, setRdSeo] = useState(defaultBriefOptions.seo);
  const [rdSmooth, setRdSmooth] = useState(defaultBriefOptions.smoothScroll);
  const [rdExtra, setRdExtra] = useState("");

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
    setClientId(client.data.id);

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

    setMessage("Change request submitted. NXQX will route it through the protected review, build, and preview path before any publish action.");
    setTitle("");
    setDescription("");
    setPhone("");
    setEmail("");
    setService("");
    await load();
  }

  async function submitRedesign() {
    const input = { whatToChange: rdChange, styleDirection: rdStyle, pagesNeeded: rdPages, options: { colourMode: rdColour, seo: rdSeo, smoothScroll: rdSmooth }, extra: rdExtra };
    const problem = redesignProblem(input);
    if (problem) { setError(problem); return; }
    if (!supabase || !projectId) { setError("Website changes are temporarily unavailable. No request was changed."); return; }
    setSending(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("submit_current_client_change_request", {
      target_project_id: projectId,
      target_request_type: "design",
      target_title: "Redesign my website",
      target_description: redesignDescription(input),
      target_priority: "normal",
      target_payload: { patch: {} },
    });
    setSending(false);
    if (result.error) { setError("Your redesign request could not be submitted. Nothing was queued or published; please try again."); return; }
    setMessage("Redesign request submitted. NXQX will route it through the protected review, build, and preview path before anything is published.");
    setRdChange(""); setRdStyle(""); setRdPages(""); setRdExtra("");
    setRedesignOpen(false);
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
              <p className="subtle">Request updates without emailing back and forth. NXQX routes changes through a protected build, review, and preview path.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/business"><ArrowLeft size={16} /> Business</a>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {message ? <div className="auth-success"><CheckCircle2 size={16} /> {message}</div> : null}

        {redesignOpen ? (
          <section className="panel panel-wide" data-testid="redesign-panel">
            <h2>Redesign my website</h2>
            <div className="notice-card">Tell us what you want different. Everything is optional except what to change. This goes through the same protected review and preview as every change; nothing is published directly. To add new pictures, upload them on the Files card in your portal once the request is in.</div>
            <label className="auth-label" htmlFor="rd-change">What would you like to change? <em className="required-mark">(required)</em></label>
            <textarea className="auth-input" disabled={sending || loading} id="rd-change" maxLength={1500} rows={4} value={rdChange} onChange={(event) => setRdChange(event.target.value)} placeholder="Example: a fresher look, new colours, a gallery of my work, fewer pages." />
            <label className="auth-label" htmlFor="rd-style">New style direction</label>
            <textarea className="auth-input" disabled={sending || loading} id="rd-style" maxLength={1500} rows={3} value={rdStyle} onChange={(event) => setRdStyle(event.target.value)} placeholder="Describe the look you want now, in your own words." />
            <label className="auth-label" htmlFor="rd-pages">Pages or sections wanted</label>
            <textarea className="auth-input" disabled={sending || loading} id="rd-pages" maxLength={1500} rows={2} value={rdPages} onChange={(event) => setRdPages(event.target.value)} placeholder="Example: Home, Services, My work, Reviews, Contact" />
            <fieldset className="website-look">
              <legend>Your website's look</legend>
              <div className="website-look-modes" role="radiogroup" aria-label="Website colour mode">
                {colourModeOptions.map((option) => (
                  <label className={rdColour === option.value ? "look-mode active" : "look-mode"} key={option.value}>
                    <input checked={rdColour === option.value} disabled={sending || loading} name="rd-colour-mode" onChange={() => setRdColour(option.value)} type="radio" value={option.value} />
                    <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                  </label>
                ))}
              </div>
              <label className="look-check"><input checked={rdSeo} disabled={sending || loading} onChange={(event) => setRdSeo(event.target.checked)} type="checkbox" /><span><strong>Let search engines list my website (SEO)</strong></span></label>
              <label className="look-check"><input checked={rdSmooth} disabled={sending || loading} onChange={(event) => setRdSmooth(event.target.checked)} type="checkbox" /><span><strong>Smooth scrolling</strong></span></label>
            </fieldset>
            {sitePhotosGateway && supabase && clientId ? <ClientSitePhotos gateway={sitePhotosGateway} upload={createPhotoUploader(supabase, clientId)} /> : null}
            <label className="auth-label" htmlFor="rd-extra">Anything else?</label>
            <textarea className="auth-input" disabled={sending || loading} id="rd-extra" maxLength={1500} rows={2} value={rdExtra} onChange={(event) => setRdExtra(event.target.value)} />
            <button className="wide-btn" disabled={sending || loading || !projectId || rdChange.trim().length < 5} onClick={() => void submitRedesign()} type="button">{sending ? "Submitting…" : "Send redesign request"}</button>
          </section>
        ) : (
          <section className="panel panel-wide"><button className="wide-btn" data-testid="open-redesign" onClick={() => setRedesignOpen(true)} type="button">Redesign my website</button></section>
        )}

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
