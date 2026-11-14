import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { defaultLookDraft, draftFromRow, lookColorFields, lookPayload, lookProblem, type LookDraft } from "../lib/storeLookAdmin";

export function OwnerStoreLook() {
  const [slug, setSlug] = useState("");
  const [draft, setDraft] = useState<LookDraft>(defaultLookDraft);
  const [loaded, setLoaded] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const problem = lookProblem(draft);

  async function run(action: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, after?: (data: unknown) => void) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await action();
      if (result.error) setError(result.error.message);
      else after?.(result.data);
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  }

  const cleanSlug = slug.trim().toLowerCase();
  const load = () => run(async () => supabase!.rpc("get_public_store_look", { store_slug_value: cleanSlug }), (data) => { setDraft(draftFromRow(data)); setLoaded(cleanSlug); setMessage("Loaded. A store with no saved look shows the default colors."); });
  const save = () => run(async () => supabase!.rpc("owner_set_store_look", { store_slug_value: loaded, look_value: lookPayload(draft) }), (data) => setMessage((data as { message?: string } | null)?.message || "Saved."));
  const clear = () => run(async () => supabase!.rpc("owner_clear_store_look", { store_slug_value: loaded }), (data) => { setDraft(defaultLookDraft); setMessage((data as { message?: string } | null)?.message || "Back to default."); });

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner</p>
            <h1>Store look</h1>
            <p className="subtle">Set one shop's colors, heading style and logo. It shows on the store page right away, with no build. The logo must be a file already shipped in the site's /brand/ folder.</p>
          </div>
          <div className="stat-card"><a className="wide-btn" href="/owner"><ArrowLeft size={16} /> Back to owner</a></div>
        </div>
        {!isSupabaseConfigured || !supabase ? <div className="notice-card error" role="alert">Supabase is not configured.</div> : null}
        {error ? <div className="notice-card error" role="alert">{error}</div> : null}
        {message ? <div className="notice-card success" role="status">{message}</div> : null}
        <section className="panel panel-wide">
          <label className="field">Store address (the end of /store/...)
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="light-of-the-world-candles-and-soap-..." />
          </label>
          <button className="wide-btn" type="button" disabled={busy || !cleanSlug} onClick={() => void load()}>Load this store</button>
        </section>
        {loaded ? <section className="panel panel-wide">
          <div className="panel-title"><h2>Look for {loaded}</h2></div>
          <div className="setup-form-grid">
            {lookColorFields.map((f) => (
              <label className="field" key={f.key}>{f.label}
                <input type="color" value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              </label>
            ))}
            <label className="field">Headings
              <select value={draft.heading_font} onChange={(e) => setDraft({ ...draft, heading_font: e.target.value })}>
                <option value="sans">Clean (sans-serif)</option>
                <option value="serif">Classic (serif)</option>
              </select>
            </label>
            <label className="field">Logo file (optional)
              <input type="text" value={draft.logo} onChange={(e) => setDraft({ ...draft, logo: e.target.value.trim() })} placeholder="/brand/shop-logo.png" />
            </label>
          </div>
          {problem ? <p className="subtle" role="status" data-testid="look-problem">{problem}</p> : <p className="subtle" data-testid="look-ok">Readable. Ready to save.</p>}
          <div className="button-row">
            <button className="wide-btn" type="button" disabled={busy || !!problem} onClick={() => void save()}>Save look</button>
            <button className="wide-btn" type="button" disabled={busy} onClick={() => { if (window.confirm("Put this store back to the default look?")) void clear(); }}>Back to default</button>
          </div>
        </section> : null}
      </section>
    </main>
  );
}
