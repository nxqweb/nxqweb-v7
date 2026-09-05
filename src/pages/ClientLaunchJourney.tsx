import { useEffect, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Clock3, Circle, Route, ShieldCheck } from "lucide-react";
import { journeyStatusLabel, type ClientLaunchJourney, type ClientJourneyRequirement } from "../lib/clientJourney";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

function RequirementIcon({ requirement }: { requirement: ClientJourneyRequirement }) {
  if (requirement.status === "complete") return <CheckCircle2 size={19} />;
  if (requirement.status === "action_required") return <CircleAlert size={19} />;
  if (requirement.status === "processing") return <Clock3 size={19} />;
  return <Circle size={19} />;
}

export function ClientLaunchJourneyPage() {
  const [journey, setJourney] = useState<ClientLaunchJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadJourney() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) { setError("Supabase is not configured yet."); setLoading(false); }
        return;
      }
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        window.location.replace("/portal/login");
        return;
      }
      const result = await supabase.rpc("current_client_launch_journey");
      if (!active) return;
      if (result.error) setError(result.error.message || "Your website journey could not load.");
      else setJourney(result.data as ClientLaunchJourney);
      setLoading(false);
    }
    void loadJourney();
    return () => { active = false; };
  }, []);

  return (
    <main className="nxq-page">
      <section className="portal-shell journey-page">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Route size={23} />
            <div>
              <p className="eyebrow">Clear from setup to launch</p>
              <h1>Your website journey</h1>
              <p className="subtle">One truthful timeline showing what is complete, what NXQ is handling, and the exact moments when we need you.</p>
            </div>
          </div>
          <div className="client-control-row"><a className="icon-btn" href="/client/history">NXQ value & history</a><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Portal</a></div>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state" role="status">Loading your website journey...</div> : null}

        {journey ? (
          <>
            <section className={`panel journey-hero ${journey.attention_required ? "needs-action" : ""}`}>
              <div>
                <span className="journey-kicker">Current stage · {journey.progress_percent}%</span>
                <h2>{journey.stage_title}</h2>
                <p>{journey.stage_detail}</p>
              </div>
              <div className="journey-progress journey-progress-large" aria-label={`Website journey ${journey.progress_percent}% complete`}>
                <span style={{ width: `${Math.max(0, Math.min(100, journey.progress_percent))}%` }} />
              </div>
              <div className={`journey-next-action ${journey.next_action.owner === "client" ? "client-action" : "nxq-action"}`}>
                {journey.next_action.owner === "client" ? <CircleAlert size={19} /> : <ShieldCheck size={19} />}
                <div>
                  <span>{journey.next_action.owner === "client" ? "Your next step" : "NXQ is handling this"}</span>
                  <strong>{journey.next_action.title}</strong>
                  <p>{journey.next_action.detail}</p>
                </div>
                <a className="wide-btn" href={journey.next_action.href} style={{ width: "auto" }}>Open details</a>
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <Route size={20} />
                <div><h2>Launch timeline</h2><p className="subtle">Progress changes only when the real workflow evidence changes.</p></div>
              </div>
              <ol className="journey-timeline">
                {journey.milestones.map((milestone, index) => (
                  <li className={`journey-milestone ${milestone.status}`} key={milestone.key}>
                    <div className="journey-milestone-marker">{milestone.status === "complete" ? <Check size={17} /> : index + 1}</div>
                    <div>
                      <div className="panel-title panel-title-row">
                        <strong>{milestone.title}</strong>
                        <span className="status-summary">{journeyStatusLabel(milestone.status)}</span>
                      </div>
                      <p>{milestone.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <ShieldCheck size={20} />
                <div><h2>What NXQ needs from you</h2><p className="subtle">If there is no action-required item, you are good—NXQ owns the next step.</p></div>
              </div>
              <div className="journey-requirements">
                {journey.requirements.map((requirement) => (
                  <article className={`journey-requirement ${requirement.status}`} key={requirement.key}>
                    <RequirementIcon requirement={requirement} />
                    <div>
                      <div className="panel-title panel-title-row">
                        <strong>{requirement.title}</strong>
                        <span className="status-summary">{journeyStatusLabel(requirement.status)}</span>
                      </div>
                      <p>{requirement.detail}</p>
                    </div>
                    <a className="icon-btn" href={requirement.href}>View</a>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
