import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import {
  createClientLifecycleGateway, emptyOverview, firstMonthLabel, firstMonthTone, validNote,
  type LifecycleOverview, type LifecycleRow,
} from "../lib/clientLifecycle";

type ClientOption = { id: string; business_name: string };

export function OwnerClientLifecycle() {
  const gateway = supabase ? createClientLifecycleGateway(supabase) : null;
  const [overview, setOverview] = useState<LifecycleOverview>(emptyOverview());
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [pickId, setPickId] = useState("");
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    if (!gateway || !supabase || !isSupabaseConfigured) { setError("Supabase is not configured."); setLoading(false); return; }
    try {
      setOverview(await gateway.overview());
      const list = await supabase.from("clients").select("id, business_name").order("business_name").limit(300);
      if (!list.error) setClients((list.data || []) as ClientOption[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- loads once on open; Refresh and every action call load() again

  async function run(action: () => Promise<{ message?: string } | null>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await action();
      setMessage(result?.message || "Done.");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
    setBusy(false);
  }

  const picked = clients.find((c) => c.id === pickId);
  const noteOk = validNote(note);

  function Row({ row, children }: { row: LifecycleRow; children: React.ReactNode }) {
    return (
      <article className="approval-card" data-testid="lifecycle-row">
        <div className="approval-top"><span>{row.business_name}</span></div>
        {children}
      </article>
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner</p>
            <h1>Pause, cancel and free first month</h1>
            <p className="subtle">Pausing stops new orders, requests, inquiries and booking requests; the site stays visible. Cancelling does the same and gives you a take-down to-do.</p>
          </div>
          <div className="stat-card">
            <span>Sites to take down</span>
            <strong>{overview.needs_take_down.length}</strong>
            <a className="wide-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a>
          </div>
        </div>

        {error ? <div className="notice-card error" role="alert">{error}</div> : null}
        {message ? <div className="notice-card success" role="status">{message}</div> : null}

        <section className="panel panel-wide">
          <div className="panel-title panel-title-row">
            <h2>Take these sites down</h2>
            <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading}><RefreshCcw size={16} /> Refresh</button>
          </div>
          {overview.needs_take_down.length === 0 ? <p className="subtle">{loading ? "Loading..." : "Nothing to take down."}</p> : overview.needs_take_down.map((row) => (
            <Row key={row.client_id} row={row}>
              <p className="subtle">Cancelled {row.cancelled_at ? new Date(row.cancelled_at).toLocaleDateString() : ""}. Unpublish the site by hand, then press the button.</p>
              <button className="wide-btn" type="button" disabled={busy} onClick={() => void run(() => gateway!.markTakenDown(row.client_id))}>I took it down</button>
            </Row>
          ))}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><h2>Free first month</h2></div>
          {overview.first_month.length === 0 ? <p className="subtle">{loading ? "Loading..." : "No free months running."}</p> : overview.first_month.map((row) => (
            <Row key={row.client_id} row={row}>
              <p className="subtle" data-tone={firstMonthTone(row.first_month_days_left)}>{firstMonthLabel(row.first_month_days_left)}</p>
              <button className="wide-btn" type="button" disabled={busy} onClick={() => void run(() => gateway!.noteFirstInvoice(row.client_id))}>I started invoicing</button>
            </Row>
          ))}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><h2>Paused</h2></div>
          {overview.paused.length === 0 ? <p className="subtle">{loading ? "Loading..." : "Nobody is paused."}</p> : overview.paused.map((row) => (
            <Row key={row.client_id} row={row}>
              <p className="subtle">{row.paused_reason || "No reason saved."}</p>
              <button className="wide-btn" type="button" disabled={busy} onClick={() => void run(() => gateway!.resume(row.client_id))}>Resume</button>
            </Row>
          ))}
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><h2>Change a client</h2></div>
          <label className="field">Client
            <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
              <option value="">Choose a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.business_name}</option>)}
            </select>
          </label>
          <label className="field">Reason or note (8 characters or more)
            <input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="button-row">
            <button className="wide-btn" type="button" disabled={busy || !pickId || !noteOk} onClick={() => void run(() => gateway!.pause(pickId, note))}>Pause</button>
            <button className="wide-btn" type="button" disabled={busy || !pickId || !noteOk} onClick={() => void run(() => gateway!.cancel(pickId, note), `Cancel ${picked?.business_name || "this client"}? New submissions stop and you get a take-down to-do.`)}>Cancel client</button>
          </div>
          <label className="field">Start the free month on (optional, to set it by hand)
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <button className="wide-btn" type="button" disabled={busy || !pickId || !startDate} onClick={() => void run(() => gateway!.setFirstMonth(pickId, startDate))}>Set free month</button>
        </section>
      </section>
    </main>
  );
}
