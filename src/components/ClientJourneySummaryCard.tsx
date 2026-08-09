import { ArrowRight, CheckCircle2, CircleAlert, Clock3, Route } from "lucide-react";
import type { ClientLaunchJourney } from "../lib/clientJourney";

type Props = {
  journey: ClientLaunchJourney;
};

export function ClientJourneySummaryCard({ journey }: Props) {
  const clientAction = journey.next_action.owner === "client";
  const tone = journey.client_status === "denied" ? "danger" : journey.attention_required ? "warning" : "info";

  return (
    <section className={`notice-card portal-decision-notice journey-summary-card ${tone}`}>
      <div className="journey-summary-heading">
        <div className="panel-title">
          {journey.client_status === "denied" ? <CircleAlert size={21} /> : journey.progress_percent === 100 ? <CheckCircle2 size={21} /> : <Route size={21} />}
          <div>
            <span className="journey-kicker">Website journey · {journey.progress_percent}%</span>
            <strong>{journey.stage_title}</strong>
            <p>{journey.stage_detail}</p>
          </div>
        </div>
        <a className="icon-btn" href="/client/journey">View full journey <ArrowRight size={15} /></a>
      </div>

      <div className="journey-progress" aria-label={`Website journey ${journey.progress_percent}% complete`}>
        <span style={{ width: `${Math.max(0, Math.min(100, journey.progress_percent))}%` }} />
      </div>

      <div className={`journey-next-action ${clientAction ? "client-action" : "nxq-action"}`}>
        {clientAction ? <CircleAlert size={17} /> : <Clock3 size={17} />}
        <div>
          <span>{clientAction ? "Your next step" : "NXQ is handling this"}</span>
          <strong>{journey.next_action.title}</strong>
          <p>{journey.next_action.detail}</p>
        </div>
        <a className="icon-btn" href={journey.next_action.href}>{clientAction ? "Open" : "Details"}</a>
      </div>
    </section>
  );
}
