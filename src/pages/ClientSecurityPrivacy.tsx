import { useEffect, useState } from "react";
import { ArrowLeft, Download, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type EventRow = { id: string; event_type: string; severity: string; trusted: boolean; device_reference: string | null; created_at: string };
type Credential = { id: string; credential_type: string; display_name: string | null; assurance_level: number; status: string; last_used_at: string | null; created_at: string };
type Consent = { id: string; consent_type: string; policy_version: string; status: string; created_at: string };
type Request = { id: string; request_code: string; request_type: string; status: string; requested_at: string; due_at: string | null; result: Record<string, unknown> | null; last_error: string | null };

export function ClientSecurityPrivacy() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    if (!isSupabaseConfigured || !supabase) {
      setError("Security and privacy details are temporarily unavailable.");
      return;
    }

    const [eventResult, credentialResult, consentResult, requestResult] = await Promise.all([
      supabase.from("account_security_events").select("id,event_type,severity,trusted,device_reference,created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("nxq_trusted_credentials").select("id,credential_type,display_name,assurance_level,status,last_used_at,created_at").order("created_at", { ascending: false }),
      supabase.from("privacy_consents").select("id,consent_type,policy_version,status,created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("data_subject_requests").select("id,request_code,request_type,status,requested_at,due_at,result,last_error").order("requested_at", { ascending: false }).limit(20),
    ]);

    const loadError = eventResult.error || credentialResult.error || consentResult.error || requestResult.error;
    if (loadError) {
      setError("Security and privacy details could not be loaded right now.");
      return;
    }

    setEvents((eventResult.data || []) as EventRow[]);
    setCredentials((credentialResult.data || []) as Credential[]);
    setConsents((consentResult.data || []) as Consent[]);
    setRequests((requestResult.data || []) as Request[]);
  }

  useEffect(() => { void load(); }, []);

  async function request(type: "export" | "delete" | "restrict") {
    if (!supabase) return;
    if (type === "delete" && !window.confirm("Submit an account/data deletion request? NXQ will verify the request before any destructive action.")) return;

    setError("");
    setMessage("");
    const result = await supabase.rpc("submit_current_account_data_request", {
      target_request_type: type,
      target_scope: { source: "client_security_privacy_center" },
    });

    if (result.error) {
      setError("NXQ could not submit this data request right now. Please try again.");
      return;
    }

    setMessage(`${type} request submitted. No destructive deletion occurs automatically without the required verification workflow.`);
    await load();
  }

  function downloadExport(requestRow: Request) {
    if (requestRow.request_type !== "export" || requestRow.status !== "ready" || !requestRow.result) return;
    const blob = new Blob([JSON.stringify(requestRow.result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${requestRow.request_code.toLowerCase()}-nxq-export.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShieldCheck size={22} />
            <div>
              <h1>Security & privacy</h1>
              <p className="subtle">NXQ ID security activity, trusted credentials, consent state, and data requests.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/settings"><ArrowLeft size={16} /> Settings</a>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {message ? <div className="auth-success" role="status">{message}</div> : null}

        <div className="owner-detail-grid">
          <section className="panel panel-wide">
            <div className="panel-title"><KeyRound size={20} /><div><h2>Trusted credentials</h2><p className="subtle">Passkeys/security keys store provider/public credential references only — never fingerprints, face scans, or private keys.</p></div></div>
            {credentials.length === 0 ? <div className="empty-state">No trusted credential metadata is registered yet.</div> : credentials.map((credential) => <div className="owner-message-card" key={credential.id}><strong>{credential.display_name || credential.credential_type}</strong><span className="subtle">{credential.credential_type} · assurance {credential.assurance_level} · {credential.status}</span></div>)}
          </section>

          <section className="panel panel-wide">
            <h2>Recent security activity</h2>
            {events.length === 0 ? <div className="empty-state">No security events recorded yet.</div> : events.map((eventRow) => <div className="owner-message-card" key={eventRow.id}><strong>{eventRow.event_type.replaceAll("_", " ")}</strong><span className="subtle">{eventRow.severity} · {eventRow.trusted ? "trusted" : "unverified context"} · {new Date(eventRow.created_at).toLocaleString()}</span></div>)}
          </section>

          <section className="panel panel-wide">
            <h2>Privacy consent</h2>
            {consents.length === 0 ? <div className="empty-state">No account-level consent records yet. Visitor analytics consent on managed websites is also kept separate from NXQ account identity.</div> : consents.map((consent) => <div className="owner-message-card" key={consent.id}><strong>{consent.consent_type.replaceAll("_", " ")}</strong><span className="subtle">{consent.status} · policy {consent.policy_version}</span></div>)}
          </section>

          <section className="panel panel-wide">
            <h2>Your data</h2>
            <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
              <button className="wide-btn" type="button" onClick={() => void request("export")}><Download size={16} /> Request export</button>
              <button className="wide-btn" type="button" onClick={() => void request("restrict")}><ShieldCheck size={16} /> Request restriction</button>
              <button className="wide-btn" type="button" onClick={() => void request("delete")}><Trash2 size={16} /> Request deletion</button>
            </div>

            {requests.map((requestRow) => (
              <div className="owner-message-card" key={requestRow.id}>
                <div className="panel-title panel-title-row">
                  <div><strong>{requestRow.request_code} · {requestRow.request_type}</strong><p className="subtle">{requestRow.status} · submitted {new Date(requestRow.requested_at).toLocaleString()}</p></div>
                  {requestRow.request_type === "export" && requestRow.status === "ready" && requestRow.result ? <button className="icon-btn" type="button" onClick={() => downloadExport(requestRow)}><Download size={15} /> Download export</button> : null}
                </div>
                {requestRow.last_error ? <div className="auth-error">This request needs another review. Detailed internal error information is not exposed in the client portal.</div> : null}
                {requestRow.status === "identity_check" ? <p className="subtle">NXQ is waiting for the required identity re-verification before any destructive action.</p> : null}
              </div>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
