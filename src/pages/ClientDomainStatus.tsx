import { useEffect, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Clock3, Globe2, RefreshCcw, ShieldAlert } from "lucide-react";
import { domainSafetyRules, getDomainGuide } from "../lib/domainGuides";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Domain = {
  id: string;
  domain_name: string;
  status: string;
  automation_state: string;
  automation_enabled: boolean;
  dns_status: string;
  ssl_status: string;
  last_checked_at: string | null;
  next_check_at: string;
  automation_error: string | null;
  action_required_message: string | null;
  dns_instructions: string | null;
  registrar_name: string | null;
  dns_provider: string | null;
};

const selectFields = "id,domain_name,status,automation_state,automation_enabled,dns_status,ssl_status,last_checked_at,next_check_at,automation_error,action_required_message,dns_instructions,registrar_name,dns_provider";

function label(state: string) {
  return state.replaceAll("_", " ");
}

export function ClientDomainStatus() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
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
      setError(client.error?.message || "Client account not found.");
      setLoading(false);
      return;
    }
    const rows = await supabase.from("client_domains").select(selectFields).eq("client_id", client.data.id).order("requested_at", { ascending: false });
    if (rows.error) {
      setError(rows.error.message);
      setLoading(false);
      return;
    }
    setDomains((rows.data || []) as Domain[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function recheck(domain: Domain) {
    if (!supabase) return;
    setBusy(domain.id);
    setError("");
    setNotice("");
    const result = await supabase.rpc("current_client_request_domain_recheck", { target_domain_id: domain.id });
    if (result.error) setError(result.error.message);
    else {
      setNotice(`NXQ queued a fresh DNS and SSL check for ${domain.domain_name}.`);
      await load();
    }
    setBusy(null);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell domain-guide-page">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Globe2 size={22} />
            <div>
              <p className="eyebrow">Guided domain connection</p>
              <h1>Domain status</h1>
              <p className="subtle">NXQ checks DNS and SSL automatically. If your registrar needs you, the exact next action stays here.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/settings"><ArrowLeft size={16} /> Settings</a>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {notice ? <div className="auth-success">{notice}</div> : null}
        {loading ? <div className="empty-state" role="status">Loading domain status...</div> : null}
        {!loading && domains.length === 0 ? (
          <div className="empty-state">
            <Globe2 size={22} />
            <strong>No domain submitted yet</strong>
            <p>You can submit the domain you own from Settings. NXQ will review it before any DNS connection begins.</p>
            <a className="wide-btn" href="/client/settings" style={{ width: "auto" }}>Open domain settings</a>
          </div>
        ) : null}

        <div className="domain-guide-list">
          {domains.map((domain) => {
            const connected = domain.automation_state === "connected" && domain.ssl_status === "ready";
            const action = domain.automation_state === "action_required" || Boolean(domain.action_required_message);
            const guide = getDomainGuide(domain.registrar_name, domain.dns_provider);
            return (
              <article className={`panel domain-guide-card ${connected ? "connected" : action ? "action-required" : "checking"}`} key={domain.id}>
                <div className="panel-title panel-title-row">
                  <div className="panel-title">
                    {connected ? <CheckCircle2 size={21} /> : action ? <CircleAlert size={21} /> : <RefreshCcw size={21} />}
                    <div>
                      <strong>{domain.domain_name}</strong>
                      <p className="subtle">DNS {label(domain.dns_status)} · SSL {label(domain.ssl_status)}</p>
                    </div>
                  </div>
                  <span className="status-summary">{connected ? "connected" : action ? "action required" : "NXQ checking"}</span>
                </div>

                {connected ? (
                  <div className="domain-success-state">
                    <CheckCircle2 size={19} />
                    <div><strong>Connection complete</strong><p>DNS and SSL evidence are ready. NXQ will keep monitoring the domain.</p></div>
                  </div>
                ) : null}

                {action ? (
                  <section className="domain-action-panel">
                    <div className="panel-title"><CircleAlert size={19} /><div><span className="journey-kicker">Your action</span><strong>{domain.action_required_message || "Update the requested DNS record"}</strong></div></div>

                    {guide ? (
                      <div className="domain-provider-path">
                        <span>In {guide.provider}, open:</span>
                        <ol aria-label={`${guide.provider} navigation path`}>
                          {guide.openPath.map((step) => <li key={step}>{step}</li>)}
                        </ol>
                        <p>Make the NXQ-provided change in <strong>{guide.recordArea}</strong>.</p>
                      </div>
                    ) : (
                      <p>Sign in to the company where your DNS is managed, open the DNS records for this domain, and use the exact NXQ instructions below.</p>
                    )}

                    {domain.dns_instructions ? (
                      <div className="domain-exact-instructions">
                        <span>Exact NXQ instructions</span>
                        <pre>{domain.dns_instructions}</pre>
                      </div>
                    ) : (
                      <div className="auth-error">The exact DNS record is still being prepared. Do not guess or change records yet.</div>
                    )}

                    <details className="domain-safety-details">
                      <summary><ShieldAlert size={17} /> Protect your website and email</summary>
                      <ul>{domainSafetyRules.map((rule) => <li key={rule}><Check size={15} /> {rule}</li>)}</ul>
                    </details>
                  </section>
                ) : null}

                {!connected && !action ? (
                  <div className="domain-checking-state">
                    <Clock3 size={18} />
                    <div><strong>NXQ is checking automatically</strong><p>No change is required unless this card switches to Action required.</p></div>
                  </div>
                ) : null}

                {domain.automation_error && !action ? <p className="subtle">Last check note: {domain.automation_error}</p> : null}
                <div className="domain-meta-grid">
                  <span><strong>Registrar</strong>{domain.registrar_name || "Not specified"}</span>
                  <span><strong>DNS provider</strong>{domain.dns_provider || "Not specified"}</span>
                  <span><strong>Last checked</strong>{domain.last_checked_at ? new Date(domain.last_checked_at).toLocaleString() : "Not checked yet"}</span>
                  <span><strong>Next automatic check</strong>{domain.next_check_at ? new Date(domain.next_check_at).toLocaleString() : "Not scheduled"}</span>
                </div>
                <button className="wide-btn" type="button" disabled={busy === domain.id || !domain.automation_enabled || connected} onClick={() => void recheck(domain)}>
                  <RefreshCcw size={16} /> {busy === domain.id ? "Queuing fresh check..." : connected ? "Domain connected" : "I made the change — check again"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
