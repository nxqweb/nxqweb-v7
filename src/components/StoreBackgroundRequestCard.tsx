import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { MOODS, WHAT_I_SELL_MAX, parseBackgroundStatus, requestPayload, requestProblem, requestResultMessage, statusLine, type BackgroundStatus } from "../lib/backgroundRequest";

// "Make me a background" (database draft 11). Hidden until the owner switches the maker on. The picture is checked by the owner before it goes live.
export function StoreBackgroundRequestCard() {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [mood, setMood] = useState("calm");
  const [whatISell, setWhatISell] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const problem = requestProblem({ mood, whatISell });

  async function refresh() {
    if (!supabase) return;
    const result = await supabase.rpc("get_my_background_status");
    if (!result.error) setStatus(parseBackgroundStatus(result.data));
  }
  useEffect(() => { void refresh(); }, []);

  async function send() {
    const payload = requestPayload({ mood, whatISell });
    if (!supabase || !payload || busy) return;
    setBusy(true); setMessage(""); setError("");
    const result = await supabase.rpc("request_my_store_background", payload);
    setBusy(false);
    if (result.error) { setError("We could not send your request this time. Please try again later."); return; }
    const outcome = requestResultMessage(result.data);
    if (outcome.ok) setMessage(outcome.message); else setError(outcome.message);
    await refresh();
  }

  if (!status || !status.enabled) return null;
  const latest = statusLine(status.latestStatus);
  return <section className="panel panel-wide" data-testid="store-background-request">
    <div className="panel-title"><Sparkles size={20} /><div><h2>Make me a background</h2><p className="subtle">We can create a soft background picture for your store. Tell us the feel you want. NXQX checks it before it goes on your store.</p></div></div>
    <p className="subtle">You have {status.remaining} of {status.allowance} tries left.</p>
    {latest ? <p className="subtle" data-testid="background-latest">{latest}</p> : null}
    {status.inProgress ? <p className="subtle">Please wait for this one to finish before asking for another.</p> : <>
      <div className="setup-form-grid">
        <label className="auth-label"><span>Feel</span>
          <select className="auth-input" value={mood} onChange={(e) => setMood(e.target.value)}>
            {MOODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="auth-label"><span>What do you sell? <em className="optional-tag">optional</em></span>
          <input className="auth-input" maxLength={WHAT_I_SELL_MAX + 20} value={whatISell} onChange={(e) => setWhatISell(e.target.value)} placeholder="for example: handmade candles and soap" />
        </label>
      </div>
      {problem ? <p className="subtle" role="alert">{problem}</p> : null}
      {!status.canRequest && status.reason ? <p className="subtle">{status.reason}</p> : null}
      <button className="wide-btn" type="button" disabled={busy || Boolean(problem) || !status.canRequest} onClick={() => void send()}>{busy ? "Sending..." : "Make me a background"}</button>
    </>}
    {message ? <div className="auth-success" role="status">{message}</div> : null}
    {error ? <div className="auth-error" role="alert">{error}</div> : null}
  </section>;
}
