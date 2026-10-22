import { useState } from "react";
import { LogOut } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { buildCancelRequest, cancelReasonMax } from "../lib/cancelRequest";

// Plain two-step request: nothing is sent until the client presses "Send cancellation request", and sending only tells the team. Nothing ends on its own.
export function ClientCancelRequest() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (busy) return;
    const built = buildCancelRequest(reason);
    if (!built.ok) { setError(built.error); return; }
    if (!isSupabaseConfigured || !supabase) { setError("Sending is unavailable right now. Please try again later."); return; }
    setBusy(true); setError("");
    try {
      const result = await supabase.rpc("send_client_portal_message", { message_text: built.message });
      if (result.error) setError("We could not send your request. Nothing was sent and your plan has not changed. Please try again in a moment.");
      else setSent(true);
    } catch { setError("We could not send your request. Nothing was sent and your plan has not changed. Please try again in a moment."); }
    setBusy(false);
  }

  return (
    <section className="panel panel-wide" data-testid="cancel-request">
      <div className="panel-title">
        <LogOut size={20} />
        <div>
          <h2>Cancel my plan</h2>
          <p className="subtle">You can ask to cancel any time. This sends your request to the NXQX team. Nothing changes until the team replies in your messages and confirms with you.</p>
        </div>
      </div>
      {sent ? (
        <p className="auth-success" role="status">Your request was sent. The NXQX team will reply in your messages. Your plan stays as it is until then.</p>
      ) : !open ? (
        <button className="icon-btn" data-testid="cancel-request-open" onClick={() => setOpen(true)} type="button">I want to cancel my plan</button>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label className="auth-label" htmlFor="cancel-reason"><span>Why are you leaving? <em className="optional-tag">(optional)</em></span></label>
          <textarea className="auth-input" id="cancel-reason" maxLength={cancelReasonMax} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <div className="settings-grid">
            <button className="wide-btn" disabled={busy} type="submit">{busy ? "Sending..." : "Send cancellation request"}</button>
            <button className="icon-btn" disabled={busy} onClick={() => { setOpen(false); setError(""); }} type="button">Keep my plan</button>
          </div>
        </form>
      )}
    </section>
  );
}
