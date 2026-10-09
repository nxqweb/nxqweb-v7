import { formatUsdWhole as formatMoney } from "../lib/format";

export type OwnerOverviewSummary = {
  total_clients: number;
  active_clients: number;
  active_monthly_revenue: number;
  pipeline_clients: number;
  pipeline_monthly_value: number;
  unread_client_messages: number;
  pending_approvals: number;
};

type Props = {
  summary: OwnerOverviewSummary | null; // null until the server summary has loaded: never show invented zeros
  title: string;
  subtitle: string;
};

function Bar({ label, value, max, display, tone }: { label: string; value: number; max: number; display: string; tone: "gold" | "green" | "blue" }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="px-ob-row">
      <span className="px-ob-label">{label}</span>
      <span className="px-ob-track" aria-hidden="true"><i className={`px-ob-fill px-ob-${tone}`} style={{ width: `${width}%` }} /></span>
      <b className="px-ob-value">{display}</b>
    </div>
  );
}

// Owner header graph built only from the owner summary RPC the portal already loads.
export function OwnerOverviewGraph({ summary, title, subtitle }: Props) {
  const total = summary ? Number(summary.total_clients || 0) : 0;
  const active = summary ? Number(summary.active_clients || 0) : 0;
  const pipeline = summary ? Number(summary.pipeline_clients || 0) : 0;
  const mrr = summary ? Number(summary.active_monthly_revenue || 0) : 0;
  const pipelineValue = summary ? Number(summary.pipeline_monthly_value || 0) : 0;
  const moneyMax = Math.max(mrr + pipelineValue, 1);

  return (
    <div className="px-owner-overview" aria-label="Owner overview">
      <span className="px-glance-kicker">Owner Portal · overview</span>
      <h1 className="px-ob-title">{title}</h1>
      <p className="px-ob-sub">{subtitle}</p>
      {summary ? (
        <div className="px-ob-grid">
          <div>
            <small className="px-ob-head">Clients</small>
            <Bar display={String(total)} label="Total" max={Math.max(total, 1)} tone="blue" value={total} />
            <Bar display={String(pipeline)} label="In progress" max={Math.max(total, 1)} tone="gold" value={pipeline} />
            <Bar display={String(active)} label="Active" max={Math.max(total, 1)} tone="green" value={active} />
          </div>
          <div>
            <small className="px-ob-head">Monthly income</small>
            <Bar display={`${formatMoney(mrr)}/mo`} label="Active" max={moneyMax} tone="green" value={mrr} />
            <Bar display={`${formatMoney(pipelineValue)}/mo`} label="Pipeline" max={moneyMax} tone="gold" value={pipelineValue} />
            <Bar display={`${formatMoney(mrr + pipelineValue)}/mo`} label="If all go live" max={moneyMax} tone="blue" value={mrr + pipelineValue} />
          </div>
          <div className="px-ob-chips">
            <span><b>{Number(summary.pending_approvals || 0)}</b> waiting for approval</span>
            <span><b>{Number(summary.unread_client_messages || 0)}</b> unread messages</span>
            <span className="px-ob-muted">Site views: shown here once client analytics is live</span>
          </div>
        </div>
      ) : (
        <p className="px-ob-sub">Loading your numbers…</p>
      )}
    </div>
  );
}
