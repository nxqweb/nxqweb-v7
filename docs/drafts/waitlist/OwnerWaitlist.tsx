import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { waitlistGateway } from "../lib/waitlistConfig";
import { MAX_INVITES_PER_WAVE, suggestedWave, totalOnList, waitlistStatusLabels, waveProblem, type WaitlistSummary } from "../lib/waitlist";

// Owner screen for the pre-launch waiting list (DRAFT: docs/drafts/waitlist/; final home src/pages/OwnerWaitlist.tsx). Counts only, never addresses. "Invite a wave" takes the
// oldest confirmed people first. Today it only MARKS people as invited: no email is sent until an email sender exists (the text on the page says so).
export function OwnerWaitlist() {
  const [summary, setSummary] = useState<WaitlistSummary | null>(null);
  const [wave, setWave] = useState(1);
  const [count, setCount] = useState(25);
  const [lastWave, setLastWave] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!waitlistGateway) return;
    try { setSummary(await waitlistGateway.summary()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the list."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const problem = waveProblem(wave, count);
  const confirmed = summary?.byStatus.confirmed ?? 0;

  async function invite() {
    if (!waitlistGateway || problem || busy) return;
    if (!window.confirm(`Mark the next ${count} confirmed people as invited in wave ${wave}? This does not send any email.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const invited = await waitlistGateway.inviteWave(wave, count);
      setMessage(invited === 0 ? "Nobody is confirmed and waiting, so nobody was invited." : `Marked ${invited} ${invited === 1 ? "person" : "people"} as invited in wave ${wave}.`);
      if (invited > 0) { setLastWave(wave); setWave(suggestedWave(wave)); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner</p>
            <h1>Waiting list</h1>
            <p className="subtle">Everyone who signed up before launch, in waves. Only counts are shown here, never email addresses. Inviting a wave marks the oldest confirmed people as invited; it does not send any email yet.</p>
          </div>
          <div className="stat-card"><a className="wide-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a></div>
        </div>
        {!waitlistGateway ? <div className="notice-card" role="status" data-testid="waitlist-off">The waiting list is switched off. See docs/drafts/waitlist/README.md for how to turn it on.</div> : null}
        {error ? <div className="notice-card error" role="alert">{error}</div> : null}
        {message ? <div className="notice-card success" role="status">{message}</div> : null}
        {waitlistGateway && summary ? <>
          <section className="panel panel-wide">
            <div className="panel-title"><h2>On the list: {totalOnList(summary)}</h2></div>
            <ul className="info-list" data-testid="waitlist-status-counts">
              {Object.entries(waitlistStatusLabels).map(([key, label]) => <li key={key}>{label}: {summary.byStatus[key] ?? 0}</li>)}
            </ul>
            {Object.keys(summary.bySource).length ? <>
              <h3>Where they came from</h3>
              <ul className="info-list">{Object.entries(summary.bySource).sort((a, b) => b[1] - a[1]).map(([source, n]) => <li key={source}>{source}: {n}</li>)}</ul>
            </> : null}
          </section>
          <section className="panel panel-wide">
            <div className="panel-title"><h2>Invite a wave</h2></div>
            <p className="subtle">{confirmed} confirmed and waiting. Sites are built by hand, so start small and check your build credits first.{lastWave ? ` Last wave: ${lastWave}.` : ""}</p>
            <div className="setup-form-grid">
              <label className="field">Wave number
                <input type="number" min={1} step={1} value={wave} onChange={(e) => setWave(Number(e.target.value))} />
              </label>
              <label className="field">How many people (1 to {MAX_INVITES_PER_WAVE})
                <input type="number" min={1} max={MAX_INVITES_PER_WAVE} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </label>
            </div>
            {problem ? <p className="subtle" role="status" data-testid="wave-problem">{problem}</p> : null}
            <button className="wide-btn" type="button" disabled={busy || !!problem || confirmed === 0} onClick={() => void invite()}>Mark this wave as invited</button>
          </section>
        </> : null}
      </section>
    </main>
  );
}
