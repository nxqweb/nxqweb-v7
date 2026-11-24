import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { decisionConfirm, formFromSettings, parseBackgroundSettings, parseWaitingRequests, settingsChangeSummary, settingsPayload, settingsProblem, type BackgroundSettings, type SettingsForm, type WaitingRequest } from "../lib/backgroundOwner";

// The owner's limits and approval screen for the automatic store-background maker (database draft 11). Nothing generated goes live until the owner approves it here.
const emptySettings = parseBackgroundSettings(null);

export function OwnerBackgrounds() {
  const [settings, setSettings] = useState<BackgroundSettings>(emptySettings);
  const [form, setForm] = useState<SettingsForm>(formFromSettings(emptySettings));
  const [waiting, setWaiting] = useState<WaitingRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const problem = settingsProblem(form);

  async function refresh() {
    if (!supabase) return;
    const [s, w] = await Promise.all([supabase.rpc("owner_get_background_settings"), supabase.rpc("owner_list_background_requests", { status_filter: "pending_approval" })]);
    if (s.error || w.error) { setError("The background settings could not be loaded right now."); return; }
    const parsed = parseBackgroundSettings(s.data);
    setSettings(parsed); setForm(formFromSettings(parsed)); setWaiting(parseWaitingRequests(w.data)); setLoaded(true);
  }
  useEffect(() => { void refresh(); }, []);

  async function save() {
    const payload = settingsPayload(form);
    if (!supabase || !payload || busy) return;
    if (!window.confirm(`Save these changes?\n\n${settingsChangeSummary(settings, form)}`)) return;
    setBusy(true); setError(""); setMessage("");
    const result = await supabase.rpc("owner_set_background_settings", payload);
    setBusy(false);
    if (result.error) { setError("The settings were not saved. Check the numbers and try again."); return; }
    setMessage("Saved.");
    await refresh();
  }

  async function decide(request: WaitingRequest, approve: boolean) {
    if (!supabase || busy) return;
    if (!window.confirm(decisionConfirm(request, approve))) return;
    setBusy(true); setError(""); setMessage("");
    const result = await supabase.rpc("owner_decide_background_request", { request_uuid: request.id, approve });
    setBusy(false);
    if (result.error) { setError("That decision could not be saved. It may already have been decided."); await refresh(); return; }
    setMessage(approve ? "Approved. The background is live on that store." : "Rejected. The store was not changed.");
    await refresh();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner</p>
            <h1>Automatic backgrounds</h1>
            <p className="subtle">Set how many background pictures the maker may create, and approve each picture before it goes live. Nothing it makes is shown on a store until you approve it.</p>
          </div>
          <div className="stat-card"><a className="wide-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a></div>
        </div>
        {!isSupabaseConfigured || !supabase ? <div className="notice-card error" role="alert">Supabase is not configured.</div> : null}
        {error ? <div className="notice-card error" role="alert">{error}</div> : null}
        {message ? <div className="notice-card success" role="status">{message}</div> : null}
        {loaded ? <>
          <section className="panel panel-wide" data-testid="background-limits">
            <div className="panel-title"><h2>Limits</h2></div>
            <p className="subtle">Made so far this month: {settings.madeThisMonth}. Counted in pictures, never in money. A try that fails or is rejected still counts.</p>
            <div className="setup-form-grid">
              <label className="field"><span>Automatic backgrounds</span>
                <select value={form.switchedOn ? "on" : "off"} onChange={(e) => setForm({ ...form, switchedOn: e.target.value === "on" })}>
                  <option value="off">Off</option>
                  <option value="on">On</option>
                </select>
              </label>
              <label className="field">Pictures per store
                <input type="text" inputMode="numeric" value={form.perStoreAllowance} onChange={(e) => setForm({ ...form, perStoreAllowance: e.target.value })} />
              </label>
              <label className="field">Period (days)
                <input type="text" inputMode="numeric" value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: e.target.value })} />
              </label>
              <label className="field">Monthly limit for all stores
                <input type="text" inputMode="numeric" value={form.monthlyCap} onChange={(e) => setForm({ ...form, monthlyCap: e.target.value })} />
              </label>
              <label className="field">Wait between tries (seconds)
                <input type="text" inputMode="numeric" value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: e.target.value })} />
              </label>
            </div>
            {problem ? <p className="subtle" role="alert">{problem}</p> : null}
            <button className="wide-btn" type="button" disabled={busy || Boolean(problem)} onClick={() => void save()}>{busy ? "Saving..." : "Save limits"}</button>
          </section>
          <section className="panel panel-wide" data-testid="background-waiting">
            <div className="panel-title"><h2>Waiting for your approval</h2></div>
            {waiting.length === 0 ? <p className="subtle">Nothing is waiting.</p> : waiting.map((request) => (
              <div key={request.id} className="settings-grid" style={{ marginBottom: "1rem" }}>
                <div>
                  <strong>{request.storeName || request.storeSlug}</strong>
                  <p className="subtle">{request.storeSlug} · {request.createdAt ? new Date(request.createdAt).toLocaleString() : ""} · softening {Math.round(request.overlay * 100)}%</p>
                  {request.imageUrl ? <p><img src={request.imageUrl} alt="Background waiting for approval" style={{ maxWidth: "20rem", maxHeight: "12rem", objectFit: "cover", borderRadius: ".5rem" }} /></p> : <p className="subtle">The picture could not be shown.</p>}
                  <button className="wide-btn" type="button" disabled={busy || !request.imageUrl} onClick={() => void decide(request, true)}>Approve</button>
                  <button className="icon-btn" type="button" disabled={busy} onClick={() => void decide(request, false)}>Reject</button>
                </div>
              </div>
            ))}
          </section>
        </> : !error ? <p className="subtle">Loading...</p> : null}
      </section>
    </main>
  );
}
