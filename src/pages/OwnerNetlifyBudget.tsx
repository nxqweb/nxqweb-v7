import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { BUILDS_PER_APPROVE_RUN, MAX_BUILD_LIMIT, approveRunsLeft, budgetFromRpc, budgetProblem, buildsLeft, describeChange, type NetlifyBudget } from "../lib/netlifyBudget";

// Owner screen for the Netlify build limit (migration 234): how many builds the guard has counted this cycle, and the limits. It calls two owner-only database functions that
// already exist, so it needs no migration. It is NXQX's own safety counter, not the Netlify credit balance (read that on Netlify; its reporting can lag).
const asNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export function OwnerNetlifyBudget() {
  const [budget, setBudget] = useState<NetlifyBudget | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [maxBuildsText, setMaxBuildsText] = useState("");
  const [maxQaText, setMaxQaText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      const result = await supabase.rpc("owner_netlify_budget_status");
      if (result.error) { setError(result.error.message); }
      else {
        const next = budgetFromRpc(result.data);
        if (!next) { setError("The build limit could not be read."); }
        else {
          setBudget(next); setError("");
          setEnabled(next.enabled); setEmergencyStop(next.emergencyStop);
          setMaxBuildsText(String(next.maxBuilds)); setMaxQaText(String(next.maxQaBuilds));
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "The build limit could not be read."); }
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const maxBuilds = asNumber(maxBuildsText);
  const maxQaBuilds = asNumber(maxQaText);
  const problem = budgetProblem(maxBuilds, maxQaBuilds);
  const left = budget ? buildsLeft(budget) : null;
  const runs = left ? approveRunsLeft(left.qa) : null;

  async function save() {
    if (!supabase || !budget || problem || busy) return;
    const lines = describeChange(budget, { enabled, emergencyStop, maxBuilds, maxQaBuilds });
    if (!lines.length) { setMessage("Nothing changed."); return; }
    if (!window.confirm(`Change the Netlify build limit?\n\n${lines.join("\n")}`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await supabase.rpc("owner_update_netlify_budget_settings", { target_enabled: enabled, target_emergency_stop: emergencyStop, target_max_builds_per_cycle: maxBuilds, target_max_qa_builds_per_cycle: maxQaBuilds });
      if (result.error) setError(result.error.message);
      else { setMessage("Saved."); await load(); }
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner</p>
            <h1>Netlify build limit</h1>
            <p className="subtle">NXQX counts every site build against a limit each Netlify cycle, so a retry loop or a burst of test runs cannot spend your credits by accident. This is NXQX's own safety counter, not your Netlify credit balance: read that on Netlify (Team, then Usage and billing), and remember Netlify's numbers can lag by minutes.</p>
          </div>
          <div className="stat-card"><a className="wide-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a></div>
        </div>
        {!isSupabaseConfigured || !supabase ? <div className="notice-card error" role="alert">Supabase is not configured.</div> : null}
        {error ? <div className="notice-card error" role="alert">{error}</div> : null}
        {message ? <div className="notice-card success" role="status">{message}</div> : null}
        {budget && left && runs ? <>
          <section className="panel panel-wide">
            <div className="panel-title"><h2>This cycle (started {budget.cycleStart || "unknown"})</h2></div>
            <ul className="info-list" data-testid="budget-counts">
              <li>Builds counted: {budget.reservedBuilds} of {budget.maxBuilds} allowed, so {left.total} left.</li>
              <li>Test (QA) builds counted: {budget.reservedQaBuilds} of {budget.maxQaBuilds} allowed. QA builds also count inside the total above, so {left.qa} test builds are left.</li>
              <li>An approve test run uses {BUILDS_PER_APPROVE_RUN.fewest} to {BUILDS_PER_APPROVE_RUN.most} builds, so about {runs.atLeast} to {runs.atMost} more approve runs fit.</li>
              <li>Build limit is {budget.enabled ? "ON" : "OFF"}. Emergency stop is {budget.emergencyStop ? "ON: every new build is refused" : "off"}.</li>
            </ul>
          </section>
          <section className="panel panel-wide">
            <div className="panel-title"><h2>Change the limits</h2></div>
            <div className="setup-form-grid">
              <label className="field">Builds allowed this cycle (0 to {MAX_BUILD_LIMIT})
                <input type="number" min={0} max={MAX_BUILD_LIMIT} step={1} value={maxBuildsText} onChange={(e) => setMaxBuildsText(e.target.value)} />
              </label>
              <label className="field">Of those, test (QA) builds allowed
                <input type="number" min={0} max={MAX_BUILD_LIMIT} step={1} value={maxQaText} onChange={(e) => setMaxQaText(e.target.value)} />
              </label>
            </div>
            <label className="look-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><strong>Build limit on.</strong> Turn this off only if you want credits to be the only limit.</span></label>
            <label className="look-check"><input type="checkbox" checked={emergencyStop} onChange={(e) => setEmergencyStop(e.target.checked)} /><span><strong>Emergency stop.</strong> Refuses every new build, real clients' included, until you turn it off again.</span></label>
            {problem ? <p className="subtle" role="status" data-testid="budget-problem">{problem}</p> : null}
            <button className="wide-btn" type="button" disabled={busy || !!problem} onClick={() => void save()}>Save limits</button>
          </section>
        </> : null}
      </section>
    </main>
  );
}
