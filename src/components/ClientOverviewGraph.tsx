import { useState } from "react";
import type { ClientLaunchJourney } from "../lib/clientJourney";

type Tone = "success" | "info" | "warning" | "danger";

type Props = {
  journey: ClientLaunchJourney | null;
  healthLabel: string; // short text from the existing health state, never guessed
  healthTone: Tone;
  billingLabel: string;
  billingTone: Tone;
  attentionCount: number | null; // null when the action list could not be built
  nxqId: string | null; // account identity number, shown so clients can quote it to support
  clientCode: string | null; // NXQ-Web client ID
};

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

// "At a glance" picture of the project built ONLY from data the portal already loaded: the journey
// progress and milestones, the health and billing summaries, and the action count. Unknown values
// show a dash. It never turns missing data into zeroes or a green state.
function IdChip({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the ID stays visible and selectable.
    }
  }
  return (
    <div className="px-id-chip">
      <small>{label}</small>
      <code>{value || "Pending setup"}</code>
      {value ? <button className="px-id-copy" onClick={() => void copy()} type="button">{copied ? "Copied" : "Copy"}</button> : null}
    </div>
  );
}

export function ClientOverviewGraph({ journey, healthLabel, healthTone, billingLabel, billingTone, attentionCount, nxqId, clientCode }: Props) {
  const percent = journey ? Math.max(0, Math.min(100, journey.progress_percent)) : null;
  const dash = percent === null ? 0 : (percent / 100) * RING_LENGTH;
  const milestones = journey?.milestones ?? [];

  return (
    <section className="px-glance" aria-label="Your website at a glance">
      <div className="px-glance-ring">
        <svg aria-hidden="true" viewBox="0 0 120 120">
          <circle className="px-ring-track" cx="60" cy="60" r={RING_RADIUS} />
          <circle
            className="px-ring-value"
            cx="60"
            cy="60"
            r={RING_RADIUS}
            strokeDasharray={`${dash} ${RING_LENGTH}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="px-ring-label">
          <strong>{percent === null ? "—" : `${percent}%`}</strong>
          <span>journey</span>
        </div>
      </div>

      <div className="px-glance-main">
        <span className="px-glance-kicker">At a glance</span>
        <h2>{journey ? journey.stage_title : "Loading your project"}</h2>

        {milestones.length > 0 ? (
          <ol className="px-rail" aria-label="Project stages">
            {milestones.map((milestone) => (
              <li className={`px-rail-step px-${milestone.status}`} key={milestone.key}>
                <i aria-hidden="true" />
                <span>{milestone.title}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="px-glance-stats">
          <div className={`px-glance-stat px-tone-${healthTone}`}>
            <small>Website health</small>
            <b>{healthLabel}</b>
          </div>
          <div className={`px-glance-stat px-tone-${billingTone}`}>
            <small>Billing</small>
            <b>{billingLabel}</b>
          </div>
          <div className={`px-glance-stat px-tone-${attentionCount === null ? "info" : attentionCount > 0 ? "warning" : "success"}`}>
            <small>Needs you</small>
            <b>{attentionCount === null ? "—" : attentionCount === 0 ? "Nothing" : `${attentionCount} item${attentionCount === 1 ? "" : "s"}`}</b>
          </div>
        </div>

        <div className="px-id-row" aria-label="Your identity numbers">
          <IdChip label="Your NXQ ID" value={nxqId} />
          <IdChip label="NXQ-Web client ID" value={clientCode} />
          <p className="px-id-note">Quote these when you contact support so we can find your account fast.</p>
        </div>
      </div>
    </section>
  );
}
