import { useEffect, useRef, useState } from "react";
import { Flag, Send } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { buildProblemReport, problemCategories, problemLimits } from "../lib/problemReport";

// A small "Report a problem" button on every client page. It opens a short form; the report reaches the NXQX team as a labelled portal message.
export function ReportProblem() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("broken");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    openerRef.current?.focus();
  }

  function begin() { setSent(false); setError(""); setOpen(true); }

  async function submit() {
    if (busy) return;
    const built = buildProblemReport({ category, text, path: window.location.pathname, width: window.innerWidth, height: window.innerHeight });
    if (!built.ok) { setError(built.error); return; }
    if (!isSupabaseConfigured || !supabase) { setError("Reporting is unavailable right now. Please try again later."); return; }
    setBusy(true); setError("");
    try {
      const result = await supabase.rpc("send_client_portal_message", { message_text: built.message });
      if (result.error) setError("We could not send your report. Nothing was sent. Please try again in a moment.");
      else { setSent(true); setText(""); }
    } catch { setError("We could not send your report. Nothing was sent. Please try again in a moment."); }
    setBusy(false);
  }

  return (
    <>
      <button ref={openerRef} className="report-problem-btn icon-btn" type="button" onClick={begin} data-testid="report-problem-open"><Flag size={15} /> Report a problem</button>
      {open ? <dialog ref={dialogRef} className="report-problem-dialog" aria-labelledby="report-problem-title" onClose={() => { setOpen(false); openerRef.current?.focus(); }}>
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2 id="report-problem-title">Report a problem</h2>
          {sent ? <>
            <p className="auth-success" role="status">Thank you! The NXQX team got your report and will reply in your messages.</p>
            <button className="wide-btn" type="button" onClick={close}>Close</button>
          </> : <>
            <p className="subtle">Tell us what happened. The team sees which page you were on. Please do not type passwords or card numbers.</p>
            <label className="auth-label" htmlFor="report-category"><span>What kind of report?</span></label>
            <select id="report-category" className="auth-input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {problemCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <label className="auth-label" htmlFor="report-text"><span>What happened? <em className="required-mark">(required)</em></span></label>
            <textarea id="report-text" className="auth-input" rows={5} maxLength={problemLimits.max} value={text} onChange={(event) => setText(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "report-error" : undefined} placeholder="Example: I pressed Save on the Products page and nothing happened." />
            {error ? <div className="auth-error" id="report-error" role="alert">{error}</div> : null}
            <div className="settings-grid">
              <button className="wide-btn" type="submit" disabled={busy}><Send size={16} /> {busy ? "Sending..." : "Send report"}</button>
              <button className="icon-btn" type="button" onClick={close}>Cancel</button>
            </div>
          </>}
        </form>
      </dialog> : null}
    </>
  );
}
