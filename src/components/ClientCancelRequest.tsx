import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { buildCancelRequest, cancelReasonMax } from "../lib/cancelRequest";

// Plain two-step request: nothing is sent until the client presses "Send cancellation request", and sending only tells the team. Nothing ends on its own.
// The date of a sent request is remembered on this device only, so a return visit says "already sent" instead of inviting a duplicate (sending again is still allowed).
const SENT_KEY = "nxq-cancel-request-sent-v1";

function readSent(): string {
  try { return window.localStorage.getItem(SENT_KEY) || ""; } catch { return ""; }
}
function writeSent(value: string) {
  try { window.localStorage.setItem(SENT_KEY, value); } catch { /* storage can be blocked; the request itself was still sent */ }
}

export function ClientCancelRequest() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [earlier, setEarlier] = useState(() => readSent());
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => { if (open) reasonRef.current?.focus(); }, [open]);
  useEffect(() => { if (sent) statusRef.current?.focus(); }, [sent]);

  async function send() {
    if (busy) return;
    const built = buildCancelRequest(reason);
    if (!built.ok) { setError(built.error); return; }
    if (!isSupabaseConfigured || !supabase) { setError("Sending is unavailable right now. Please try again later."); return; }
    setBusy(true); setError("");
    try {
      const result = await supabase.rpc("send_client_portal_message", { message_text: built.message });
      if (result.error) setError("We could not send your request. Nothing was sent and your plan has not changed. Please try again in a moment.");
      else { writeSent(new Date().toISOString()); setSent(true); }
    } catch { setError("We could not send your request. Nothing was sent and your plan has not changed. Please try again in a moment."); }
    setBusy(false);
  }

  function keep() {
    setOpen(false); setError("");
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }

  const earlierDate = earlier && !Number.isNaN(new Date(earlier).getTime()) ? new Date(earlier).toLocaleDateString() : "";

  return (
    <section className="panel panel-wide" data-testid="cancel-request">
      <div className="panel-title">
        <LogOut size={20} />
        <div>
          <h2>Cancel my plan</h2>
          <p className="subtle">You can ask to cancel any time. This sends your request to the NXQX team. Nothing changes until the team replies in your messages and confirms with you.</p>
        </div>
      </div>
      <div aria-live="polite">
        {sent ? <p className="auth-success" ref={statusRef} role="status" tabIndex={-1}>Your request was sent. The NXQX team will reply in your messages. Your plan stays as it is until then.</p> : null}
      </div>
      {sent ? null : earlierDate && !open ? (
        <>
          <p className="subtle" data-testid="cancel-request-earlier">You sent a cancellation request on {earlierDate}. The NXQX team will reply in your messages. Your plan stays as it is until then.</p>
          <button className="icon-btn" data-testid="cancel-request-open" onClick={() => { setEarlier(""); setOpen(true); }} ref={openerRef} type="button">Send another request</button>
        </>
      ) : !open ? (
        <button className="icon-btn" data-testid="cancel-request-open" onClick={() => setOpen(true)} ref={openerRef} type="button">I want to cancel my plan</button>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label className="auth-label" htmlFor="cancel-reason"><span>Why are you leaving? <em className="optional-tag">(optional)</em></span></label>
          <textarea aria-describedby={error ? "cancel-error" : undefined} aria-invalid={error ? true : undefined} className="auth-input" id="cancel-reason" maxLength={cancelReasonMax} onChange={(event) => setReason(event.target.value)} ref={reasonRef} rows={3} value={reason} />
          {error ? <div className="auth-error" id="cancel-error" role="alert">{error}</div> : null}
          <div className="settings-grid">
            <button className="wide-btn" disabled={busy} type="submit">{busy ? "Sending..." : "Send cancellation request"}</button>
            <button className="icon-btn" disabled={busy} onClick={keep} type="button">Keep my plan</button>
          </div>
        </form>
      )}
    </section>
  );
}
