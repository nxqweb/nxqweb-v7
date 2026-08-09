import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Rocket, ShieldAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Check = {
  id: string;
  check_key: string;
  category: string;
  title: string;
  required: boolean;
  status: string;
  evidence: Record<string, unknown>;
  last_checked_at: string | null;
  checked_by: string | null;
};

export function OwnerLaunchReadiness() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [error, setError] = useState("");

  async function load() {
    if (!isSupabaseConfigured || !supabase) return;
    const result = await supabase.from("launch_readiness_checks").select("*").order("category").order("title");
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setChecks((result.data || []) as Check[]);
  }

  useEffect(() => {
    void load();
  }, []);

  const required = checks.filter((check) => check.required);
  const ready = required.filter((check) => check.status === "ready").length;
  const blocked = required.filter((check) => check.status === "blocked" || check.status === "unknown").length;
  const pct = required.length ? Math.round((ready / required.length) * 100) : 0;

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Rocket size={22} />
            <div>
              <h1>Launch readiness</h1>
              <p className="subtle">Evidence-driven launch gate. This never replaces your explicit final launch approval.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Owner</a>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}

        <div className="portal-grid">
          <section className="panel"><h2>Required ready</h2><div className="status-summary">{ready}/{required.length}</div></section>
          <section className="panel"><h2>Readiness</h2><div className="status-summary">{pct}%</div></section>
          <section className="panel"><h2>Blocking/unknown</h2><div className="status-summary">{blocked}</div></section>
        </div>

        <section className="panel panel-wide">
          {checks.map((check) => (
            <article className="owner-message-card" key={check.id}>
              <div className="panel-title panel-title-row">
                <div className="panel-title">
                  {check.status === "ready" ? <CheckCircle2 size={18} /> : check.status === "warning" ? <AlertTriangle size={18} /> : <ShieldAlert size={18} />}
                  <div>
                    <strong>{check.title}</strong>
                    <p className="subtle">{check.category} · {check.check_key} · {check.required ? "required" : "optional"}</p>
                  </div>
                </div>
                <span className="status-summary">{check.status.replaceAll("_", " ")}</span>
              </div>
              {check.last_checked_at ? <p className="subtle">Checked {new Date(check.last_checked_at).toLocaleString()} {check.checked_by ? `by ${check.checked_by}` : ""}</p> : null}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
